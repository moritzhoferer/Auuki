# Redesign and Di2 review

## A failed offline save can discard the only copy of a ride
Severity: high  
Where: src/models/rides.js:53, src/storage/idb.js:115, src/app.js:343  
What: If the POST fails and the IndexedDB put fails, the storage helper catches the error and resolves. Save reports “kept on this device” and resets the session. Even a successful request can precede a transaction abort.  
Suggestion: Wait for transaction completion and retain the finished session until either destination confirms persistence. Exercise quota failure and transaction abort. This needs a retry state on the finish screen.
Status: fixed (uncommitted). rides.js reads the record back in a later transaction and returns null when neither the server nor IndexedDB kept it. The recording is checkpointed to the session backup before the upload, with `unsavedElapsed` kept after the watch stops, so a reload brings back the ride screen with the finish sheet. The finish sheet shows the error (Save again or Discard; Resume hidden), Finish stays enabled, and a `saving` flag blocks start, discard, resume and a second save while one is in flight. A successful retry clears the earlier error notice. Tests: test/models/rides.test.js, test/ride-save.test.js. Open: a page closed after the server stored the ride but before the answer arrived is uploaded again on retry (see finding 2).
Assessment: confirmed. idb.js (upstream) returns `[]` on error and resolves on request success, not transaction completion; rides.save never checks the result. Rare (server down and storage failing), but the ride is lost for good. Cheap partial fix: treat a missing key from `put` as failure and keep the session.

## A pending ride can be uploaded under another rider
Severity: high  
Where: src/models/rides.js:66, src/models/server.js:62, src/app.js:248  
What: Flush selects pending records using rider A's ID, but each POST uses the current session cookie. Switch to rider B in another tab between two queued uploads and the next request can send A's FIT to B's account. Two tabs flushing the same record can also upload it twice.  
Suggestion: Bind each upload to an expected rider and a stable client ride ID that the server verifies. This requires an API contract for ownership and retry deduplication.
Status: partly fixed (uncommitted). Every upload sends the recording rider's `riderId`; the server answers 409 `RIDER_CHANGED` when it isn't the logged-in rider, and the client keeps the ride on the device for a later sync. Server test added (38 pytest). Open: duplicate uploads, from two tabs flushing the same queued ride or from retrying after an interrupted save. They need a client ride ID the server deduplicates on (API change, decision first).

## A restored session has no rider identity
Severity: high  
Where: src/models/models.js:629, src/models/models.js:652, src/db.js:422, src/app.js:35  
What: Session backup uses one device-wide slot. If A closes the PWA mid-ride and B signs in from another tab, reopening can restore A's recording while displaying B as the rider. Saving then uses B's session.  
Suggestion: Associate active sessions with a rider and verify ownership before restoring. Decide how to recover existing anonymous backups without exposing them to another rider.
Status: fixed (uncommitted). `sessionRider` is set when a ride starts (the only start path is `ui:ride:start`) and kept in the session backup. Finish, Save and Discard require the logged-in rider to be that rider. When a different rider logs in, the restored ride is put aside as a pending ride for its owner (sent when they log in) and the session starts clean, with a notice. If it can't be put aside, the app goes back to the rider list until the owner logs in. Backups without a rider (from before this change) go to the first rider who logs in. Not tested in the browser (needs the server and two riders). Minor: in that last case the new rider stays logged in on the server, so each reload repeats the check.
Assessment: confirmed. Most plausible path: reopening mid-ride after the session cookie expired, then another rider picks their name. Store the rider ID with the backup and check it on restore.

## A late response can replace the current rider
Severity: high  
Where: src/app.js:59, src/app.js:227, src/app.js:252  
What: Start body sync as A, switch to B, then let A's request resolve. The callback reinstates A's rider, FTP and weight while the cookie belongs to B. Late planned and ride-list responses can also replace B's data. A 401 during loadRides can clear db.rider before the final lookup of db.rider.id.  
Suggestion: Invalidate requests on rider change and check the captured session before applying results, including logout events. Test reversed response order with two synthetic riders.
Status: fixed (uncommitted). syncBody, loadPlanned and loadRides capture the rider ID and drop the result when the rider changed or logged out meanwhile, which also removes the `db.rider.id` crash after a 401. Not covered: user-triggered calls (Garmin, Intervals connect) and flush between uploads (finding 2).
Assessment: partly confirmed. The body-sync race needs a quick switch on Start (switching is blocked while riding). Concrete bug: a 401 in loadRides nulls db.rider and app.js:252 then throws; capture the ID once at the top.

