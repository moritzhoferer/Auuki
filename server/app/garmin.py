"""Garmin Connect upload via the unofficial `garminconnect` package.

Login uses saved OAuth tokens (GARMIN_TOKENSTORE). The password is only needed
for the first login; run `python -m app.garmin_login` once (it can ask for MFA).
"""
import logging
import tempfile
import threading
from pathlib import Path
from typing import Callable

from .config import Settings

log = logging.getLogger(__name__)


class GarminError(Exception):
    pass


def default_factory(settings: Settings):
    from garminconnect import Garmin  # imported lazily, it is a heavy import

    return Garmin(settings.garmin_email or None, settings.garmin_password or None)


class GarminUploader:
    def __init__(self, settings: Settings, factory: Callable = default_factory):
        self.settings = settings
        self.factory = factory
        self.api = None
        self.lock = threading.Lock()

    def _client(self):
        if self.api is None:
            api = self.factory(self.settings)
            try:
                api.login(self.settings.garmin_tokenstore)
            except Exception as error:  # library raises several types
                raise GarminError(
                    "Garmin login failed. Run `python -m app.garmin_login` once."
                ) from error
            self.api = api
        return self.api

    def upload(self, content: bytes) -> dict:
        """Upload a FIT file. Blocking: call from a worker thread."""
        with self.lock, tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "auuki.fit"
            path.write_bytes(content)
            api = self._client()
            try:
                result = api.upload_activity(str(path))
            except Exception as error:
                if "409" in str(error):
                    # Garmin answers 409 Conflict for an activity it already has
                    return {"duplicate": True}
                # tokens may have expired: log in again on the next upload
                self.api = None
                raise GarminError("Garmin upload failed") from error
        log.info("garmin upload ok")
        return {"duplicate": False, "result": _jsonable(result)}


def _jsonable(value):
    if hasattr(value, "json"):
        try:
            return value.json()
        except Exception:
            return None
    return value
