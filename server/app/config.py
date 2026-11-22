"""Settings from environment variables (and server/.env when present)."""
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
    intervals_api_key: str = ""
    intervals_athlete_id: str = "0"
    intervals_base_url: str = "https://intervals.icu"
    garmin_email: str = ""
    garmin_password: str = ""
    garmin_tokenstore: str = str(Path.home() / ".garminconnect")
    static_dir: str = str(SERVER_DIR.parent / "dist")

    @property
    def intervals_enabled(self) -> bool:
        return bool(self.intervals_api_key)

    @property
    def garmin_enabled(self) -> bool:
        # tokens alone are enough once the one-time login has run
        return bool(self.garmin_email) or Path(self.garmin_tokenstore).expanduser().exists()

    @classmethod
    def from_env(cls) -> "Settings":
        load_env_file()
        defaults = cls()
        return cls(
            intervals_api_key=os.getenv("INTERVALS_API_KEY", ""),
            intervals_athlete_id=os.getenv("INTERVALS_ATHLETE_ID", "") or "0",
            intervals_base_url=os.getenv("INTERVALS_BASE_URL", defaults.intervals_base_url),
            garmin_email=os.getenv("GARMIN_EMAIL", ""),
            garmin_password=os.getenv("GARMIN_PASSWORD", ""),
            garmin_tokenstore=os.getenv("GARMIN_TOKENSTORE", defaults.garmin_tokenstore),
            static_dir=os.getenv("STATIC_DIR", defaults.static_dir),
        )
