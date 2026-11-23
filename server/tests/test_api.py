import base64
import json
import os
import stat

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

ZWO = b"<workout_file><workout><SteadyState Duration='60' PowerLow='0.5' PowerHigh='0.6'/></workout></workout_file>"
KEY = "intervals-secret-key"


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
            return httpx.Response(200, json=[
                {"id": 1, "category": "WORKOUT", "name": "Sweet spot",
                 "start_date_local": "2026-11-23T00:00:00", "workout_filename": "Sweet_spot.zwo",
                 "workout_file_base64": base64.b64encode(ZWO).decode(), "description": "long"},
                {"id": 2, "category": "WORKOUT", "name": "No file"},
            ])
        if path in ("/api/v1/athlete/i123", "/api/v1/athlete/0"):
            return httpx.Response(200, json={
                "id": "i123", "icu_weight": 72.4,
                "sportSettings": [
                    {"types": ["Run"], "ftp": 400},
                    {"types": ["Ride"], "ftp": 290},
                    {"types": ["VirtualRide"], "ftp": 290, "indoor_ftp": 295},
                ],
            })
        if path.endswith("/activities"):
            return httpx.Response(201, json=[{"id": "a1"}])
        return httpx.Response(404)


class FakeClient:
    def __init__(self, owner):
        self.owner = owner

    def dump(self, path):
        os.makedirs(path, exist_ok=True)
        with open(os.path.join(path, "garmin_tokens.json"), "w") as f:
            f.write("{}")
        self.owner.dumps.append(path)


class FakeGarmin:
    """Stands in for garminconnect.Garmin."""

    def __init__(self, mfa=False, fail=False, upload_error=None):
        self.mfa, self.fail, self.upload_error = mfa, fail, upload_error
        self.client = FakeClient(self)
        self.dumps, self.logins, self.uploads, self.codes = [], [], [], []
        self.credentials = None

    def factory(self, email=None, password=None, return_on_mfa=False):
        self.credentials = (email, password, return_on_mfa)
        return self

    def login(self, tokenstore=None):
        self.logins.append(tokenstore)
        if self.fail:
            raise RuntimeError("Username and password are required")
        if self.mfa and tokenstore is None:
            return "needs_mfa", {"state": 1}
        return None, None

    def resume_login(self, state, code):
        self.codes.append(code)
        if code != "123456":
            raise RuntimeError("bad code")
        return None, None

    def get_cycling_ftp(self):
        return {"functionalThresholdPower": 281, "sport": "CYCLING"}

    def get_latest_weight(self):
        return {"weight": 70600.0, "date": 1795300000000}

    def get_user_profile(self):
        return {"userData": {"weight": 71000.0}}

    def upload_activity(self, path):
        with open(path, "rb") as f:
            self.uploads.append(f.read())
        if self.upload_error:
            raise self.upload_error


def make_client(tmp_path, intervals=None, garmin=None):
    settings = Settings(data_dir=str(tmp_path / "data"), static_dir=str(tmp_path / "missing"),
                        intervals_base_url="https://intervals.test")
    app = create_app(
        settings,
        intervals_transport=httpx.MockTransport(intervals or FakeIntervals()),
        garmin_factory=(garmin or FakeGarmin()).factory,
    )
    return TestClient(app)


def rider(client, name="Moritz", pin=None):
    body = {"name": name} | ({"pin": pin} if pin else {})
    response = client.post("/api/riders", json=body)
    assert response.status_code == 200
    return response.json()


def with_intervals(client):
    response = client.put("/api/me/intervals", json={"apiKey": KEY, "athleteId": "i123"})
    assert response.status_code == 200
    return response.json()


def add_ride(client, summary=None):
    response = client.post("/api/me/rides", files={"file": ("ride.fit", b"FITDATA")},
                           data={"summary": json.dumps(summary or {"name": "Sweet spot", "duration": 3600})})
    assert response.status_code == 200
    return response.json()


# --- riders and session -----------------------------------------------------------------

def test_new_rider_is_logged_in_and_listed(tmp_path):
    client = make_client(tmp_path)
    me = rider(client, pin="1234")
    assert me["name"] == "Moritz" and me["hasPin"] is True
    assert me["intervals"] == {"connected": False, "athleteId": ""}
    assert me["garmin"] == {"connected": False}
    assert client.get("/api/me").json()["id"] == me["id"]
    assert client.get("/api/riders").json() == [{"id": me["id"], "name": "Moritz", "hasPin": True}]


