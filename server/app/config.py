"""Settings from environment variables (and server/.env when present).

Rider accounts and their Intervals.icu / Garmin logins live in DATA_DIR, not here.
"""
import os
from dataclasses import dataclass
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent


def load_env_file(path: Path = SERVER_DIR / ".env") -> None:
    """Minimal KEY=VALUE loader. Real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Settings:
    data_dir: str = str(SERVER_DIR / "data")
    static_dir: str = str(SERVER_DIR.parent / "dist")
    intervals_base_url: str = "https://intervals.icu"
    # set when the app is served over https, so the session cookie is https only
    cookie_secure: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        load_env_file()
        defaults = cls()
        return cls(
            data_dir=os.getenv("DATA_DIR", defaults.data_dir),
            static_dir=os.getenv("STATIC_DIR", defaults.static_dir),
            intervals_base_url=os.getenv("INTERVALS_BASE_URL", defaults.intervals_base_url),
            cookie_secure=os.getenv("COOKIE_SECURE", "").lower() in ("1", "true", "yes"),
        )
