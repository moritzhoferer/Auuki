# CLAUDE.md

Personal fork of [Auuki](https://github.com/dvmarinoff/Auuki): a browser PWA for
structured indoor cycling workouts. It uses Web Bluetooth/ANT+, vanilla JS Web
Components and no framework. It is bundled with Parcel and tested with Jest.

## Run / build / test

```bash
npm install          # uses package.json as is; ask before adding deps
npm start            # parcel dev server, http://localhost:1234 (secure context -> Web BLE ok)
npm run build        # -> dist/
npx jest test/workouts test/models   # fast, relevant suites
npm test             # full suite
cd server && uv sync && uv run pytest   # home only: Python env via uv (pyproject + uv.lock), never pip
```

Baseline on upstream/develop @ 3442b6a (2026-11-22): 461 pass, 50 fail, 11 skipped
(home with all feat branches incl. ride panel: 528 pass, same 50 fail; server: 24 pytest).
Redesign (branch `redesign`, merged into `home`; old views and their tests deleted):
521 pass, 20 fail, 11 skipped; server: 37 pytest.
Ride grid (branch `ride-grid`, merged into `home`): 546 pass, same 20 fail, 11 skipped.
The failures already exist upstream. They come from stale tests that import moved or
removed modules (`src/ble/uuids.js`, `src/fit/activity.js`, `src/fit/profiles.js`, ...)
and from jsdom gaps (`idb.test.js`). Don't fix them unless asked. Compare against this
baseline instead.

Web Bluetooth and trainer behaviour can't be tested here. Write down exact on-bike
steps for the user.

## Architecture

```
src/index.js        entry: imports db, app, views, ble, watch, course, lock; dispatches 'app:start'
src/functions.js    xf event system + small FP helpers (exists, existance, equals, first, ...)
src/db.js           single app state object (Proxy) + all reducers (xf.reg); 'app:ready' at the end
src/app.js          (home) controller: riders/login, accounts, planned, rides, ride flow, screens
src/models/         plain classes/closures: validation, persistence, domain logic
  models.js         Model/Target base classes, PropInterval (power1s/power3s), Workout, Session, ...
  server.js         (home) fetch client for server/ (never throws, 401 -> 'server:logged-out')
  sensors.js        the 8 sensor types: id, label, icon, ble/ant source, metrics
  fields.js         ride tiles: label, unit, format, which sensors provide it
  rides.js          encode/summarize/save a ride (server, IDB fallback), flush pending
  profile.js range.js   workout profile blocks, pacing range and gauge math
src/views/          Custom Elements, light DOM, markup in index.html
  ui.js             UIView base, [data-action] clicks, <ui-tooltip>, screens and sheets
  tiles.js sensors.js workouts.js rides.js riders.js screens.js ride.js editor.js keyboard.js
  graph.js          only the line simplifier for course import
src/watch.js        workout timer: walks intervals/steps, sets targets per step
src/workouts/zwo.js .zwo <-> internal workout format
src/ble/ src/ant/   device protocols (FTMS, FE-C over BLE, CPS, HRS, ...)
src/fit/            FIT encode/decode (activity export, course import)
src/css/app.css     all styles; dark tokens on :root, mobile first, wide >= 760px
src/sw.js           service worker. Registration is commented out in index.js on develop.
```

### xf event system (`src/functions.js`)

All communication goes through `window` CustomEvents:

- `xf.dispatch(name, value)` fires an event.
- `xf.reg(name, (value, db) => ...)` is a reducer that receives the db Proxy. Mutate
  db here.
- `xf.sub(name, handler, {signal})` subscribes. For `db:<prop>` events the handler
  gets `db[prop]`, otherwise it gets the raw value. Views pass an AbortController
  signal and abort it in `disconnectedCallback`.
- `xf.create(db)` wraps db in a Proxy. **Every assignment `db.x = v` dispatches
  `db:x`.** That is how views react. Reassign (`db.list = db.list`) to force an update.

Naming conventions: `ui:*` are user intents (`ui:power-target-set`, `ui:mode-set`,
`ui:ride:start`, `ui:rider:pick`). `watch:*` are timer outputs. `ble:*`/`ant:*` come
from devices. Results from app.js: `rider:login-failed`, `account:error`,
`intervals:connected`, `garmin:mfa`, `rider:saved`.

### db (`src/db.js`)

Selected state:

- `power`: raw. `power1s` is a 1 s mean. `power3s` is a **3 s block mean emitted every
  3 s**, not a rolling average (`PropInterval`).
- `powerLap` is the running average of the current interval (lap). `powerAvg` covers
  the whole session.
- `powerTarget` is in watts. `slopeTarget` is in %. `resistanceTarget`. `cadenceTarget`.
- `mode` is `erg | resistance | sim`. It is the user's choice, saved in localStorage
  (`feat/keep-user-mode`). Workouts never change it. Only starting a course switches
  to sim. The old mode lock was removed.
- `elapsed`. `lapTime` is the **remaining** time in the current interval. `stepTime`
  is the remaining time in the step. `intervalIndex`, `stepIndex`.
- `workout` holds `{meta, intervals: [{duration, steps: [{duration, power, slope?,
  cadence?, distance?, messages?}]}]}`. Step `power` is a fraction of FTP (0.75), and
  `models.ftp.toAbsolute(p, ftp)` converts it to watts.
- (redesign) `screen` (loading, riders, setup, start, library, ready, ride, summary,
  rides, settings, editor), `sheet` ('' | sensors | finish), `rideKind` (workout | free),
  `notice`, `rider` (from the server, never holds keys), `riders`, `rides`, `ride`,
  `planned`, `plannedStatus`, `sensors` (`{trainer: {status, name, battery, via}, ...}`),
  `antDriver`. FTP and weight come from the rider on the server; mode, tolerance,
  volume, units and sources stay in localStorage (per device).
- (redesign) `rider.bodySource` is `manual | intervals | garmin`, `rider.bodySyncedAt` the
  unix time of the last fetch. app.js fetches again on start, on login and when the
  page becomes visible after more than 6 h (never during a ride).

### watch.js: targets per step

`watch:stepIndex` reads the current step:

- If the step has `slope`, it sets `slopeTarget`.
- If it has `power`, it sets `powerTarget` (watts). Otherwise it sets 0.
- It sets `cadenceTarget` to the step cadence, or 0.
- It never changes `mode` (on `home`, via `feat/keep-user-mode`). Upstream switches to
  sim or erg here.

### Views

(redesign) Views subclass `UIView` (`views/ui.js`): `props()` lists db keys, `config()`
runs once, `render()` runs at most once per frame. `config()` runs **before** `props()`,
so per-instance setup that `props()` needs (like `MetricTile`'s field) goes in `config()`. Views created after start copy their
props from the db. Buttons are real `<button>`s with
`data-action="x" data-param="y"` (-> `ui:x`), `data-pressed="prop:value"` for
aria-pressed, and an `aria-label` or `data-tip`, which `<ui-tooltip>` shows on hover,
keyboard focus and long-press. Screens are `<section class="screen" data-screen>` in
`src/index.html`, sheets are `<dialog class="sheet" data-sheet>`. Icons:
`icon(name)` -> `<use href="#icon-NAME">` from the sprite at the end of index.html.
New UI: a custom element plus markup in index.html plus styles in app.css.
UI conventions: every button is 44 px high; lists of things to connect (sensors,
accounts) use `.sensor-row` (icon, name, status, button on the right); check layouts at
400 px wide without horizontal scroll. README screenshots are in `doc/images/home/`, taken
from a demo rider with simulated sensor data (never real rider data).

### .zwo parsing (`src/workouts/zwo.js`)

Each `Elements.<Tag>` has `read` (attributes -> object), `toInterval` (-> internal
interval) and `fromInterval` (internal -> attributes, used by the editor/export).
`Step()` copies attributes with lower-cased names. SteadyState currently averages
`CadenceLow/CadenceHigh` into `cadence` (upstream PR #298). For power, `feat/zwo-power-range`
keeps `step.powerLow/powerHigh` (FTP fractions) next to `step.power` (the midpoint,
used for ERG). TextEvents without `timeoffset` are dropped today (known issue).

## Backend contract

`home`/`redesign` use the self-hosted server in `server/` (riders with PIN, per-rider
Intervals.icu key and Garmin tokens, rides as FIT). Its endpoints are listed in
`server/README.md`; `src/models/server.js` is the client. The table below is the
upstream api.auuki.com contract, kept for reference (feat branches still use it).

### api.auuki.com (upstream server is closed-source)

The upstream server code isn't public. Shapes below are inferred from the client.
All calls are `POST` with `credentials: 'include'`, against `config.API_URI`.
api.auuki.com only sends CORS headers for `Origin: https://auuki.com`, so a
self-hosted origin can't use it.

| Endpoint | Request | Response the client relies on |
|---|---|---|
| `/api/rpc` | JSON `{id, method:'status_handler', params:{data:{}}}` | 200 `{result:{identifier, services:{strava, intervals, trainingPeaks} /*OAuth client ids*/, strava:bool, intervals:bool, trainingPeaks:bool}}`. `result` is merged into `db.services`. 403 means logged out. 405/500 or a network error means `:no-api` |
| `/api/intervals/events?oldest&newest` | (ISO dates, current week Mon-Sun) | JSON array of Intervals.icu events. Client keeps items with `workout_file_base64` and uses `id`, `start_date_local`, `atob(workout_file_base64)` -> .zwo |
| `/api/intervals/athlete` | none | Intervals athlete JSON: `weight`/`icu_weight`, `sportSettings[{types[], ftp, indoor_ftp}]` |
| `/api/intervals/upload` | multipart `file` (FIT blob), `name` | only `response.ok`. 403 opens login |
| `/api/intervals/oauth/code?state&code&scope` | none | ignored (text) |
| `/api/intervals/deauthorize` | none | `ok` -> `services.intervals=false` |
| `/api/strava/oauth/code`, `/upload`, `/deauthorize` | same as intervals | same |
| `/api/register`, `/login` | JSON | `{result:{success:true}}` or `{error:{message}}` |
| `/api/logout` | JSON `{logout:true}` | `{result:{logout:true}}` |
| `/api/verify-email`, `/forgot-password`, `/reset-password`, `/account/delete` | JSON | `{result:{success}}` / `{error:{message}}` |
| `/api/trainingpeaks/*` | switched off upstream | ignore |

Intervals.icu API (checked against `https://intervals.icu/api/v1/docs`, 2026-11-22).
Auth is Basic `API_KEY:<key>`.
- `GET /api/v1/athlete/{id}/events.json?oldest&newest&category=WORKOUT&ext=zwo` adds
  `workout_filename` and `workout_file_base64`. There is also `resolve` and `powerRange`
  (outdoor only).
- `GET /api/v1/athlete/{id}` returns the athlete with `sportSettings`.
- `POST /api/v1/athlete/{id}/activities?name=...` takes a multipart `file` (FIT).

## Branch model

- Remotes: `origin` = moritzhoferer/Auuki (fork), `upstream` = dvmarinoff/Auuki.
- `master`, `develop` are untouched mirrors of upstream. Never commit there.
- `feat/<name>` is branched from `upstream/develop`. Each one holds ONE upstream-worthy
  frontend change (a candidate PR). No server code, never merge `home` into it.
- `home` is the personal integration branch: upstream/develop + merged feat branches
  + personal-only bits (`server/`, Dockerfile, compose.yaml, same-origin `API_URI`,
  account UI hidden). Update it by merging `upstream/develop` and the feat branches.

## Rules for agents

- Ask before design/product decisions and before adding or upgrading dependencies.
- Never commit, push, open PRs or touch GitHub without asking. Use Conventional
  Commits (`feat(zwo): …`, `fix(ui): …`, `chore(home): …`).
- Keep diffs small and upstream-style (vanilla JS, Web Components, existing CSS). No
  drive-by refactors.
- Secrets live only in `server/.env` (gitignored). Never log or commit API keys or
  tokens.
