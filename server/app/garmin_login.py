"""One-time interactive Garmin login that saves OAuth tokens.

    cd server && .venv/bin/python -m app.garmin_login
    docker compose run --rm -it auuki python -m app.garmin_login

Uses GARMIN_EMAIL / GARMIN_PASSWORD from the environment or server/.env, or asks.
The password is not stored; only the tokens in GARMIN_TOKENSTORE are.
"""
import getpass
import sys

from garminconnect import Garmin

from .config import Settings


def main() -> int:
    settings = Settings.from_env()
    email = settings.garmin_email or input("Garmin email: ").strip()
    password = settings.garmin_password or getpass.getpass("Garmin password: ")

    api = Garmin(email, password, prompt_mfa=lambda: input("Garmin MFA code: ").strip())
    api.login(settings.garmin_tokenstore)
    print(f"Logged in. Tokens saved to {settings.garmin_tokenstore}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
