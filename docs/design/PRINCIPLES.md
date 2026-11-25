# Design principles

The rules every screen of this fork follows. The ride screen is the strictest case; the
other screens use the same units. Reference mockup: `ride-v2/ride-v3-mockup.html`.

## 1. One focal point, colour means status

- Each screen has one hero. On the ride screen it is the pacing box (3 s power + range gauge).
- Green, amber and red only ever mean *in range / near / out*. Everything else is neutral grey
  and white; blue marks targets (`140 W`) and the recorded power line.
- Only the hero gets a tinted surface. Other surfaces are plain.

## 2. One grid: 8 px base, 64 px unit, 8 px gap

| Token | Value | Why |
|---|---|---|
| base | 8 px | all spacing is a multiple of it |
| control | 44 px | minimum touch target, every button |
| pad | 10 px | inside every surface |
| **unit** | **64 px** | = control + 2 × pad: a surface with one row of controls |
| gap | 8 px | between tiles, in both directions |
| row step | 72 px | unit + gap |

A tile that spans *n* rows is **n × 72 − 8** px high: 64, 136, 208, 280, 352, 424, 496, 568.
Because every height is built the same way, tiles in neighbouring columns always end on the
same lines.

## 3. Heights are fixed, widths are fluid

- Columns share the available width (`fr`), tiles stretch sideways.
- Heights only come in row spans. Nothing stretches vertically to fill a gap.
- How many tiles fit next to each other comes from a minimum width: small field ≥ 104 px,
  medium field ≥ 150 px.

## 4. Concentric corners

- control radius 6 px, pad 10 px, **surface radius = control + pad = 16 px**.
- A tile without controls inside uses control + 8 = 14 px.
- Nested things never have a bigger radius than their parent.

## 5. Sizes come in steps, never scaled

Each component has a few designed sizes with fixed type sizes. The layout picks a step;
it never scales a component in between.

| Component | Steps (rows) | Key size per step |
|---|---|---|
| Pacing box | S 3 · M 4 · L 6 · XL 8 | 3 s power 72 · 104 · 160 · 240 px |
| Field tile | S 1 · M 2 | value 24 · 52 px |
| Interval | 2 | countdown 52 px (narrow, with "next" line) · 64 px (wide) |
| Up next | 1 | wide only; in narrow it is a line in the interval block |
| Workout profile | 1 · 2 · 3 | never higher than 3 rows |

## 6. The ride screen never scrolls

The layout is chosen from the number of rows that fit:
`rows = floor((height − header 48 − bar 64 − padding 20 + gap 8) / 72)`.

**Narrow (one column, < 700 px)**, top to bottom:
1. interval, 2 rows (with the next interval as a line)
2. pacing box: the biggest step that still leaves room for the rest
3. fields from connected sensors, small, 3 per row at 400 px
4. profile, 1 row; 2 rows if one is left over

**Wide (two columns, ≥ 700 px)**:
- left: interval (2 rows) + the biggest pacing step that fits the height
- right: up next (1 row), fields, profile (2 rows, 3 if one is left over)
- fields: medium if they fit, otherwise small. On wide screens, ride totals (avg power,
  energy, distance, speed) join the sensor fields when there are rows to spare.

Leftover space is less than one row and goes to the bottom. It is never spread between tiles.

## 7. Only show what has a source

A field appears only when a connected sensor (or the ride itself) provides it. No `--` tiles.
Order: heart rate, cadence, then the other sensors in the sensor order, then ride totals.

## 8. Controls

- Every button is 44 px high and has an aria-label or tooltip.
- Mode and the − target + stepper are always visible in the bottom bar (one row).
- Stop, previous, pause and next live in an overlay over the pacing box: it appears on
  mouse move, tap or key press and hides after 4 s; paused keeps it open.

## 9. Carry it over

The other screens may scroll (they are lists), but they use the same units:

| Thing | Rows |
|---|---|
| sensor / account row in Settings | 1 |
| ride in the rides list | 1 (buttons wrap below the text when they don't fit, e.g. at 400 px) |
| workout card (name and meta next to Ride, profile below) | 2 |
| today's workout on the start screen | 2 (same card) |
| section heading | text on the 8 px base, not a tile |
