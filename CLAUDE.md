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
```

Baseline on upstream/develop @ 3442b6a (2026-11-22): 461 pass, 50 fail, 11 skipped
(home with all feat branches incl. ride panel: 528 pass, same 50 fail; server: 24 pytest).
The failures already exist upstream. They come from stale tests that import moved or
removed modules (`src/ble/uuids.js`, `src/fit/activity.js`, `src/fit/profiles.js`, ...)
and from jsdom gaps (`watch.test.js`, `moxy-graph.test.js`, `idb.test.js`). Don't fix
them unless asked. Compare against this baseline instead.

Web Bluetooth and trainer behaviour can't be tested here. Write down exact on-bike
steps for the user.

## Architecture

```
src/index.js        entry: imports db, views, ble, watch, course, lock; dispatches 'app:start'
src/functions.js    xf event system + small FP helpers (exists, existance, equals, first, ...)
src/db.js           single app state object (Proxy) + all reducers (xf.reg)
src/models/         plain classes/closures: validation, persistence, domain logic
  models.js         Model/Target base classes, PropInterval (power1s/power3s), Workout,
                    Planned (Intervals/TP calendar), Activity, DockMode, ...
  config.js         API_URI, PWA_URI, OAuth client ids (filled from status_handler)
  api.js auth.js intervals.js strava.js training-peaks.js   backend client
src/views/          Custom Elements (Web Components), mostly light DOM, markup in index.html
  data-views.js     DataView base class + most tiles (power, targets, timers, ...)
  workout-graph*.js workout profile rendering
src/watch.js        workout timer: walks intervals/steps, sets targets per step
src/workouts/zwo.js .zwo <-> internal workout format
src/ble/ src/ant/   device protocols (FTMS, FE-C over BLE, CPS, HRS, ...)
src/fit/            FIT encode/decode (activity export, course import)
src/css/flux.css    all styles; media queries are min-width based (>=1024px etc.)
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

Naming conventions: `ui:*` are user intents (`ui:power-target-set`, `ui:mode-set`).
`watch:*` are timer outputs. `action:*` are UI state machines (auth, planned list).
`ble:*`/`ant:*` come from devices. `services` / `account` carry backend status.

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
- `services` is `{strava, intervals, trainingPeaks}` booleans.

### watch.js: targets per step

`watch:stepIndex` reads the current step:

- If the step has `slope`, it sets `slopeTarget`.
- If it has `power`, it sets `powerTarget` (watts). Otherwise it sets 0.
- It sets `cadenceTarget` to the step cadence, or 0.
- It never changes `mode` (on `home`, via `feat/keep-user-mode`). Upstream switches to
  sim or erg here.

### Views

Most tiles subclass `DataView` (`prop` attribute = `db:<key>`). They override
`getDefaults/config/subs/getValue/shouldUpdate/transform/render`. Markup lives in
`src/index.html` (home page `#home-page`, `z-stack` switches tile contents on tap).
New UI should follow that pattern: a custom element plus markup in index.html plus
styles in flux.css.

### .zwo parsing (`src/workouts/zwo.js`)

Each `Elements.<Tag>` has `read` (attributes -> object), `toInterval` (-> internal
interval) and `fromInterval` (internal -> attributes, used by the editor/export).
`Step()` copies attributes with lower-cased names. SteadyState currently averages
`CadenceLow/CadenceHigh` into `cadence` (upstream PR #298). For power, `feat/zwo-power-range`
keeps `step.powerLow/powerHigh` (FTP fractions) next to `step.power` (the midpoint,
used for ERG). TextEvents without `timeoffset` are dropped today (known issue).

## Backend contract (api.auuki.com; upstream server is closed-source)

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
