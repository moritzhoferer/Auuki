"""Intervals.icu client using a personal API key (basic auth API_KEY:<key>).

API docs: https://intervals.icu/api/v1/docs
"""
import httpx

from .config import Settings


class IntervalsError(Exception):
    def __init__(self, status: int, detail: str = ""):
        super().__init__(f"Intervals.icu responded {status}")
        self.status = status
        self.detail = detail


class Intervals:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.athlete = settings.intervals_athlete_id
        self.client = httpx.AsyncClient(
            base_url=settings.intervals_base_url,
            auth=("API_KEY", settings.intervals_api_key),
            timeout=30,
            transport=transport,
        )

    async def close(self) -> None:
        await self.client.aclose()

    async def _send(self, method: str, url: str, **kwargs) -> httpx.Response:
        response = await self.client.request(method, url, **kwargs)
        if response.is_error:
            # keep the body short, it is only for the server log
            raise IntervalsError(response.status_code, response.text[:200])
        return response

    async def events(self, oldest: str, newest: str) -> list:
        """Planned workouts with the workout converted to .zwo (workout_file_base64)."""
        response = await self._send(
            "GET",
            f"/api/v1/athlete/{self.athlete}/events.json",
            params={"oldest": oldest, "newest": newest, "category": "WORKOUT", "ext": "zwo"},
        )
        return response.json()

    async def athlete_profile(self) -> dict:
        response = await self._send("GET", f"/api/v1/athlete/{self.athlete}")
        return response.json()

    async def upload(self, content: bytes, filename: str, name: str | None) -> dict:
        params = {"name": name} if name else {}
        response = await self._send(
            "POST",
            f"/api/v1/athlete/{self.athlete}/activities",
            params=params,
            files={"file": (filename, content, "application/octet-stream")},
        )
        return response.json() if response.content else {}
