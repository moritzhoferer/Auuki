# Ride panel – implementation plan

This plan covers how the ride panel in `SPEC.md` gets built inside Auuki. The mockup
is a visual reference only. Everything is built from Auuki parts: Custom Elements
(`DataView` subclasses), `xf` events, `db` fields, and `flux.css`.

Status keys: **exists** = reuse as is · **adapt** = small change or a new prop ·
**new** = new code.

## 1. Spec → Auuki mapping

### Header

| Spec | Auuki today | Status |
|---|---|---|
| Workout name | `<workout-name>` (`data-views.js`, `db:workout` → `meta.name`) | exists, needs a CSS ellipsis |
| 7 device icons in fixed order | Devices in `src/ble/devices.js`: `controllable`, `heartRateMonitor`, `powerMeter`, `speedCadenceSensor`, `smo2`, `coreTemp`, `openBikeControl`. Each one dispatches `ble:<id>:connecting / :connected / :disconnected` (`reactive-connectable.js`). ANT+ uses `ant:controllable` and `ant:hrm`. `<connection-switch>` already listens to these. | **new**: a `<device-status for="…">` icon that is lit when *either* the BLE or the ANT+ variant is connected. Colours `#e6e8eb` / `#4a4f58`. |
| "Searching" blink (later) | `:connecting` event exists | adapt (later) |

### Interval block

| Spec | Auuki today | Status |
|---|---|---|
| `EFFORT 2 / 3` | A `.zwo` file has no interval names. Intervals.icu exports a step's text (e.g. `- Press lap 30m 47-64%`) as a `<textevent>` at the start of the step. Auuki drops those events today because they have no `timeoffset`. | **decided**: the label is the interval's text event at offset 0. With no text, no label is shown. There's no guessing from intensity. Needs `feat/zwo-textevent-offset`. |
| `12:18 / 20:00` | `db.intervalDuration`, and `db.lapTime` is the **remaining** time, so elapsed = `intervalDuration − lapTime` | adapt: a new view computed from existing fields |
| Big countdown `07:42 left` | `<interval-time>` (`db:lapTime`, mm:ss) | exists, plus **new**: an amber class while `lapTime ≤ 5` |
| Progress bar | the same two fields | new, small |

### Pacing box

| Spec | Auuki today | Status |
|---|---|---|
| Big 3 s power | `<power-value prop="db:power3s">`. **But `power3s` is a 3 s block average that only updates every 3 s** (`PropInterval`, `models.js:1681`). | **adapt**: make it a rolling 3 s average updated every second |
| Status line, colours, border and tint | none | **new**: `rangeStatus(p, lo, hi, tol)` → `in / near / out` and `low / high` |
| Range gauge: lo/hi labels, white ticks, needle, interval-average diamond | none | **new**: `<range-gauge>` plus a pure `gaugePosition()` (piecewise-linear zones 15/15/40/15/15) |
| lo / hi target in W | Steps keep `powerLow` / `powerHigh` (FTP fractions) since `feat/zwo-power-range`. `watch.js` only sets `db.powerTarget`. | **adapt**: `watch:stepIndex` also sets `db.powerTargetLow` / `db.powerTargetHigh` in W |
| Tolerance (default 7 % FTP, a setting) | none | **new**: a `PowerTolerance` model (`LocalStorageItem`, like `FTP`) plus an input on the Settings page |

### Tiles

| Spec | Auuki today | Status |
|---|---|---|
| Interval avg, coloured by status | `<power-lap>` (`db:powerLap`, reset on `watch:lap`) | exists, plus a status class |
| Time in range % | none | **new**: `db.timeInRange` (per interval). Count the seconds where the rolling 3 s power is within [lo, hi] while the watch is running, and reset on `watch:lap`. |

### Up next