def test_without_session_is_401(tmp_path):
    client = make_client(tmp_path)
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me/rides").status_code == 401


def test_login_with_and_without_pin(tmp_path):
    client = make_client(tmp_path)
    moritz = rider(client, pin="1234")
    anna = rider(client, name="Anna")
    client.delete("/api/session")
    assert client.get("/api/me").status_code == 401

    assert client.post("/api/session", json={"rider": anna["id"]}).json()["name"] == "Anna"
    assert client.post("/api/session", json={"rider": moritz["id"], "pin": "9999"}).status_code == 403
    assert client.get("/api/me").json()["name"] == "Anna"
    assert client.post("/api/session", json={"rider": moritz["id"], "pin": "1234"}).status_code == 200
    assert client.get("/api/me").json()["name"] == "Moritz"


def test_pin_locks_after_repeated_failures(tmp_path):
    client = make_client(tmp_path)
    me = rider(client, pin="1234")
    for _ in range(5):
        assert client.post("/api/session", json={"rider": me["id"], "pin": "0000"}).status_code == 403
    assert client.post("/api/session", json={"rider": me["id"], "pin": "1234"}).status_code == 429


def test_forged_cookie_is_rejected(tmp_path):
    client = make_client(tmp_path)
    me = rider(client)
    token = client.cookies.get("auuki_session")
    client.cookies.set("auuki_session", token[:-1] + ("0" if token[-1] != "0" else "1"))
    assert client.get("/api/me").status_code == 401
    client.cookies.set("auuki_session", f"{me['id']}.9999999999.abc")
    assert client.get("/api/me").status_code == 401


def test_change_profile(tmp_path):
    client = make_client(tmp_path)
    rider(client, pin="1234")
    me = client.patch("/api/me", json={"name": "Mo", "ftp": 301, "weight": 71.5, "pin": ""}).json()
    assert (me["name"], me["ftp"], me["weight"], me["hasPin"]) == ("Mo", 301, 71.5, False)
    assert client.patch("/api/me", json={"ftp": 5}).status_code == 422


