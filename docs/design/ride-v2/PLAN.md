# Ride screen v3: implementation plan

Goal: build `ride-v3-mockup.html` in the app, following `docs/design/PRINCIPLES.md`.
Work on a branch `ride-grid` cut from `home`, one commit per phase, merged into `home`
once you're happy. Every phase is checked at 400, 800 and 1440 px wide (plus 400 × 800 and
800 × 700 for the ride screen) before it's reported done. Jest must stay at the baseline
(521 pass, 20 known failures, 11 skipped).

## Phase 1: tokens (all screens)

`src/css/app.css`
- `--radius` 10 → **6 px**, `--card-pad` 14 → **10 px**, so `--radius-lg` becomes **16 px**.
- New `--unit: 64px` and `--row: 72px` (unit + gap). `--gap` 12 → **8 px**.
- Replace the hard-coded radii (8 px, 6 px, `calc(10px + var(--radius))`) with the tokens.

Every screen gets smaller corners and tighter spacing. No layout changes yet, so this
phase is checked across start, workouts, rides, settings, sheets and the ride screen.

## Phase 2: the layout rule as a tested function

New `src/models/layout.js`, pure and with no DOM:

```js
rideLayout({width, height, kind, primary, secondary})
// -> {rows, wide, items: [{key, col, row, span, step?, cols?, fields?}], spare}
```

- `rows = floor((height − 48 − 64 − 20 + 8) / 72)`
- narrow (< 700 px): interval 2 rows, then pacing at the biggest step of 8/6/4/3 that leaves
  room for the fields and a 1-row profile; one spare row turns the profile into 2 rows
- wide: left column interval + pacing; right column up next, fields (M if they fit, then
  ride totals), profile 2 rows (3 if one is left over)
- free ride: no interval, up next or profile; elapsed time takes the interval's 2 rows

`test/models/layout.test.js` pins the mockup's results:

| Screen | Few sensors | Many sensors |
|---|---|---|
| 400 × 880 | pacing L 6, fields 1, profile 1 | pacing M 4, fields 2, profile 2 |
| 400 × 800 | pacing M 4, fields 1, profile 2 | pacing M 4, fields 2, profile 1 |
| 800 × 700 | pacing L 6; fields M + totals S, profile 3 | pacing L 6; fields S 4, profile 3 |
| 1440 × 900 | pacing XL 8; fields M 4, profile 3 | pacing XL 8; fields M 6, profile 3 |

## Phase 3: ride screen on the grid

`src/index.html`, `src/views/ride.js`, `src/views/tiles.js`, `src/css/app.css`
- `.ride-layout` becomes `<ride-grid>`: `display: grid; grid-auto-rows: var(--unit)`. A small
  view calls `rideLayout()` on resize (ResizeObserver), on sensor changes and on ride kind, and
  writes `grid-row`/`grid-column` and `data-step` onto its children. It contains no layout
  maths of its own.
- `<pacing-box data-step="s|m|l|xl">`: four fixed type and gauge sizes in CSS (72/104/148/240 px
  number). The box gets the status tint (border + 10 % background) back.
- `<interval-block>`: flat; "Effort 2 / 3" and elapsed on top, countdown, progress, and in
  narrow a `Next  Recovery · 5:00  140 W` line (amber in the last 5 s).
- `<next-interval>` stays as the 1-row tile for wide.
- Fields: two `<tile-row>`s, `primary` (heart rate, cadence, SmO2, tHb, core, skin, gear)
  and `secondary` (avg power, energy, distance, speed; wide only), with `size="s|m"`. Climbed
  leaves the ride screen.
- `<ride-profile>`: height follows its rows (1–3).

## Phase 4: controls

- Bottom bar: mode + stepper in **one** 64 px row, always visible. The current
  auto-hiding bar goes away.
- `<ride-controls>` (stop, previous, pause/start, next) moves into an overlay inside the
  pacing box:
  - shown on mouse move, tap or key press, hidden after 4 s
  - always open while stopped (Start) and paused (Resume)
  - while hidden it's `inert`, so Tab never lands on invisible buttons; `:focus-within`
    keeps it open
  - keyboard shortcuts (space, L, B) work unchanged

## Phase 5: other screens (separate commits, after the ride screen is accepted)

- Settings: sensor and account rows exactly 1 unit (64 px).
- Rides list: 1 unit per ride where the buttons fit; at 400 px they wrap below the text.
- Workout cards (start, workouts): 2 units, in a grid with the same gap. (3 was planned, but
  Ride sits next to the name, so 2 is enough.)
- Then retake the README screenshots.

## Open points (my defaults unless you say otherwise)

- 1440 with few sensors: the right column ends 2 rows above the left one. **Default: leave
  it.** Alternative: profile up to 4 rows.
- Energy is shown in kcal (that's what the app records), not kJ as in the mockup.
- Heart rate and cadence also show when only the trainer is connected, because many
  trainers pass them through. Today that can mean a `--` tile.

## On-bike check (after phase 4)

1. Split view, 400 px wide: start a workout. Everything is visible without scrolling; the
   controls appear over the power box when you move the mouse and hide after 4 s.
2. Slope mode: − and + change the slope without opening anything.
3. Pause with space: the overlay stays open with Resume.
4. Connect HR and a second sensor during the ride: the fields appear and the power box
   steps down a size, without a jump in the bottom bar.
5. Full screen: pacing XL, both columns line up.
