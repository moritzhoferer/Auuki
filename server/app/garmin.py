"""Garmin Connect via the unofficial `garminconnect` package, one login per rider.

The rider logs in from the app with email and password (and an MFA code when Garmin
asks for one). Only the OAuth tokens are kept, in DATA_DIR/garmin/<rider>/; the
password is used once and never stored.
"""
import logging
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable

log = logging.getLogger(__name__)

MFA_SECONDS = 300


class GarminError(Exception):
    pass


def default_factory(email: str | None = None, password: str | None = None, return_on_mfa: bool = False):
    from garminconnect import Garmin  # imported lazily, it is a heavy import

    return Garmin(email, password, return_on_mfa=return_on_mfa)


class GarminAccounts:
    def __init__(self, tokens_dir: Callable[[str], Path], factory: Callable = default_factory):
        self.tokens_dir = tokens_dir
        self.factory = factory
        self.clients: dict[str, object] = {}
        self.pending: dict[str, tuple[object, object, float]] = {}
        self.lock = threading.Lock()

    def login(self, rider_id: str, email: str, password: str) -> str:
        """'ok' when logged in, 'mfa' when Garmin wants a code. Blocking."""
        api = self.factory(email, password, return_on_mfa=True)
        try:
            status, state = api.login()
        except Exception as error:
            raise GarminError("Garmin login failed") from error
        if status == "needs_mfa":
            self.pending[rider_id] = (api, state, time.time())
            return "mfa"
        self._save(rider_id, api)
        return "ok"

    def mfa(self, rider_id: str, code: str) -> str:
        api, state, since = self.pending.get(rider_id, (None, None, 0.0))
        if api is None or time.time() - since > MFA_SECONDS:
            self.pending.pop(rider_id, None)
            raise GarminError("No Garmin login is waiting for a code")
        try:
            api.resume_login(state, code)
        except Exception as error:
            raise GarminError("Garmin did not accept the code") from error
        self.pending.pop(rider_id, None)
        self._save(rider_id, api)
        return "ok"

    def _save(self, rider_id: str, api) -> None:
        folder = self.tokens_dir(rider_id)
        api.client.dump(str(folder))
        self.clients[rider_id] = api
        log.info("garmin connected for a rider")

    def disconnect(self, rider_id: str) -> None:
        self.clients.pop(rider_id, None)
        self.pending.pop(rider_id, None)
        folder = self.tokens_dir(rider_id)
        if folder.is_dir():
            for path in folder.iterdir():
                path.unlink()
            folder.rmdir()

    def _client(self, rider_id: str):
        if rider_id not in self.clients:
            api = self.factory()
            try:
                api.login(str(self.tokens_dir(rider_id)))
            except Exception as error:
                raise GarminError("Garmin login with the saved tokens failed") from error
            self.clients[rider_id] = api
        return self.clients[rider_id]

    def upload(self, rider_id: str, content: bytes) -> dict:
        """Upload a FIT file. Blocking: call from a worker thread."""
        with self.lock, tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "auuki.fit"
            path.write_bytes(content)
            api = self._client(rider_id)
            try:
                api.upload_activity(str(path))
            except Exception as error:
                if "409" in str(error):
                    # Garmin answers 409 Conflict for an activity it already has
                    return {"duplicate": True}
                # tokens may have expired: log in again on the next upload
                self.clients.pop(rider_id, None)
                raise GarminError("Garmin upload failed") from error
        log.info("garmin upload ok")
        return {"duplicate": False}
