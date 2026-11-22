"""Single-user backend for a self-hosted Auuki.

Implements the subset of the api.auuki.com contract the PWA uses (see CLAUDE.md),
backed by an Intervals.icu API key and an optional Garmin Connect upload.
There are no accounts: whoever can reach the server is "logged in", so bind it
to 127.0.0.1 (see compose.yaml).
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .garmin import GarminError, GarminUploader
from .intervals import Intervals, IntervalsError

log = logging.getLogger("auuki")


def error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": {"message": message}}, status_code=status)


def create_app(
    settings: Settings | None = None,
    intervals_transport: httpx.AsyncBaseTransport | None = None,
    garmin_factory=None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    intervals = Intervals(settings, transport=intervals_transport)
    garmin = GarminUploader(settings, **({"factory": garmin_factory} if garmin_factory else {}))

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        log.info(
            "intervals: %s, garmin: %s, static: %s",
            "on" if settings.intervals_enabled else "off",
            "on" if settings.garmin_enabled else "off",
            settings.static_dir,
        )
        yield
        await intervals.close()

    app = FastAPI(title="Auuki home API", lifespan=lifespan, docs_url=None, redoc_url=None)

    def intervals_unavailable() -> JSONResponse | None:
        if not settings.intervals_enabled:
            # not 403: the PWA treats 403 as "show the login form"
            return error(503, "INTERVALS_NOT_CONFIGURED")
        return None

    async def call_intervals(coro):
        try:
            return await coro
        except IntervalsError as e:
            log.warning("intervals.icu %s: %s", e.status, e.detail)
            return error(502, f"INTERVALS_{e.status}")
        except httpx.HTTPError as e:
            log.warning("intervals.icu unreachable: %s", e)
            return error(502, "INTERVALS_UNREACHABLE")

    # --- status --------------------------------------------------------------

    @app.post("/api/rpc")
    async def rpc(request: Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        if body.get("method") != "status_handler":
            return error(404, "UNKNOWN_METHOD")
        return {
            "id": body.get("id"),
            "result": {
                "identifier": "home",
                # OAuth client ids; not used, connections are configured on the server
                "services": {"strava": 0, "intervals": 0, "trainingPeaks": 0},
                "strava": False,
                "intervals": settings.intervals_enabled,
                "trainingPeaks": False,
                "garmin": settings.garmin_enabled,
            },
        }

    # --- intervals.icu -------------------------------------------------------

    @app.post("/api/intervals/events")
    async def intervals_events(oldest: str, newest: str):
        return intervals_unavailable() or await call_intervals(intervals.events(oldest, newest))

    @app.post("/api/intervals/athlete")
    async def intervals_athlete():
        return intervals_unavailable() or await call_intervals(intervals.athlete_profile())

    @app.post("/api/intervals/upload")
    async def intervals_upload(file: UploadFile = File(...), name: str | None = Form(None)):
        if (unavailable := intervals_unavailable()):
            return unavailable
        content = await file.read()
        return await call_intervals(intervals.upload(content, "auuki.fit", name))

    @app.post("/api/intervals/oauth/code")
    @app.post("/api/intervals/deauthorize")
    async def intervals_noop():
        # connection is the API key on the server, nothing to (de)authorize
        return {"result": {"success": True}}

    # --- garmin ----------------------------------------------------------------

    @app.post("/api/garmin/upload")
    async def garmin_upload(file: UploadFile = File(...), name: str | None = Form(None)):
        if not settings.garmin_enabled:
            return error(503, "GARMIN_NOT_CONFIGURED")
        content = await file.read()
        try:
            result = await run_in_threadpool(garmin.upload, content)
        except GarminError as e:
            log.warning("garmin: %s (%s)", e, e.__cause__.__class__.__name__ if e.__cause__ else "")
            return error(502, "GARMIN_UPLOAD_FAILED")
        return {"result": result}

    # --- everything else under /api (accounts, strava, trainingpeaks) -----------

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def not_available(path: str):
        return error(404, "NOT_AVAILABLE")

    # --- the PWA -----------------------------------------------------------------

    @app.middleware("http")
    async def no_cache_for_html(request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.endswith(".html") or path.endswith("sw.js"):
            response.headers["Cache-Control"] = "no-cache"
        return response

    if Path(settings.static_dir).is_dir():
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="pwa")
    else:
        log.warning("static dir %s not found, serving the API only", settings.static_dir)

    return app


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
