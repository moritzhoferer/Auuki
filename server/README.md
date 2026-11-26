# Auuki home server

A small FastAPI app for a home network. It replaces api.auuki.com and also serves the
built PWA, so the app and the API share one origin and need no CORS.

- **Riders**: a "Who's riding?" list, each with an optional 4–8 digit PIN. A signed
  session cookie remembers the rider on that device. Changing the PIN, or "Log out
  everywhere", ends the sessions on all other devices.
- **Intervals.icu** with each rider's own API key: planned workouts (as .zwo), FTP
  and weight, and activity upload.
- **Garmin Connect** upload, FTP and weight through the unofficial
  [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) package. The
  password is used once to log in and is never stored. Only the tokens are kept.
- **Rides** are stored per rider as FIT files.

Everything lives in `DATA_DIR` (default `server/data`, in the container `/data`):

```
secret.key                 cookie signing key, created on first start
profiles.json              riders, PIN hashes, Intervals.icu keys (0600)
pin_failures.json          wrong-PIN counters and locks, kept across restarts
garmin/<rider>/            Garmin tokens (0700 / 0600)
rides/<rider>/index.json   ride summaries and upload status
rides/<rider>/<id>.fit
```

Keys and tokens are never returned to the browser.

## Setup

```bash
cp server/.env.example server/.env      # optional: DATA_DIR, COOKIE_SECURE, STATIC_DIR
```

Riders, Intervals.icu and Garmin are set up in the app (first start: "Add a rider").

## Run

Container (app + API on http://localhost:8080):

```bash
docker compose up -d --build
```

By default it listens on 127.0.0.1 only. Web Bluetooth only works in a secure
context, so other devices need HTTPS. Use 6-digit PINs once other devices can reach
the server.

### HTTPS on the home network (Caddy + DuckDNS)

The `https` profile adds Caddy (`caddy/`) in front of the app. It gets a Let's
Encrypt certificate for a free DuckDNS name through the DNS-01 challenge, so no
router ports are opened and the app stays reachable from the home network only.
The name and its LAN IP are public in DNS and in Certificate Transparency logs; the
page is not.

1. Log in at https://www.duckdns.org, add a subdomain (`your-subdomain`), set its IP
   to the server's LAN IP and copy the token.
2. `cp .env.example .env` next to `compose.yaml` and fill in `AUUKI_HOST`
   (`your-subdomain.duckdns.org`) and `DUCKDNS_API_TOKEN`.
3. Optional, if you run a local DNS server (Pi-hole, AdGuard Home, router): add a
   record `your-subdomain.duckdns.org` -> the server's LAN IP. Routers with DNS
   rebinding protection block public names that point at private IPs; the local
   record avoids that.
4. Port 443 must be free on the host (`sudo ss -tlnp | grep ':443 '`). If another
   service uses it, move that service, or set `HTTPS_PORT=8443` in `.env` and use
   `https://your-subdomain.duckdns.org:8443`. Pi-hole v6, for example, serves its web
   UI on 80/443; `sudo pihole-FTL --config webserver.port '8081o,[::]:8081o'` moves it.
5. `docker compose up -d` (with `COMPOSE_PROFILES=https` in `.env`). The first
   certificate takes a minute: `docker compose logs -f caddy` shows
   `certificate obtained successfully`.

Caddy renews the certificate on its own; it is kept in the `caddy-data` volume.
`FORWARDED_ALLOW_IPS=*` (set in `compose.yaml`) lets uvicorn trust Caddy's
`X-Forwarded-Proto`, so the session cookie is marked `Secure` behind the proxy.
`COOKIE_SECURE=true` forces that too.

Building on a small server (e.g. a single-board computer with 1 GB RAM) is slow and
can run out of memory. Build on another machine for the server's platform
(`uname -m` on the server: `aarch64` -> `linux/arm64`, `x86_64` -> `linux/amd64`)
and copy the images:

```bash
COMPOSE_PROFILES=https DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose build
docker save auuki-home auuki-caddy | ssh <user>@<server> docker load
# on the server, next to compose.yaml and .env:
docker compose up -d --no-build
```

Local development:

```bash
cd server && uv sync                                                   # .venv from uv.lock
uv run uvicorn app.main:create_app --factory --port 8080              # API (+ ../dist)
npm start                                                             # PWA on :1234, /api proxied to :8080
```

## Dependencies

Managed with [uv](https://docs.astral.sh/uv/): `pyproject.toml` + `uv.lock`.
Add or upgrade with `uv add <pkg>==<ver>` / `uv lock --upgrade-package <pkg>`, never pip.

## Test

```bash
cd server && uv run pytest
```

Intervals.icu and Garmin are mocked in the tests.

## Endpoints

All JSON. Errors are `{"error": {"message": CODE}}`.

| Endpoint | Behaviour |
|---|---|
| `GET /api/riders` | `[{id, name, hasPin}]` |
| `POST /api/riders` `{name, pin?}` | Create a rider and log in |
| `POST /api/session` `{riderId, pin?}` | Log in. 403 `WRONG_PIN`, 429 `TOO_MANY_TRIES` (every 5 wrong PINs lock for 1 min, doubling each round, max 1 h) |
| `DELETE /api/session` | Log out |
| `DELETE /api/sessions` | Log out on every device |
| `GET / PATCH / DELETE /api/me` | Current rider `{id, name, hasPin, ftp, weight, bodySource, bodySyncedAt, intervals:{connected, athleteId}, garmin:{connected}}`. PATCH: `name, pin, removePin, ftp, weight` |
| `PUT /api/me/intervals` `{apiKey, athleteId}` | Check the key and save it. Returns `{me, athlete:{ftp, weight}}` |
| `GET /api/me/intervals/events?oldest&newest` | Planned workouts with `workout_file_base64` |
| `DELETE /api/me/intervals` | Forget the key |
| `POST /api/me/garmin` `{email, password}` | `{status: 'ok' \| 'mfa', me}` |
| `POST /api/me/garmin/mfa` `{code}` | Finish an MFA login (within 5 min) |
| `DELETE /api/me/garmin` | Delete the tokens |
| `PUT /api/me/body-source` `{source}` | `manual \| intervals \| garmin`: where FTP and weight come from. Returns the rider; when not manual the values are fetched first. Disconnecting that account resets it to manual |
| `POST /api/me/body/sync` | Fetch FTP and weight again from the chosen source (the app calls it after login). Returns the rider |
| `GET /api/me/rides` | Ride summaries, newest first |
| `POST /api/me/rides` (multipart `file`, `summary` JSON) | Store a ride (max 20 MB) |
| `GET /api/me/rides/{id}/file`, `DELETE /api/me/rides/{id}` | Download or delete |
| `POST /api/me/rides/{id}/upload/garmin` | Upload. A duplicate (409 from Garmin) counts as success |
| any other `/api/*` | 404 |

401 `NOT_LOGGED_IN` means "show Who's riding?". 409 `*_NOT_CONNECTED` means the
account isn't set up. 502 means the upstream service failed.
