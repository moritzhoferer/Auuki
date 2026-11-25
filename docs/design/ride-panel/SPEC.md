# Ride panel – split-view design spec

Design reference for the narrow Auuki panel used next to a streaming video (Brave split view).
Mockup: `ride-panel-mockup.html` (open in a browser, mock data) and `ride-panel-mockup.png`.
The mockup is a **visual reference, not code to copy**. Implement it with Auuki's existing patterns
(Web Components, `xf` events, `db`, existing CSS).

## Context
- Panel ≈ 400 × 880 CSS px (right side of a MacBook screen in split view), dark theme.
- The rider glances at it from ~1 m while watching video, so it must work in peripheral vision.
- Rider prefers **slope mode** and paces himself; the target range comes from the workout file.

## Layout (top → bottom)
1. **Header**: sensor icons + workout name (the name appears only here).
   - Show all 7 Auuki device types in fixed order: trainer, HRM, power meter, speed/cadence,
     SmO2, core temp, controller (Open Bike Control).
   - Connected = light grey `#e6e8eb`; not connected = muted `#4a4f58`. Never green
     (green is reserved for "in range"). Later: searching = grey + blinking.
2. **Interval block**: `EFFORT 2 / 3` + `12:18 / 20:00` (elapsed/duration), big countdown
   `07:42 left` (label on the number's baseline), thin progress bar.
   - Countdown turns amber only in the **last 5 s** of an interval.
3. **Pacing box** (the only place with status colour):
   - Status line: `● IN RANGE · hold it` / `▲ TOO HIGH · ease off` / `▼ SLIGHTLY LOW · push`.
     No watt deltas, no +/- signs (they read like instructions).
   - Big 3 s power (96 px), coloured by status. Border + light background tint in status colour.
   - **Range gauge** (horizontal bar): range values (e.g. 246 / 263) **above** the bar, centred on
     white tick marks at the green/amber boundaries. Range is shown **only here**.
     White needle = 3 s power; diamond below the bar = interval average (coloured by its status).
4. **Two tiles**: interval average (status-coloured) and time in range (%).
5. **Up next**: only the next interval (name, duration, target). No "in mm:ss" (already shown
   above), no preview of the interval after next. Border turns amber in the last 5 s.
6. **Workout profile**: blocks scaled by target intensity; **progress fill** (ridden = light
   `#8a94a6`, remaining = dark `#343840`, current block split at "now"), thin white 2 px position
   line, recorded power as a blue line (`#9ab4ff`, smoothed ~10 s) on top.
   Below: `0:47:18 elapsed` (left) and `0:42:42 left` (right). Whole-workout info lives only here.
7. **Live values**: heart rate, cadence (neutral white, no colour).
8. **Controls**: ERG / RES / SLOPE segmented control, pause, skip; stepper `− 1.0 % +`
   (unit only; mode is clear from the active button). Touch targets ≥ 44 px.

Removed on purpose: 10 s power, speed, distance, live instant-power graph, duplicate elapsed,
duplicate target range, duplicate workout name.

## Status logic
- `in`: lo ≤ p ≤ hi → green `#3fd37f`
- `near`: outside range by ≤ tolerance → amber `#f6b73c`
- `out`: beyond tolerance → red `#ff5d52`
- Tolerance default **7 % FTP** (setting). lo/hi come from the workout step (PowerLow/PowerHigh).
- Single-value targets (no range in the file): treat as lo = hi = target (or a small default band –
  open question).

## Gauge scale (non-linear, "zoomed")
Fixed widths: red 15 % | amber 15 % | green 40 % | amber 15 % | red 15 %.
Piecewise-linear in watts within each zone; zone edges at
`lo−3·tol, lo−tol, lo, hi, hi+tol, hi+3·tol` (needle clamps at the ends).

## Data available in Auuki (verify)
- `db.power3s` (3 s power), `db.powerLap` (interval average), `lapTime` = **remaining** time in interval.
- Targets: `src/workouts/zwo.js` currently averages PowerLow/PowerHigh into one `Power` →
  must keep the range (first change, upstream-worthy).
- Device types: `src/ble/devices.js`.

## Open questions
- HR-target workouts: same layout, HR replaces power in needle/number/bar.
- Recovery intervals with single targets: show range bar or a simpler display?