| Spec | Auuki today | Status |
|---|---|---|
| Next interval: name · duration · target | `db.workout.intervals[db.intervalIndex + 1]` | **new**: `<next-interval>`. It shows the label (if the file has one), the duration and `lo–hi W` (or one value), and gets an amber border while `lapTime ≤ 5`. |

### Workout profile

| Spec | Auuki today | Status |
|---|---|---|
| Blocks scaled by intensity, ridden/remaining fill, 2 px "now" line | `<workout-graph>` (`workout-graph.js`) draws zone-coloured bars with a progress overlay, sized for the wide layout | **new**: `<ride-profile>` (SVG). Restyling `workout-graph` would change the default layout. |
| Recorded power line (blue, ~10 s smoothing) | `db.records[]` holds 1 Hz records with `power` (= `power1s`) | new: drawn inside `<ride-profile>`, redrawn every ~5 s |
| `0:47:18 elapsed` / `0:42:42 left` | `db.elapsed` (`<timer-time>`), plus the workout total | elapsed exists. "Left" is new (total − elapsed time in the workout). |

### Live values and controls

| Spec | Auuki today | Status |
|---|---|---|
| Heart rate, cadence | `<heart-rate-value>`, `<cadence-value>` | exists |
| ERG / RES / SLOPE segmented control | `<tab-btn effect="mode-set">` plus the saved mode (`feat/keep-user-mode`) | exists, needs restyling |
| Pause | `ui:watchPause` / `ui:watchResume` (`views/watch.js`) | exists |
| Skip | `ui:watchLap`. During a workout this jumps to the next interval (`watch.js` `lap()`). | exists |
| Stepper `− 1.0 % +` | `<slope-target-control>`, `<power-target-control>`, `<resistance-target-control>` in `<tab-group prop="mode">` | exists, needs restyling. The unit follows the mode. |
| Touch targets ≥ 44 px | — | CSS |

### Removed in the panel (still there in the default layout)

10 s power, speed, distance, instant-power graph, `<data-tile-switch-group>`,
duplicate elapsed / target / name. These are only hidden while the panel layout is
active.

## 2. Prerequisite: keep PowerLow/PowerHigh — done