## Starting from a controller or trainer can launch a workout in free-ride mode
Severity: high  
Where: src/ble/obc/controls.js:72, src/watch.js:129, src/app.js:316  
What: From stopped, OBC Resume and trainer auto-start dispatch both watchStart and workoutStart regardless of ride kind or screen. With a previously selected workout this can start its interval timer and apply its target during a free ride. Di2 has no Resume mapping.  
Suggestion: Route start through a single ride-kind-aware action. Decide which screens permit auto-start. On the bike select a workout, switch to Free ride, then test pedalling above 40 W and OBC Resume separately from stopped. Check screen, timer and trainer target.
Status: fixed (uncommitted). Assessment: confirmed and worse than described: auto-start is on by default and fired on any screen without switching to the ride screen. Auto-start and OBC Resume from stopped now dispatch `ui:ride:start` only on Ready or ride, so the ride kind decides whether the workout starts. Unit tests plus a simulated-power browser check pass; on-bike test still to do.

## Di2 connection success does not guarantee a working subscription
Severity: medium  
Where: src/ble/connectable.js:338, src/ble/service.js:185, src/ble/characteristic.js:62  
What: Connection setup ignores a false service result and the service also ignores exhausted notification retries. Sensors can display Connected without a working button. The listener is attached after notifications start, so an immediate baseline indication could be missed and the first real press discarded.  
Suggestion: Propagate setup failure and test baseline timing before changing subscription order. On the bike pair from cold, wait for Connected without touching a lever, then press right once. Compare indication timestamps with listener registration and count intensity changes. Repeat after a dropout and with an interrupted pairing.
Status: open. Assessment: confirmed in code. Mostly upstream BLE code, so it affects every sensor; good candidate for a feat branch. Keep the on-bike steps.

## Dropout cleanup can leave the Di2 UI unable to retry
Severity: medium  
Where: src/ble/connectable.js:405, src/ble/connectable.js:430, src/ble/reactive-connectable.js:122  
What: An unexpected disconnect changes status but leaves the connected flag set until the reconnect attempt finishes or fails. The disconnect handler also leaves its listener controller live. Reconnecting the same device can retain the old listener registration, whose signal no longer belongs to the current connection.  
Suggestion: Give each connection one cleanup path for flags, device listeners and notification subscriptions. On the bike force three out-of-range dropouts, then manually disconnect and reconnect. Verify one status transition per event, zero target changes on connection and one change per short press.
Status: open. Assessment: confirmed. `_connected` stays true after an unexpected disconnect, so the Connect button calls disconnect() instead of connect(). Upstream code; same feat branch as above.

## Long presses bypass the ride screen's interval guards
Severity: medium  
Where: src/ble/obc/controls.js:54, src/watch.js:314, src/watch.js:372, src/views/ride.js:425  
What: Both long presses dispatch in all watch states. In a running or paused workout they navigate intervals (previous at index zero does nothing). In a started or paused free ride both create a lap, although Previous is hidden. When stopped, either can send a lap event before recording. Short presses likewise adjust the mode target even outside the ride screen. Swapping sides exchanges those actions. Double, held and release produce no action.  
Suggestion: Agree whether controls should work on Ready or in a sheet, then share action availability across keyboard, overlay and Bluetooth. On the bike try both holds in each state and ride kind with swap off and on. Count laps and interval changes, including held repeats.
Status: open. Assessment: confirmed; mostly a product decision (should levers work on Ready or with a sheet open?). Decide that, then share one availability check across keyboard, overlay and BLE. Also: while a failed ride waits to be saved, L/B and a controller lap still add a lap to it.