def test_profiles_file_is_private_and_keys_never_returned(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    me = with_intervals(client)["me"]
    path = tmp_path / "data" / "profiles.json"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert KEY in path.read_text()
    assert KEY not in json.dumps(me)
    assert KEY not in client.get("/api/me").text
    assert KEY not in client.get("/api/riders").text


def test_delete_rider_removes_rides(tmp_path):
    client = make_client(tmp_path)
    me = rider(client)
    add_ride(client)
    assert client.delete("/api/me").status_code == 200
    assert client.get("/api/riders").json() == []
    assert not (tmp_path / "data" / "rides" / me["id"]).exists()


# --- intervals.icu -------------------------------------------------------------------------

def test_connect_intervals_checks_the_key_and_suggests_ftp_and_weight(tmp_path):
    fake = FakeIntervals()
    client = make_client(tmp_path, intervals=fake)
    rider(client)
    result = client.put("/api/me/intervals", json={"apiKey": KEY}).json()
    assert result["me"]["intervals"] == {"connected": True, "athleteId": "i123"}
    assert result["athlete"] == {"ftp": 295, "weight": 72.4}
    request = fake.requests[0]
    assert request.url.path == "/api/v1/athlete/0"
    assert request.headers["authorization"] == "Basic " + base64.b64encode(f"API_KEY:{KEY}".encode()).decode()


def test_rejected_key_is_not_stored(tmp_path):
    client = make_client(tmp_path, intervals=FakeIntervals(status=401))
    rider(client)
    response = client.put("/api/me/intervals", json={"apiKey": KEY})
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "INTERVALS_KEY_REJECTED"
    assert client.get("/api/me").json()["intervals"]["connected"] is False


def test_body_source_intervals(tmp_path):
    client = make_client(tmp_path)
    me = rider(client)
    assert me["bodySource"] == "manual"
    assert client.put("/api/me/body-source", json={"source": "intervals"}).status_code == 409
    with_intervals(client)
    me = client.put("/api/me/body-source", json={"source": "intervals"}).json()
    assert (me["bodySource"], me["ftp"], me["weight"]) == ("intervals", 295, 72.4)
    assert me["bodySyncedAt"] > 0

    client.patch("/api/me", json={"ftp": 200})
    me = client.post("/api/me/body/sync").json()
    assert me["ftp"] == 295

    # disconnecting the source goes back to manual, values stay
    me = client.delete("/api/me/intervals").json()
    assert (me["bodySource"], me["ftp"]) == ("manual", 295)


def test_body_source_garmin(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    assert client.put("/api/me/body-source", json={"source": "garmin"}).status_code == 409
    client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"})
    me = client.put("/api/me/body-source", json={"source": "garmin"}).json()
    assert (me["bodySource"], me["ftp"], me["weight"]) == ("garmin", 281, 70.6)
    me = client.delete("/api/me/garmin").json()
    assert me["bodySource"] == "manual"


def test_body_source_rejects_unknown(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    assert client.put("/api/me/body-source", json={"source": "strava"}).status_code == 422
    assert client.post("/api/me/body/sync").json()["bodySource"] == "manual"


def test_garmin_body_settings_shapes():
    from app.garmin import body_settings
    assert body_settings([{"functionalThresholdPower": 250.4}], {"weight": 68000}) == {"ftp": 250, "weight": 68.0}
    assert body_settings({}, {}, lambda: {"userData": {"weight": 71000}}) == {"ftp": 0, "weight": 71.0}
    assert body_settings(None, None) == {"ftp": 0, "weight": 0.0}


def test_events_keep_only_workouts_with_a_file(tmp_path):
    fake = FakeIntervals()
    client = make_client(tmp_path, intervals=fake)
    rider(client)
    with_intervals(client)
    events = client.get("/api/me/intervals/events?oldest=2026-11-23&newest=2026-11-29").json()
    assert len(events) == 1
    assert base64.b64decode(events[0]["workout_file_base64"]) == ZWO
    assert set(events[0]) == {"id", "name", "start_date_local", "workout_file_base64"}
    assert dict(fake.requests[-1].url.params) == {
        "oldest": "2026-11-23", "newest": "2026-11-29", "category": "WORKOUT", "ext": "zwo",
    }
    assert client.get("/api/me/intervals/events?oldest=x&newest=y").status_code == 400


def test_riders_use_their_own_keys(tmp_path):
    fake = FakeIntervals()
    client = make_client(tmp_path, intervals=fake)
    rider(client)
    with_intervals(client)
    rider(client, name="Anna")
    assert client.get("/api/me/intervals/events?oldest=2026-11-23&newest=2026-11-29").status_code == 409


def test_intervals_unreachable_is_502(tmp_path):
    def down(request):
        raise httpx.ConnectError("down", request=request)

    client = make_client(tmp_path, intervals=down)
    rider(client)
    assert client.put("/api/me/intervals", json={"apiKey": KEY}).status_code == 502


# --- garmin ---------------------------------------------------------------------------------

def test_garmin_login_without_mfa_saves_tokens(tmp_path):
    garmin = FakeGarmin()
    client = make_client(tmp_path, garmin=garmin)
    me = rider(client)
    result = client.post("/api/me/garmin", json={"email": "me@example.com", "password": "pw"}).json()
    assert result["status"] == "ok"
    assert result["me"]["garmin"]["connected"] is True
    assert garmin.credentials == ("me@example.com", "pw", True)
    assert garmin.dumps == [str(tmp_path / "data" / "garmin" / me["id"])]
    assert "pw" not in (tmp_path / "data" / "profiles.json").read_text()


def test_garmin_login_with_mfa(tmp_path):
    garmin = FakeGarmin(mfa=True)
    client = make_client(tmp_path, garmin=garmin)
    rider(client)
    assert client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"}).json()["status"] == "mfa"
    assert client.get("/api/me").json()["garmin"]["connected"] is False
    assert client.post("/api/me/garmin/mfa", json={"code": "000000"}).status_code == 502
    assert client.post("/api/me/garmin/mfa", json={"code": "123456"}).json()["me"]["garmin"]["connected"] is True


def test_garmin_login_failure(tmp_path):
    client = make_client(tmp_path, garmin=FakeGarmin(fail=True))
    rider(client)
    response = client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"})
    assert response.status_code == 502


def test_garmin_disconnect(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"})
    assert client.delete("/api/me/garmin").json()["garmin"]["connected"] is False


# --- rides ------------------------------------------------------------------------------------

def test_rides_are_stored_per_rider(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    ride = add_ride(client, {"name": "Sweet spot", "duration": 3600, "power": 240.4, "evil": "x"})
    assert ride["name"] == "Sweet spot" and ride["power"] == 240
    assert "evil" not in ride
    assert ride["uploads"] == {"garmin": "none", "intervals": "none"}
    assert client.get("/api/me/rides").json() == [ride]
    assert client.get(f"/api/me/rides/{ride['id']}/file").content == b"FITDATA"

    rider(client, name="Anna")
    assert client.get("/api/me/rides").json() == []
    assert client.get(f"/api/me/rides/{ride['id']}/file").status_code == 404


def test_ride_ids_cannot_escape(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    assert client.get("/api/me/rides/..%2F..%2Fprofiles/file").status_code == 404
    assert client.delete("/api/me/rides/../index").status_code == 404


def test_empty_ride_is_rejected(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    response = client.post("/api/me/rides", files={"file": ("ride.fit", b"")})
    assert response.status_code == 400


def test_delete_ride(tmp_path):
    client = make_client(tmp_path)
    rider(client)
    ride = add_ride(client)
    assert client.delete(f"/api/me/rides/{ride['id']}").status_code == 200
    assert client.get("/api/me/rides").json() == []


def test_upload_ride_to_garmin(tmp_path):
    garmin = FakeGarmin()
    client = make_client(tmp_path, garmin=garmin)
    me = rider(client)
    ride = add_ride(client)
    assert client.post(f"/api/me/rides/{ride['id']}/upload/garmin").status_code == 409

    client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"})
    result = client.post(f"/api/me/rides/{ride['id']}/upload/garmin").json()
    assert result["uploads"]["garmin"] == "done"
    assert garmin.uploads == [b"FITDATA"]


def test_garmin_upload_after_restart_uses_saved_tokens(tmp_path):
    garmin = FakeGarmin()
    client = make_client(tmp_path, garmin=garmin)
    me = rider(client)
    client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"})
    ride = add_ride(client)

    restarted = make_client(tmp_path, garmin=garmin)
    restarted.cookies = client.cookies
    assert restarted.post(f"/api/me/rides/{ride['id']}/upload/garmin").json()["uploads"]["garmin"] == "done"
    assert garmin.logins[-1] == str(tmp_path / "data" / "garmin" / me["id"])


def test_garmin_duplicate_counts_as_done(tmp_path):
    client = make_client(tmp_path, garmin=FakeGarmin(upload_error=RuntimeError("409 Client Error: Conflict")))
    rider(client)
    client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"})
    ride = add_ride(client)
    assert client.post(f"/api/me/rides/{ride['id']}/upload/garmin").json()["uploads"]["garmin"] == "done"


def test_failed_upload_is_marked(tmp_path):
    client = make_client(tmp_path, garmin=FakeGarmin(upload_error=RuntimeError("500")))
    rider(client)
    client.post("/api/me/garmin", json={"email": "a@b.c", "password": "pw"})
    ride = add_ride(client)
    assert client.post(f"/api/me/rides/{ride['id']}/upload/garmin").status_code == 502
    assert client.get("/api/me/rides").json()[0]["uploads"]["garmin"] == "failed"


def test_upload_ride_to_intervals(tmp_path):
    fake = FakeIntervals()
    client = make_client(tmp_path, intervals=fake)
    rider(client)
    with_intervals(client)
    ride = add_ride(client, {"name": "Sweet spot 2x25"})
    assert client.post(f"/api/me/rides/{ride['id']}/upload/intervals").json()["uploads"]["intervals"] == "done"
    request = fake.requests[-1]
    assert request.url.path == "/api/v1/athlete/i123/activities"
    assert request.url.params["name"] == "Sweet spot 2x25"
    assert b"FITDATA" in request.content


def test_unknown_api_path_is_404(tmp_path):
    assert make_client(tmp_path).get("/api/rpc").status_code == 404
