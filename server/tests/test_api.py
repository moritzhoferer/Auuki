import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.garmin import GarminUploader
from app.main import create_app

ZWO = b"<workout_file><workout><SteadyState Duration='60' PowerLow='0.5' PowerHigh='0.6'/></workout></workout_file>"


class FakeIntervals:
    """Records requests and answers like Intervals.icu."""

    def __init__(self, status: int = 200):
        self.requests: list[httpx.Request] = []
        self.status = status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, text="nope")
        path = request.url.path
        if path.endswith("/events.json"):
            return httpx.Response(200, json=[{
                "id": 1, "category": "WORKOUT", "name": "Sweet spot",
                "start_date_local": "2026-11-23T00:00:00",
                "workout_filename": "Sweet_spot.zwo",
                "workout_file_base64": base64.b64encode(ZWO).decode(),
            }])
        if path == "/api/v1/athlete/i123":
            return httpx.Response(200, json={"icu_weight": 72, "sportSettings": [{"types": ["Ride"], "ftp": 295}]})
        if path.endswith("/activities"):
            return httpx.Response(201, json=[{"id": "a1"}])
        return httpx.Response(404)


class FakeGarmin:
    instances: list["FakeGarmin"] = []

    def __init__(self, fail_login=False, upload_error=None):
        self.fail_login = fail_login
        self.upload_error = upload_error
        self.logins = []
        self.uploads = []
        FakeGarmin.instances.append(self)

    def login(self, tokenstore):
        self.logins.append(tokenstore)
        if self.fail_login:
            raise RuntimeError("Username and password are required")

    def upload_activity(self, path):
        with open(path, "rb") as f:
            self.uploads.append((path, f.read()))
        if self.upload_error:
            raise self.upload_error
        return {"detailedImportResult": {"successes": [{"internalId": 1}]}}


def make_client(tmp_path, intervals=None, garmin=None, key="secret", garmin_email="me@example.com"):
    settings = Settings(
        intervals_api_key=key,
        intervals_athlete_id="i123",
        garmin_email=garmin_email,
        garmin_password="pw" if garmin_email else "",
        garmin_tokenstore=str(tmp_path / "garmin-tokens"),
        static_dir=str(tmp_path / "missing-dist"),
    )
    app = create_app(
        settings,
        intervals_transport=httpx.MockTransport(intervals or FakeIntervals()),
        garmin_factory=(lambda _s: garmin) if garmin else None,
    )
    return TestClient(app)


def test_status_handler_reports_connected_services(tmp_path):
    client = make_client(tmp_path)
    response = client.post("/api/rpc", json={"id": "x", "method": "status_handler", "params": {"data": {}}})
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["intervals"] is True
    assert result["garmin"] is True
    assert result["strava"] is False
    assert result["services"] == {"strava": 0, "intervals": 0, "trainingPeaks": 0}


def test_status_handler_without_configuration(tmp_path):
    client = make_client(tmp_path, key="", garmin_email="")
    result = client.post("/api/rpc", json={"method": "status_handler"}).json()["result"]
    assert result["intervals"] is False
    assert result["garmin"] is False


def test_unknown_rpc_method(tmp_path):
    assert make_client(tmp_path).post("/api/rpc", json={"method": "nope"}).status_code == 404


def test_events_ask_for_planned_workouts_as_zwo(tmp_path):
    fake = FakeIntervals()
    client = make_client(tmp_path, intervals=fake)

    response = client.post("/api/intervals/events?oldest=2026-11-23&newest=2026-11-29")

    assert response.status_code == 200
    events = response.json()
    assert base64.b64decode(events[0]["workout_file_base64"]) == ZWO
    request = fake.requests[0]
    assert request.method == "GET"
    assert request.url.path == "/api/v1/athlete/i123/events.json"
    assert dict(request.url.params) == {
        "oldest": "2026-11-23", "newest": "2026-11-29", "category": "WORKOUT", "ext": "zwo",
    }
    assert request.headers["authorization"] == "Basic " + base64.b64encode(b"API_KEY:secret").decode()


def test_athlete(tmp_path):
    response = make_client(tmp_path).post("/api/intervals/athlete")
    assert response.status_code == 200
    assert response.json()["sportSettings"][0]["ftp"] == 295