Confirmed: upstream `SteadyState.toInterval` averaged `PowerLow`/`PowerHigh` into
`Power` (`zwo.js`, same pattern as the cadence change in PR #298).

This is already implemented on **`feat/zwo-power-range` (d43bc4b)** and merged into
`home`:

- The step keeps `powerLow` / `powerHigh` (ordered).
- `power` stays the midpoint, so ERG and the existing views don't change.
- A step with only one bound stays a single target.
- `Power` together with a range keeps both.
- `fromInterval` writes `PowerLow`/`PowerHigh` back.
- There are 9 Jest tests, including a write→read round trip. Your real Intervals.icu
  Sweet Spot file parses into 5 ranged steps.

Related small fix, not yet done: `<textevent>` elements without a `timeoffset` are
dropped. Your Intervals file has "Press lap" events like that.

## 3. How the panel is switched on — decided: by width

- **The width alone decides**, with `@media (max-width: 699px)`. There's no setting.
  Wide windows keep today's layout unchanged.
- Inside the panel the layout is fluid from 320 to 699 px: number sizes use
  `clamp()`, and the profile height shrinks on short windows.
- The panel is a separate `<div id="ride-panel">` in `#home-page`, hidden by default.
  Under the media query, `#home-page-wrapper` is hidden and `#ride-panel` is shown.
  This is CSS only, so no JS layout switching.
- The panel's colours are scoped CSS variables on `#ride-panel`, so the global theme
  is untouched. The font is Auuki's Roboto with tabular numerals.
- For the upstream PR, this also changes the phone layout (< 700 px). That is the
  point of the PR, and it's stated in the PR text. If the maintainer wants it opt-in,
  a toggle is a small follow-up.

## 4. Branches, in order

Each branch starts from `upstream/develop` (or stacks on the one before when it needs
it). Each gets its own commit after your OK, and is merged into `home`.

| # | Branch | Contents | Verification |
|---|---|---|---|
| 0 | `feat/zwo-power-range` | ✅ done | Jest: 9 tests |
| 0b | `feat/zwo-textevent-offset` | A `<textevent>` without `timeoffset` counts as offset 0 (the start of its step). This is how Intervals.icu writes step text. | Jest: your file keeps "Press lap" at offset 0 of steps 1 and 3. Existing text-event tests are unchanged. |
| 1 | `feat/rolling-power` | `power3s` becomes a rolling 3 s mean, updated every 1 s (`models.js`). The existing 3 s tile benefits too. | Jest with fake timers: window, update rate, reset when power drops to 0. On the bike: the needle is smooth. |
| 2 | `feat/target-range` | `db.powerTargetLow/High` set in `watch:stepIndex`. A `PowerTolerance` model plus a Settings input. Pure functions `rangeStatus()` and `gaugePosition()`. `db.timeInRange`. | Jest: status edges (lo, hi, ±tol), gauge zone edges and clamping, time-in-range accumulate/reset. `watch.js` itself can't be loaded in Jest (Worker + `import.meta`), so the step → low/high path is checked in the browser. |
| 3 | `feat/ride-panel-layout` | The `#ride-panel` scaffold with existing views (name, countdown, 3 s power, interval avg, HR, cadence, mode, stepper, controls from section 6), and the panel CSS behind the width media query. | Screenshots: 1280 px **unchanged** compared with before. Panel at 400×880, 600×900 and 360×700 without horizontal scrolling. |
| 4 | `feat/ride-panel-pacing` | `<range-gauge>`, the pacing box (status line, colours, tint), status classes on interval avg, the time-in-range tile. | Browser: dispatch `power`/target events on `window` and screenshot the in, near-low, out-high and single-target states. Jest: render tests in jsdom for the gauge positions. |
| 5 | `feat/ride-panel-interval` | Interval block (label from the step's text event if present, elapsed/duration, countdown, progress, amber for the last 5 s) and `<next-interval>`. | Browser with a workout loaded, then skip and watch the labels and next interval. Jest: label output. |
| 6 | `feat/ride-panel-profile` | `<ride-profile>`: blocks, ridden fill, now line, recorded power line, elapsed/left. | Browser: load your Sweet Spot file, start, fake ~2 min of power, screenshot. Jest: geometry helpers. |
| 7 | `feat/device-status` | Header icons for all 7 devices, BLE or ANT+. | Browser: dispatch `ble:…:connected` and check the colours. On the bike: connect the Neo 2 and HRM, and both light up. |
| h | `home` | Merge all feat branches. | Full ride (see below). |

Every branch: `npm test` against the baseline (461 on upstream / 475 on `home`, with
the same 50 old failures), plus `npm run build`.

**Ride test at the end (you):** Brave split view, panel ~400 px, Neo 2 + HRM, SLOPE.
Load the Sweet Spot workout from file or Intervals.icu, then check:

- The needle follows the 3 s power smoothly.
- Green/amber/red match 265–275 W ± 21 W (7 % of 295).
- The countdown and the up-next card turn amber in the last 5 s.
- Skip and pause work.
- The mode never changes by itself.
- Time in range looks plausible after one block.

## 5. Decisions (2026-11-22)

1. Labels: show only when the file defines them (step text → text event at offset 0).
   Otherwise there's no label.
2. Single-value targets: green = target ±3 %, amber = a further 7 % FTP.
3. Missing controls: see the proposal in section 6.
4. Trigger: responsive to width (section 3).
5. Font: keep Roboto.
6. `power3s` becomes a rolling 3 s average.

## 6. Proposal: start/stop and navigation in the panel

Goals: no extra rows (the panel has to fit 880 px), nothing you can trigger by
accident mid-ride, and every control reachable with one tap from ~1 m.

- **Play / pause button (one slot, changes with state):**
  - Before the start it shows ▶. It starts the watch and the workout
    (`ui:watchStart` + `ui:workoutStart`, like the current start button).
  - While running it shows ❚❚ (`ui:watchPause`).
  - While paused it shows ▶ (`ui:watchResume`).
  - Auuki's existing auto-start/auto-pause settings still work, so "just pedal" also
    starts it.
- **Skip / stop button (one slot):**
  - While running it shows ⏭ (skip to the next interval, `ui:watchLap`).
  - **Only while paused** it turns into ■ Stop. Stopping is never one tap away
    mid-effort.
- **Finish sheet:** tapping ■ opens a small sheet over the controls with
  **Save ride** (primary: `ui:watchStop` then `ui:activity:save`), **Resume**, and
  **Discard** (needs a second tap to confirm). It's the same flow as today's stop/save,
  just reachable in the panel.
- **Navigation without a bottom bar:**
  - Tapping the **device icons** opens Settings → Connections, which is where you
    connect sensors.
  - Tapping the **workout name** (with a small `›`) opens the Workouts page, where you
    pick a workout.
  - The other pages keep the normal bottom menu, so Home is one tap back. On the home
    page in panel mode the bottom menu is hidden.
- **No workout loaded:** the pacing box shows only the big 3 s power, with no gauge or
  status, and the name slot says "Choose workout ›". That also works as the entry
  point.

## 7. Open questions and conflicts with Auuki (kept for reference)

1. **Panel width.** The spec says ~400 px, while earlier we talked about ~600 px.
   `Auto` switches below 700 px, so both work. Is that OK?
2. **Interval labels.** Auuki has no interval types. Proposal: an interval is an
   *effort* if its target midpoint is ≥ 75 % FTP (configurable later). Low intervals
   before the first effort are *Warm-up*, between efforts *Recovery*, after the last
   *Cool-down*. Your file gives "Warm-up, Effort 1/2, Recovery, Effort 2/2, Cool-down".
   Alternatively we could use Intervals.icu step names later via Phase 3.
3. **Single-value targets** (no range). The spec leaves this open, and earlier you
   picked green = target ±3 %. With the spec's tolerance that becomes: green = target
   ±3 %, amber = 7 % FTP beyond that. Is that OK, or lo = hi = target?
4. **Tolerance in % FTP** (spec) vs % of target (my earlier mock). I'll follow the
   spec: 7 % FTP.
5. **Missing controls.** The spec has no start, stop/save, or navigation to the
   Workouts and Settings pages, and the panel (880 px) leaves no room for the bottom
   menu. Proposal: a play button in place of pause before the start, and the existing
   bottom menu kept as a slim 44 px bar. Or: a long press on the workout name opens
   the menu.
6. **ERG mode.** The pacing box stays (the trainer holds the midpoint, so it's mostly
   green), and the stepper shows W. In RES mode the stepper shows %.
7. **No workout loaded / free ride.** There's no target, so the pacing box goes
   neutral (big 3 s power, no gauge or status), and the interval block shows the lap
   time.
8. **Fonts.** The mockup uses Inter, and Auuki uses Roboto. Loading Inter would be a
   new external font, so I'd keep Roboto with tabular numerals.
9. **Icons.** Should I reuse the mockup's 7 simple stroke icons as SVG `<symbol>`s in
   `index.html` (design assets, not mockup code), or use Auuki's existing icons?
10. **Time in range definition.** Rolling 3 s power within [lo, hi], counting only
    seconds while the watch runs, per interval. The alternative is 1 s power, which is
    stricter.
11. **HR-target workouts** (spec open question). `.zwo` and Auuki have no HR targets,
    so this is out of scope for now.
12. **`power3s` semantics change** (branch 1) also affects the 3 s tile in the
    standard layout. I think that's an improvement for upstream, but it's their call
    in the PR.
13. **Up-next target.** The spec shows one value ("140 W"). For ranged steps I'd show
    `lo–hi W`.
