"""Intervals.icu client using each rider's personal API key (basic auth API_KEY:<key>).

API docs: https://intervals.icu/api/v1/docs
"""
import httpx


class IntervalsError(Exception):
    def __init__(self, status: int, detail: str = ""):
        super().__init__(f"Intervals.icu responded {status}")
        self.status = status
        self.detail = detail


def body_settings(athlete: dict) -> dict:
    """FTP (indoor first) and weight from an athlete response, 0 when unknown."""
    rides = [s for s in athlete.get("sportSettings") or [] if {"Ride", "VirtualRide"} & set(s.get("types") or [])]
    rides.sort(key=lambda s: "VirtualRide" not in (s.get("types") or []))
    ftp = 0
    for setting in rides:
        ftp = setting.get("indoor_ftp") or setting.get("ftp") or 0
        if ftp:
            break
    weight = athlete.get("icu_weight") or athlete.get("weight") or 0
    return {"ftp": int(ftp), "weight": round(float(weight), 1)}


class Intervals:
    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.client = httpx.AsyncClient(base_url=base_url, timeout=30, transport=transport)

    async def close(self) -> None:
        await self.client.aclose()

    async def _send(self, account: dict, method: str, url: str, **kwargs) -> httpx.Response:
        response = await self.client.request(method, url, auth=("API_KEY", account["apiKey"]), **kwargs)
        if response.is_error:
            # keep the body short, it is only for the server log
            raise IntervalsError(response.status_code, response.text[:200])
        return response

    @staticmethod
    def _athlete(account: dict) -> str:
        return account.get("athleteId") or "0"

    async def athlete(self, account: dict) -> dict:
        response = await self._send(account, "GET", f"/api/v1/athlete/{self._athlete(account)}")
        return response.json()

    async def events(self, account: dict, oldest: str, newest: str) -> list:
        """Planned workouts with the workout converted to .zwo (workout_file_base64)."""
        response = await self._send(
            account,
            "GET",
            f"/api/v1/athlete/{self._athlete(account)}/events.json",
            params={"oldest": oldest, "newest": newest, "category": "WORKOUT", "ext": "zwo"},
        )
        return [
            {
                "id": event.get("id"),
                "name": event.get("name") or "",
                "start_date_local": event.get("start_date_local") or "",
                "workout_file_base64": event["workout_file_base64"],
            }
            for event in response.json()
            if event.get("workout_file_base64")
        ]

    async def upload(self, account: dict, content: bytes, name: str | None) -> dict:
        params = {"name": name} if name else {}
        response = await self._send(
            account,
            "POST",
            f"/api/v1/athlete/{self._athlete(account)}/activities",
            params=params,
            files={"file": ("auuki.fit", content, "application/octet-stream")},
        )
        return response.json() if response.content else {}