## Short viewports cannot fit the minimum ride layout
Severity: medium  
Where: src/models/layout.js:43, src/models/layout.js:67, src/css/app.css:595, src/index.html:35  
What: At 400 × 500 the grid has about 368 px after the bars and padding, enough for five rows. A narrow workout still places six rows (424 px), even with zero sensor fields. Wide layouts always place at least five rows. Content can extend into the controls bar. A visible notice also occupies space outside the fixed-height ride screen. The 668 px content breakpoint starts wide layout at 692 px with 12 px side padding, before the specified 700 px.  
Suggestion: Choose a compact fallback and allocate space for notices. Verify scroll dimensions and bar overlap at 400, 800 and 1440 px, including short heights and safe-area padding. This is a layout calculation, not a browser measurement.
Status: fixed (uncommitted). Narrow workouts drop the profile row before anything overflows (400 × 500: interval + S pacing). Screens too short for 5 rows shrink the row height (layout returns `unit`, minimum 32 px); compact mode hides the pacing stats row and clips tiles; as a last resort the grid scrolls inside itself rather than covering the bar. On the ride screen the body is a flex column, so a notice takes its room from the grid. The padding switches at 692 px, so the wide layout starts at exactly 700 px. Checked in the browser at 800 × 360 (with and without a notice), 400 × 500, 400 × 880, 699/700, 800 × 700 and 1440 × 900; new layout tests.
Assessment: confirmed by the math (narrow workout needs 2+3+0+1 = 6 rows when 5 fit). Phone landscape (360–400 px high) makes it realistic. The 668/700 px breakpoint mismatch is minor.

## Selecting an ANT+ metric source writes a Bluetooth identifier
Severity: medium  
Where: src/views/sensors.js:124, src/models/sensors.js:25  
What: With an ANT+ trainer and a BLE power meter connected, selecting the trainer as the power source writes its BLE identifier. The incoming ANT+ measurements use a different identifier.  
Suggestion: Resolve each option from its active transport. Decide how to retain the preference when the same device reconnects over a different transport. Verify on the bike by selecting each power source in turn and disconnecting the other.
Status: fixed (uncommitted), differently than suggested. The stored Bluetooth ID is fine: it names the sensor whatever the transport, so the choice survives reconnecting over the other one. The real bug was that ANT+ trainer data skipped the source check entirely, so an ANT+ trainer and a BLE power meter both fed power. ant/devices.js (upstream file) now checks power, cadence and speed against the trainer's source. On-bike test still to do.
Assessment: confirmed; the option value is always `p.ble`. Easy fix: pick the ANT+ ID when the sensor status says `via` ANT+. Only matters with mixed transports.

## The Di2 parser treats all 0xF-prefixed bytes as unassigned
Severity: low  
Where: src/ble/di2/di2.js:49, src/ble/di2/di2.js:78  
What: The observed sentinel is 0xF0. Other 0xF-prefixed bytes are also skipped, and the previous sequence survives an unassigned frame. If an assigned channel returns with its old sequence, the parser suppresses it. No supplied capture establishes whether either case occurs. Valid initial frames, per-channel changes, unchanged sequences and mapped press types otherwise follow the header.  
Suggestion: Record frames before and after unassigning and reassigning one E-TUBE channel. Include a reconnect, one short press, a sustained hold, release and double press. Keep the current decoder until a capture distinguishes baseline replay from a new event.
Status: open. Assessment: confirmed but speculative; keep the decoder until a capture exists. Nit: `reset()` sets `baseline = true` twice.

## Dynamic settings can lose keyboard focus and tooltip text
Severity: low  
Where: src/views/screens.js:52, src/views/screens.js:31, src/views/ui.js:115, src/views/sensors.js:88  
What: Changing volume replaces the focused settings button on the next render. Sensor status updates similarly replace the whole sensor list. Ready's Connect sensors button has a visible name but neither tooltip attribute specified by the design rules.  
Suggestion: Preserve focus on the same logical control across updates and audit generated buttons alongside static markup. Check Tab order and focus visibility with a sensor connecting while the sheet is open.
Status: open. Assessment: confirmed, minor. innerHTML re-renders drop focus. The Connect sensors button has visible text, so the missing tooltip only breaks the letter of the rule.

## Small fixes committed

- 4b8a1a0 — Route workout ERG difficulty presses to intensity, including duplicate arrow reports.
- eb6d25d — Preserve workout intensity and gauge range in session snapshots.
- 0377dfa — Cancel the overlay inactivity timer while paused or stopped.
- (uncommitted) — Auto-start and controller Resume start the chosen ride only from Ready or the ride screen, via `ui:ride:start`.
- (uncommitted) — Failed saves keep the ride, survive a reload and ask again; uploads carry the recording rider and the server rejects a mismatch; a restored ride goes back to its rider; late responses for a previous rider are dropped; compact ride layout for short screens; ANT+ trainer data follows the chosen source.
