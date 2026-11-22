# Auuki home server

A small FastAPI app that replaces api.auuki.com for a single rider. It also
serves the built PWA, so the app and the API share one origin and need no CORS.

- **Intervals.icu** with your personal API key: planned workouts (as .zwo), athlete
  FTP/weight, and activity upload.
- **Garmin Connect** activity upload through the unofficial
  [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) package.
- No accounts. Anyone who can reach the server can use it, so it binds to
  `127.0.0.1` only.

## Setup

```bash
cp server/.env.example server/.env      # add INTERVALS_API_KEY, INTERVALS_ATHLETE_ID
```

Garmin (optional). Do the one-time login, which can ask for an MFA code and saves
tokens:

```bash
cd server && .venv/bin/python -m app.garmin_login          # local
docker compose run --rm -it auuki python -m app.garmin_login  # container
```

After that, the email and password can be removed from `.env`.

## Run

Container (app + API on http://localhost:8080):

```bash
docker compose up -d --build
```

Local development:

```bash
python3.12 -m venv server/.venv && server/.venv/bin/pip install -r server/requirements-dev.txt
cd server && .venv/bin/uvicorn app.main:create_app --factory --port 8080   # API (+ ../dist)
npm start                                                             # PWA on :1234, /api proxied to :8080
```

## Test

```bash
cd server && .venv/bin/python -m pytest
```

Intervals.icu and Garmin are mocked in the tests.

## Endpoints (the subset of the api.auuki.com contract the PWA uses)

| Endpoint | Behaviour |
|---|---|
| `POST /api/rpc` `status_handler` | Logged in as `home`. `intervals` / `garmin` are true when configured. |
| `POST /api/intervals/events?oldest&newest` | `GET /api/v1/athlete/{id}/events.json?category=WORKOUT&ext=zwo` |
| `POST /api/intervals/athlete` | `GET /api/v1/athlete/{id}` |
| `POST /api/intervals/upload` (multipart `file`, `name`) | `POST /api/v1/athlete/{id}/activities` |
| `POST /api/garmin/upload` (multipart `file`) | Garmin Connect upload. A duplicate (409) counts as success. |
| `/api/intervals/oauth/code`, `/deauthorize` | No-op 200 |
| any other `/api/*` (accounts, Strava, TrainingPeaks) | 404 |

Errors: when a service isn't configured the server returns 503, and when the upstream
service fails it returns 502. It never returns 403, because the PWA treats 403 as
"show the login form".