def test_upload_sends_fit_file_and_name(tmp_path):
    fake = FakeIntervals()
    client = make_client(tmp_path, intervals=fake)

    response = client.post(
        "/api/intervals/upload",
        files={"file": ("blob", b"FITDATA", "application/octet-stream")},
        data={"name": "Sweet spot 2x25"},
    )

    assert response.status_code == 200
    request = fake.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/api/v1/athlete/i123/activities"
    assert request.url.params["name"] == "Sweet spot 2x25"
    body = request.content
    assert b'name="file"; filename="auuki.fit"' in body
    assert b"FITDATA" in body


def test_intervals_not_configured_is_503_not_403(tmp_path):
    client = make_client(tmp_path, key="")
    assert client.post("/api/intervals/events?oldest=a&newest=b").status_code == 503
    assert client.post("/api/intervals/athlete").status_code == 503


def test_intervals_errors_become_502(tmp_path):
    client = make_client(tmp_path, intervals=FakeIntervals(status=401))
    response = client.post("/api/intervals/athlete")
    assert response.status_code == 502
    assert response.json()["error"]["message"] == "INTERVALS_401"


def test_intervals_unreachable_is_502(tmp_path):
    def down(request):
        raise httpx.ConnectError("down", request=request)

    response = make_client(tmp_path, intervals=down).post("/api/intervals/athlete")
    assert response.status_code == 502


def test_garmin_upload_logs_in_with_tokenstore_and_uploads_fit(tmp_path):
    garmin = FakeGarmin()
    client = make_client(tmp_path, garmin=garmin)

    response = client.post("/api/garmin/upload", files={"file": ("blob", b"FITDATA")}, data={"name": "x"})
    assert response.status_code == 200
    assert response.json()["result"]["duplicate"] is False
    assert garmin.logins == [str(tmp_path / "garmin-tokens")]
    path, content = garmin.uploads[0]
    assert path.endswith(".fit") and content == b"FITDATA"

    # the session is reused for the next upload
    client.post("/api/garmin/upload", files={"file": ("blob", b"FIT2")})
    assert len(garmin.logins) == 1


def test_garmin_duplicate_is_success(tmp_path):
    garmin = FakeGarmin(upload_error=RuntimeError("409 Client Error: Conflict"))
    response = make_client(tmp_path, garmin=garmin).post("/api/garmin/upload", files={"file": ("b", b"F")})
    assert response.status_code == 200
    assert response.json()["result"]["duplicate"] is True


def test_garmin_login_failure_is_502(tmp_path):
    garmin = FakeGarmin(fail_login=True)
    response = make_client(tmp_path, garmin=garmin).post("/api/garmin/upload", files={"file": ("b", b"F")})
    assert response.status_code == 502
    assert response.json()["error"]["message"] == "GARMIN_UPLOAD_FAILED"


def test_garmin_not_configured(tmp_path):
    response = make_client(tmp_path, garmin_email="").post("/api/garmin/upload", files={"file": ("b", b"F")})
    assert response.status_code == 503


@pytest.mark.parametrize("path", [
    "/api/login", "/api/register", "/api/logout", "/api/verify-email", "/api/forgot-password",
    "/api/reset-password", "/api/account/delete", "/api/strava/upload", "/api/trainingpeaks/wod",
])
def test_account_and_other_services_are_not_available(tmp_path, path):
    assert make_client(tmp_path).post(path, json={}).status_code == 404


def test_serves_the_pwa_with_no_cache_on_html(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Auuki</title>")
    (dist / "app.123.js").write_text("console.log(1)")
    settings = Settings(intervals_api_key="k", static_dir=str(dist), garmin_tokenstore=str(tmp_path / "t"))
    client = TestClient(create_app(settings, intervals_transport=httpx.MockTransport(FakeIntervals())))

    index = client.get("/")
    assert index.status_code == 200 and "Auuki" in index.text
    assert index.headers["cache-control"] == "no-cache"
    asset = client.get("/app.123.js")
    assert asset.status_code == 200 and "cache-control" not in asset.headers
    # the API still wins over the static mount
    assert client.post("/api/rpc", json={"method": "status_handler"}).status_code == 200


def test_env_file_is_read(tmp_path, monkeypatch):
    from app import config

    env = tmp_path / ".env"
    env.write_text("# comment\nINTERVALS_API_KEY='abc'\nINTERVALS_ATHLETE_ID=i9\n")
    monkeypatch.delenv("INTERVALS_API_KEY", raising=False)
    monkeypatch.delenv("INTERVALS_ATHLETE_ID", raising=False)
    config.load_env_file(env)
    settings = Settings.from_env()
    assert settings.intervals_api_key == "abc"
    assert settings.intervals_athlete_id == "i9"
    assert json.dumps(settings.intervals_enabled) == "true"
