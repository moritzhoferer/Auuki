"""Backend for a self-hosted Auuki shared by a few riders on a home network.

Each rider has a profile (optional PIN), their own Intervals.icu API key and Garmin
login, and their rides as FIT files. The PWA is served from the same origin, so the
session is a plain HttpOnly cookie and no CORS is needed.
"""
import json
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, File, Form, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import Settings
from .garmin import GarminAccounts, GarminError
from .intervals import Intervals, IntervalsError, body_settings
from .store import UPLOAD_SERVICES, Store, hash_pin

log = logging.getLogger("auuki")

COOKIE = "auuki_session"
MAX_FIT_BYTES = 20 * 1024 * 1024
PIN = r"^\d{4,8}$"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message


class NewRider(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    pin: str | None = Field(default=None, pattern=PIN)


class Login(BaseModel):
    rider: str
    pin: str | None = None


class RiderChanges(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=30)
    # "" removes the PIN
    pin: str | None = Field(default=None, pattern=r"^(\d{4,8})?$")
    ftp: int | None = Field(default=None, ge=50, le=700)
    weight: float | None = Field(default=None, ge=25, le=250)


class BodySource(BaseModel):
    source: Literal["manual", "intervals", "garmin"]


class IntervalsAccount(BaseModel):
    apiKey: str = Field(min_length=8, max_length=200)
    athleteId: str = Field(default="0", pattern=r"^(0|i?\d{1,12})$")


class GarminLogin(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class GarminCode(BaseModel):
    code: str = Field(pattern=r"^\d{4,8}$")


def create_app(
    settings: Settings | None = None,
    intervals_transport: httpx.AsyncBaseTransport | None = None,
    garmin_factory=None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    store = Store(settings.data_dir)
    intervals = Intervals(settings.intervals_base_url, transport=intervals_transport)
    garmin = GarminAccounts(store.garmin_dir, **({"factory": garmin_factory} if garmin_factory else {}))

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        log.info("data: %s, static: %s", settings.data_dir, settings.static_dir)
        yield
        await intervals.close()

    app = FastAPI(title="Auuki home API", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.exception_handler(ApiError)
    async def api_error(_request: Request, error: ApiError):
        return JSONResponse({"error": {"message": error.message}}, status_code=error.status)

    def current_rider(request: Request) -> dict:
        rider = store.session_rider(request.cookies.get(COOKIE))
        if rider is None:
            raise ApiError(401, "NOT_LOGGED_IN")
        return rider

    def start_session(response: Response, rider: dict) -> dict:
        response.set_cookie(
            COOKIE, store.session_token(rider["id"]), max_age=180 * 24 * 3600,
            httponly=True, samesite="lax", secure=settings.cookie_secure,
        )
        return store.public(rider)

    def intervals_account(rider: dict) -> dict:
        account = rider.get("intervals") or {}
        if not account.get("apiKey"):
            raise ApiError(409, "INTERVALS_NOT_CONNECTED")
        return account

    async def call_intervals(coro):
        try:
            return await coro
        except IntervalsError as e:
            log.warning("intervals.icu %s: %s", e.status, e.detail)
            if e.status in (401, 403):
                raise ApiError(400, "INTERVALS_KEY_REJECTED")
            raise ApiError(502, f"INTERVALS_{e.status}")
        except httpx.HTTPError as e:
            log.warning("intervals.icu unreachable: %s", e)
            raise ApiError(502, "INTERVALS_UNREACHABLE")

    async def call_garmin(fn, *args):
        try:
            return await run_in_threadpool(fn, *args)
        except GarminError as e:
            cause = e.__cause__.__class__.__name__ if e.__cause__ else ""
            log.warning("garmin: %s (%s)", e, cause)
            raise ApiError(502, "GARMIN_FAILED")

    # --- riders and session -------------------------------------------------------

    @app.get("/api/riders")
    async def riders():
        return store.overview()

    @app.post("/api/riders")
    async def create_rider(body: NewRider, response: Response):
        rider = store.create(body.name.strip(), body.pin)
        return start_session(response, rider)

    @app.post("/api/session")
    async def login(body: Login, response: Response):
        try:
            rider = store.login(body.rider, body.pin)
        except PermissionError:
            raise ApiError(429, "TOO_MANY_TRIES")
        if rider is None:
            raise ApiError(403, "WRONG_PIN")
        return start_session(response, rider)

    @app.delete("/api/session")
    async def logout(response: Response):
        response.delete_cookie(COOKIE)
        return {"ok": True}

    @app.get("/api/me")
    async def me(rider: dict = Depends(current_rider)):
        return store.public(rider)

    @app.patch("/api/me")
    async def change_me(body: RiderChanges, rider: dict = Depends(current_rider)):
        changes = body.model_dump(exclude_none=True)
        if "pin" in changes:
            changes["pin"] = hash_pin(changes["pin"]) if changes["pin"] else None
        if "name" in changes:
            changes["name"] = changes["name"].strip()
        return store.public(store.update(rider["id"], **changes))

    @app.delete("/api/me")
    async def delete_me(response: Response, rider: dict = Depends(current_rider)):
        garmin.disconnect(rider["id"])
        store.delete(rider["id"])
        response.delete_cookie(COOKIE)
        return {"ok": True}

    # --- intervals.icu ----------------------------------------------------------------

    @app.put("/api/me/intervals")
    async def connect_intervals(body: IntervalsAccount, rider: dict = Depends(current_rider)):
        account = {"apiKey": body.apiKey.strip(), "athleteId": body.athleteId}
        athlete = await call_intervals(intervals.athlete(account))
        if body.athleteId == "0" and athlete.get("id"):
            account["athleteId"] = str(athlete["id"])
        updated = store.update(rider["id"], intervals=account)
        return {"me": store.public(updated), "athlete": body_settings(athlete)}

    @app.delete("/api/me/intervals")
    async def disconnect_intervals(rider: dict = Depends(current_rider)):
        changes = {"intervals": None}
        if rider.get("bodySource") == "intervals":
            changes["bodySource"] = "manual"
        return store.public(store.update(rider["id"], **changes))

    @app.get("/api/me/intervals/events")
    async def intervals_events(oldest: str, newest: str, rider: dict = Depends(current_rider)):
        if not (DATE.match(oldest) and DATE.match(newest)):
            raise ApiError(400, "INVALID_DATE")
        return await call_intervals(intervals.events(intervals_account(rider), oldest, newest))

    # --- garmin -------------------------------------------------------------------------

    @app.post("/api/me/garmin")
    async def connect_garmin(body: GarminLogin, rider: dict = Depends(current_rider)):
        status = await call_garmin(garmin.login, rider["id"], body.email.strip(), body.password)
        return {"status": status, "me": store.public(rider)}

    @app.post("/api/me/garmin/mfa")
    async def garmin_mfa(body: GarminCode, rider: dict = Depends(current_rider)):
        status = await call_garmin(garmin.mfa, rider["id"], body.code)
        return {"status": status, "me": store.public(rider)}

    # --- FTP and weight: entered by hand, or taken from Intervals.icu or Garmin -------

    async def body_from(rider: dict, source: str) -> dict:
        if source == "intervals":
            athlete = await call_intervals(intervals.athlete(intervals_account(rider)))
            return body_settings(athlete)
        if not store.garmin_connected(rider["id"]):
            raise ApiError(409, "GARMIN_NOT_CONNECTED")
        return await call_garmin(garmin.body, rider["id"])

    @app.put("/api/me/body-source")
    async def set_body_source(body: BodySource, rider: dict = Depends(current_rider)):
        changes = {"bodySource": body.source}
        if body.source != "manual":
            changes.update({k: v for k, v in (await body_from(rider, body.source)).items() if v})
        return store.public(store.update(rider["id"], **changes))

    @app.post("/api/me/body/sync")
    async def sync_body(rider: dict = Depends(current_rider)):
        source = rider.get("bodySource", "manual")
        if source == "manual":
            return store.public(rider)
        values = {k: v for k, v in (await body_from(rider, source)).items() if v}
        return store.public(store.update(rider["id"], **values))

    @app.delete("/api/me/garmin")
    async def disconnect_garmin(rider: dict = Depends(current_rider)):
        garmin.disconnect(rider["id"])
        if rider.get("bodySource") == "garmin":
            rider = store.update(rider["id"], bodySource="manual")
        return store.public(rider)

    # --- rides --------------------------------------------------------------------------

    @app.get("/api/me/rides")
    async def rides(rider: dict = Depends(current_rider)):
        return store.rides(rider["id"])

    @app.post("/api/me/rides")
    async def add_ride(
        file: UploadFile = File(...),
        summary: str = Form("{}"),
        rider: dict = Depends(current_rider),
    ):
        content = await file.read(MAX_FIT_BYTES + 1)
        if not content or len(content) > MAX_FIT_BYTES:
            raise ApiError(400, "INVALID_FILE")
        try:
            values = json.loads(summary)
        except json.JSONDecodeError:
            values = {}
        return store.add_ride(rider["id"], content, values if isinstance(values, dict) else {})

    def ride_path(rider: dict, ride_id: str) -> Path:
        path = store.ride_file(rider["id"], ride_id)
        if path is None:
            raise ApiError(404, "NO_SUCH_RIDE")
        return path

    @app.get("/api/me/rides/{ride_id}/file")
    async def ride_file(ride_id: str, rider: dict = Depends(current_rider)):
        return FileResponse(ride_path(rider, ride_id), media_type="application/octet-stream",
                            filename=f"auuki-{ride_id}.fit")

    @app.delete("/api/me/rides/{ride_id}")
    async def delete_ride(ride_id: str, rider: dict = Depends(current_rider)):
        if not store.delete_ride(rider["id"], ride_id):
            raise ApiError(404, "NO_SUCH_RIDE")
        return {"ok": True}

    @app.post("/api/me/rides/{ride_id}/upload/{service}")
    async def upload_ride(ride_id: str, service: str, rider: dict = Depends(current_rider)):
        if service not in UPLOAD_SERVICES:
            raise ApiError(404, "NO_SUCH_SERVICE")
        content = ride_path(rider, ride_id).read_bytes()
        name = store.ride(rider["id"], ride_id).get("name")
        try:
            if service == "garmin":
                if not store.garmin_connected(rider["id"]):
                    raise ApiError(409, "GARMIN_NOT_CONNECTED")
                await call_garmin(garmin.upload, rider["id"], content)
            else:
                await call_intervals(intervals.upload(intervals_account(rider), content, name))
        except ApiError as e:
            if e.status == 502:
                store.set_upload(rider["id"], ride_id, service, "failed")
            raise
        return store.set_upload(rider["id"], ride_id, service, "done")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def not_found(path: str):
        raise ApiError(404, "NOT_FOUND")

    # --- the PWA -------------------------------------------------------------------------

    @app.middleware("http")
    async def no_cache_for_html(request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.endswith(".html") or path.endswith("sw.js") or path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    if Path(settings.static_dir).is_dir():
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="pwa")
    else:
        log.warning("static dir %s not found, serving the API only", settings.static_dir)

    return app


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
