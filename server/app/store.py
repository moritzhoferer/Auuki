"""Riders and their rides, kept as files in DATA_DIR.

    DATA_DIR/secret.key              signs the session cookie
    DATA_DIR/profiles.json           riders, incl. their Intervals.icu API key (0600)
    DATA_DIR/pin_failures.json       wrong-PIN counters and lock times, survive restarts
    DATA_DIR/garmin/<rider>/         Garmin tokens (written by garminconnect)
    DATA_DIR/rides/<rider>/          <ride>.fit + index.json with the summaries

The keys never leave the server: `public()` is what the browser sees.
"""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from pathlib import Path

SESSION_SECONDS = 180 * 24 * 3600
# every MAX_PIN_FAILURES wrong PINs in a row lock the rider, the lock doubling each
# round: 1 min, 2, 4 ... up to 1 h. A right PIN resets it.
MAX_PIN_FAILURES = 5
PIN_LOCK_SECONDS = 60
PIN_LOCK_MAX_SECONDS = 3600

RIDE_FIELDS = {
    "name": str, "timestamp": int, "duration": int, "distance": float,
    "power": int, "heartRate": int, "cadence": int, "kcal": int, "ftp": int,
}
UPLOAD_SERVICES = ("garmin", "intervals")


def _write_json(path: Path, data) -> None:
    """Atomic write with owner-only permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def _read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def check_pin(pin: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    candidate = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(candidate.hex(), digest)


def valid_id(value: str) -> bool:
    return bool(value) and len(value) <= 40 and all(c.isalnum() or c in "-_" for c in value)


class Store:
    def __init__(self, data_dir: str):
        self.root = Path(data_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.secret = self._secret()

    # --- session cookie --------------------------------------------------------

    def _secret(self) -> bytes:
        path = self.root / "secret.key"
        if not path.exists():
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(secrets.token_hex(32))
        return bytes.fromhex(path.read_text().strip())

    def _sign(self, payload: str) -> str:
        return hmac.new(self.secret, payload.encode(), hashlib.sha256).hexdigest()

    def session_token(self, rider: dict) -> str:
        """rider.version.expires.signature; bumping the rider's sessionVersion voids it."""
        payload = f"{rider['id']}.{rider.get('sessionVersion', 0)}.{int(time.time()) + SESSION_SECONDS}"
        return f"{payload}.{self._sign(payload)}"

    def session_rider(self, token: str | None) -> dict | None:
        if not token or token.count(".") != 3:
            return None
        rider_id, version, expires, signature = token.split(".")
        if not hmac.compare_digest(self._sign(f"{rider_id}.{version}.{expires}"), signature):
            return None
        if not expires.isdigit() or int(expires) < time.time():
            return None
        rider = self.get(rider_id)
        if rider is None or version != str(rider.get("sessionVersion", 0)):
            return None
        return rider

    def end_sessions(self, rider_id: str) -> dict:
        """Log the rider out on every device."""
        with self.lock:
            riders = self._riders()
            rider = next(r for r in riders if r["id"] == rider_id)
            rider["sessionVersion"] = rider.get("sessionVersion", 0) + 1
            self._save(riders)
        return rider

    # --- riders ----------------------------------------------------------------

    @property
    def _profiles_path(self) -> Path:
        return self.root / "profiles.json"

    def _riders(self) -> list[dict]:
        return _read_json(self._profiles_path, [])

    def _save(self, riders: list[dict]) -> None:
        _write_json(self._profiles_path, riders)

    def overview(self) -> list[dict]:
        return [{"id": r["id"], "name": r["name"], "hasPin": bool(r.get("pin"))} for r in self._riders()]

    def get(self, rider_id: str) -> dict | None:
        return next((r for r in self._riders() if r["id"] == rider_id), None)

    def create(self, name: str, pin: str | None) -> dict:
        rider = {
            "id": secrets.token_hex(6),
            "name": name,
            "pin": hash_pin(pin) if pin else None,
            "created": int(time.time()),
            "ftp": 200,
            "weight": 75,
            "intervals": None,
        }
        with self.lock:
            riders = self._riders()
            riders.append(rider)
            self._save(riders)
        return rider

    def update(self, rider_id: str, **changes) -> dict:
        with self.lock:
            riders = self._riders()
            rider = next(r for r in riders if r["id"] == rider_id)
            rider.update(changes)
            self._save(riders)
        return rider

    def delete(self, rider_id: str) -> None:
        with self.lock:
            self._save([r for r in self._riders() if r["id"] != rider_id])
            self._clear_failures(rider_id)
        for folder in (self.garmin_dir(rider_id), self.rides_dir(rider_id)):
            if folder.is_dir():
                for path in sorted(folder.rglob("*"), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()
                folder.rmdir()

    def login(self, rider_id: str, pin: str | None) -> dict | None:
        """The rider if the PIN fits (or none is set). Locks after repeated failures."""
        rider = self.get(rider_id)
        if rider is None:
            return None
        if not rider.get("pin"):
            return rider
        if self.locked_for(rider_id) > 0:
            raise PermissionError("locked")
        if pin and check_pin(pin, rider["pin"]):
            with self.lock:
                self._clear_failures(rider_id)
            return rider
        with self.lock:
            failures = self._failures()
            entry = failures.get(rider_id, {"count": 0, "until": 0})
            entry["count"] += 1
            if entry["count"] % MAX_PIN_FAILURES == 0:
                rounds = entry["count"] // MAX_PIN_FAILURES
                lock = min(PIN_LOCK_SECONDS * 2 ** (rounds - 1), PIN_LOCK_MAX_SECONDS)
                entry["until"] = time.time() + lock
            failures[rider_id] = entry
            _write_json(self._failures_path, failures)
        return None

    # --- wrong-PIN counters, kept in DATA_DIR so a restart doesn't reset them -------

    @property
    def _failures_path(self) -> Path:
        return self.root / "pin_failures.json"

    def _failures(self) -> dict[str, dict]:
        return _read_json(self._failures_path, {})

    def _clear_failures(self, rider_id: str) -> None:
        """Caller holds self.lock."""
        failures = self._failures()
        if failures.pop(rider_id, None) is not None:
            _write_json(self._failures_path, failures)

    def locked_for(self, rider_id: str) -> int:
        """Seconds until the rider may try a PIN again, 0 when not locked."""
        until = self._failures().get(rider_id, {}).get("until", 0)
        return max(0, int(until - time.time() + 0.999))

    def public(self, rider: dict) -> dict:
        intervals = rider.get("intervals") or {}
        return {
            "id": rider["id"],
            "name": rider["name"],
            "hasPin": bool(rider.get("pin")),
            "ftp": rider.get("ftp", 200),
            "weight": rider.get("weight", 75),
            "bodySource": rider.get("bodySource", "manual"),
            "bodySyncedAt": rider.get("bodySyncedAt", 0),  # unix seconds, 0 = never
            "intervals": {
                "connected": bool(intervals.get("apiKey")),
                "athleteId": intervals.get("athleteId", ""),
            },
            "garmin": {"connected": self.garmin_connected(rider["id"])},
        }

    # --- garmin tokens -----------------------------------------------------------

    def garmin_dir(self, rider_id: str) -> Path:
        return self.root / "garmin" / rider_id

    def garmin_connected(self, rider_id: str) -> bool:
        folder = self.garmin_dir(rider_id)
        return folder.is_dir() and any(folder.iterdir())

    # --- rides -------------------------------------------------------------------

    def rides_dir(self, rider_id: str) -> Path:
        return self.root / "rides" / rider_id

    def rides(self, rider_id: str) -> list[dict]:
        rides = _read_json(self.rides_dir(rider_id) / "index.json", [])
        return sorted(rides, key=lambda r: r.get("timestamp", 0), reverse=True)

    def _save_rides(self, rider_id: str, rides: list[dict]) -> None:
        _write_json(self.rides_dir(rider_id) / "index.json", rides)

    def add_ride(self, rider_id: str, content: bytes, summary: dict, client_id: str = "") -> dict:
        """client_id is the app's ID of the recording: sent again (a retry after a lost
        answer, two tabs sending the same waiting ride) it returns the stored ride."""
        if client_id:
            with self.lock:
                stored = next((r for r in self.rides(rider_id) if r.get("clientId") == client_id), None)
            if stored is not None:
                return stored
        ride = {"id": secrets.token_hex(8)}
        if client_id:
            ride["clientId"] = client_id
        for key, kind in RIDE_FIELDS.items():
            if key in summary and summary[key] is not None:
                try:
                    ride[key] = kind(summary[key])
                except (TypeError, ValueError):
                    pass
        ride["name"] = str(ride.get("name") or "Ride")[:120]
        ride.setdefault("timestamp", int(time.time() * 1000))
        ride["uploads"] = {service: "none" for service in UPLOAD_SERVICES}

        folder = self.rides_dir(rider_id)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{ride['id']}.fit").write_bytes(content)
        with self.lock:
            rides = self.rides(rider_id)
            stored = next((r for r in rides if client_id and r.get("clientId") == client_id), None)
            if stored is not None:
                # the same recording arrived meanwhile: keep that one
                (folder / f"{ride['id']}.fit").unlink(missing_ok=True)
                return stored
            self._save_rides(rider_id, [*rides, ride])
        return ride

    def ride(self, rider_id: str, ride_id: str) -> dict | None:
        return next((r for r in self.rides(rider_id) if r["id"] == ride_id), None)

    def ride_file(self, rider_id: str, ride_id: str) -> Path | None:
        if not valid_id(ride_id) or self.ride(rider_id, ride_id) is None:
            return None
        path = self.rides_dir(rider_id) / f"{ride_id}.fit"
        return path if path.is_file() else None

    def set_upload(self, rider_id: str, ride_id: str, service: str, status: str) -> dict:
        with self.lock:
            rides = self.rides(rider_id)
            ride = next(r for r in rides if r["id"] == ride_id)
            ride.setdefault("uploads", {})[service] = status
            self._save_rides(rider_id, rides)
        return ride

    def delete_ride(self, rider_id: str, ride_id: str) -> bool:
        path = self.ride_file(rider_id, ride_id)
        if path is None:
            return False
        path.unlink()
        with self.lock:
            self._save_rides(rider_id, [r for r in self.rides(rider_id) if r["id"] != ride_id])
        return True
