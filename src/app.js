import { xf, equals, exists } from './functions.js';
import { isoDate, isToday } from './utils.js';
import { models } from './models/models.js';
import { server, errorText } from './models/server.js';
import { rides } from './models/rides.js';

//
// App flows: who's riding, setup, accounts, choosing a ride, finishing it.
// The views only dispatch ui:* intents; this module talks to the server and
// moves db.screen along. State lives in db.js.
//

let db = {};
let saving = false;
xf.reg('app:ready', (_, state) => { db = state; start(); });

function notice(text = '') {
    xf.dispatch('ui:notice', text);
}

function isRiding() {
    return !equals(db.watchStatus, 'stopped');
}

// riding, or stopped with a ride whose save failed: the ride must not change rider
function hasRide() {
    return isRiding() || db.unsavedElapsed != null;
}

// a response that arrives after the rider changed (switch, logout) belongs to the old one
function isCurrent(riderId) {
    return exists(riderId) && equals(db.rider?.id, riderId);
}

function setRider(me) {
    db.rider = me;
    db.ftp = models.ftp.set(me.ftp);
    db.weight = models.weight.set(me.weight);
}

async function start() {
    const me = await server.me();
    if(me.ok) {
        const claimed = await claimSession(me.data.id);
        if(claimed === null) return;
        setRider(me.data);
        afterLogin(claimed);
        openRideOrStart();
        return;
    }
    await showRiders(me.error);
}

function openRideOrStart() {
    db.screen = hasRide() ? 'ride' : 'start';
    if(db.unsavedElapsed != null) xf.dispatch('ui:sheet', 'finish');
}

async function showRiders(error = '') {
    const riders = await server.riders();
    db.riders = riders.ok ? riders.data : [];
    if(!riders.ok) notice(errorText(riders.error));
    db.screen = (riders.ok && db.riders.length === 0) ? 'setup' : 'riders';
}

function afterLogin(message = '') {
    notice(message);
    loadPlanned();
    loadRides();
    syncBody();
}

// FTP and weight follow Intervals.icu or Garmin when the rider chose so:
// on every start and login, and when the app comes back after a while (a PWA can stay open for days)
const bodyStaleAfter = 6 * 3600; // s

async function syncBody() {
    if(!db.rider || equals(db.rider.bodySource ?? 'manual', 'manual')) return;
    const id = db.rider.id;
    const result = await server.syncBody();
    if(result.ok && isCurrent(id)) setRider(result.data);
}

document.addEventListener('visibilitychange', () => {
    if(document.visibilityState !== 'visible' || !db.rider || isRiding()) return;
    const age = Date.now() / 1000 - (db.rider.bodySyncedAt ?? 0);
    if(age > bodyStaleAfter) syncBody();
});

// --- riders -----------------------------------------------------------------------------

xf.sub('ui:rider:pick', async ({id, pin}) => {
    const result = await server.login(id, pin);
    if(!result.ok) {
        xf.dispatch('rider:login-failed', {id, error: errorText(result.error)});
        return;
    }
    const claimed = await claimSession(result.data.id);
    if(claimed === null) return;
    setRider(result.data);
    afterLogin(claimed);
    openRideOrStart();
});

xf.sub('ui:rider:create', async ({name, pin}) => {
    const result = await server.createRider(name, pin);
    if(!result.ok) {
        notice(errorText(result.error));
        return;
    }
    const claimed = await claimSession(result.data.id);
    if(claimed === null) return;
    setRider(result.data);
    afterLogin(claimed);
    xf.dispatch('setup:step', 'accounts');
});

const finishFirst = 'A ride is in progress. Finish or discard it first.';

xf.sub('ui:rider:switch', async () => {
    if(hasRide()) return notice(finishFirst);
    await server.logout();
    db.rider = null;
    db.planned = [];
    db.rides = [];
    await showRiders();
});

xf.sub('ui:rider:logout-all', async () => {
    if(hasRide()) return notice(finishFirst);
    const result = await server.logoutAll();
    if(!result.ok) return notice(errorText(result.error));
    db.rider = null;
    db.planned = [];
    db.rides = [];
    await showRiders();
});

xf.sub('ui:rider:update', async (changes) => {
    const result = await server.updateMe(changes);
    if(result.ok) {
        setRider(result.data);
        xf.dispatch('rider:saved');
    } else {
        notice(errorText(result.error));
    }
});

xf.sub('ui:rider:delete', async () => {
    if(hasRide()) return notice(finishFirst);
    const result = await server.deleteMe();
    if(!result.ok) return notice(errorText(result.error));
    db.rider = null;
    await showRiders();
});

xf.sub('server:logged-out', async () => {
    // never interrupt a ride: the save keeps the ride locally if needed
    if(!db.rider || hasRide()) return;
    db.rider = null;
    await showRiders();
});

// --- accounts ----------------------------------------------------------------------------

xf.sub('ui:intervals:connect', async ({apiKey, athleteId}) => {
    const result = await server.connectIntervals(apiKey, athleteId);
    if(!result.ok) {
        xf.dispatch('account:error', {service: 'intervals', error: errorText(result.error)});
        return;
    }
    setRider(result.data.me);
    xf.dispatch('intervals:connected', result.data.athlete);
    loadPlanned();
});

xf.sub('ui:body:source', async (source) => {
    xf.dispatch('body:source', {status: 'loading', source});
    const result = await server.setBodySource(source);
    if(!result.ok) {
        xf.dispatch('body:source', {status: 'error', source, error: errorText(result.error)});
        return;
    }
    setRider(result.data);
    xf.dispatch('body:source', {status: 'ok', source});
});

xf.sub('ui:body:sync', async () => {
    const result = await server.syncBody();
    if(!result.ok) return notice(errorText(result.error));
    setRider(result.data);
    xf.dispatch('rider:saved');
});

xf.sub('ui:intervals:disconnect', async () => {
    const result = await server.disconnectIntervals();
    if(result.ok) {
        setRider(result.data);
        db.planned = [];
    }
});

xf.sub('ui:garmin:connect', async ({email, password}) => {
    const result = await server.connectGarmin(email, password);
    garminResult(result);
});

xf.sub('ui:garmin:code', async (code) => {
    const result = await server.garminCode(code);
    garminResult(result);
});

function garminResult(result) {
    if(!result.ok) {
        xf.dispatch('account:error', {service: 'garmin', error: errorText(result.error)});
        return;
    }
    if(result.data.status === 'mfa') {
        xf.dispatch('garmin:mfa');
        return;
    }
    refreshMe();
    xf.dispatch('garmin:connected');
}

xf.sub('ui:garmin:disconnect', async () => {
    const result = await server.disconnectGarmin();
    if(result.ok) setRider(result.data);
});

async function refreshMe() {
    const me = await server.me();
    if(me.ok) setRider(me.data);
}

// --- planned workouts and rides ------------------------------------------------------------

const plannedDays = 7;

async function loadPlanned() {
    if(!db.rider?.intervals?.connected) {
        db.planned = [];
        db.plannedStatus = 'idle';
        return;
    }
    const id = db.rider.id;
    db.plannedStatus = 'loading';
    // today and the next 7 days
    const end = new Date();
    end.setDate(end.getDate() + plannedDays);
    const result = await server.planned(isoDate(new Date()), isoDate(end));
    if(!isCurrent(id)) return;
    if(!result.ok) {
        db.plannedStatus = 'error';
        return;
    }
    try {
        db.planned = models.workout.fromIntervalsResponse(result.data)
            .sort((a, b) => (a.meta.startDateLocal ?? '').localeCompare(b.meta.startDateLocal ?? ''));
        db.plannedStatus = 'ok';
    } catch(e) {
        console.error(':planned :parse', e);
        db.plannedStatus = 'error';
    }
}

xf.sub('ui:planned:refresh', loadPlanned);

function todaysPlan() {
    return db.planned.find(w => isToday(w.meta?.startDateLocal));
}

async function loadRides() {
    if(!db.rider) return;
    const id = db.rider.id;
    await rides.flush(id);
    const result = await server.rides();
    const waiting = await rides.pendingSummaries(id);
    if(!isCurrent(id)) return;
    db.rides = [...waiting, ...(result.ok ? result.data : [])];
}

xf.sub('ui:ride:upload', async ({id, service}) => {
    const result = await server.uploadRide(id, service);
    if(!result.ok) {
        notice(errorText(result.error));
        markUpload(id, service, 'failed');
        return;
    }
    replaceRide(result.data);
});

function markUpload(id, service, status) {
    const ride = db.rides.find(r => r.id === id);
    if(ride) replaceRide({...ride, uploads: {...ride.uploads, [service]: status}});
}

function replaceRide(ride) {
    db.rides = db.rides.map(r => r.id === ride.id ? ride : r);
    if(db.ride?.id === ride.id) db.ride = ride;
}

xf.sub('ui:ride:download', async (id) => {
    const ride = db.rides.find(r => r.id === id);
    if(ride && !(await rides.download(ride))) notice(errorText('SERVER_UNREACHABLE'));
});

xf.sub('ui:ride:delete', async (id) => {
    const result = await server.deleteRide(id);
    if(result.ok) db.rides = db.rides.filter(r => r.id !== id);
});

// --- choosing and riding -----------------------------------------------------------------

xf.sub('ui:ride:today', () => {
    const plan = todaysPlan();
    if(plan) return chooseWorkout(plan);
    xf.dispatch('ui:ride:free');
});

xf.sub('ui:ride:planned', (id) => {
    const plan = db.planned.find(w => w.id === id);
    if(plan) chooseWorkout(plan);
});

xf.sub('ui:ride:library', (id) => {
    const workout = db.workouts.find(w => equals(w.id, id));
    if(workout) chooseWorkout(workout);
});

function chooseWorkout(workout) {
    if(hasRide() || !db.rider) return;
    db.workout = workout;
    db.rideKind = 'workout';
    xf.dispatch('ui:screen', 'ready');
}

xf.sub('ui:ride:free', () => {
    if(hasRide() || !db.rider) return;
    db.rideKind = 'free';
    xf.dispatch('ui:screen', 'ready');
});

xf.sub('ui:ride:start', () => {
    if(!db.rider || saving || isRiding()) return;
    // a ride whose save failed comes first: save it again or discard it
    if(db.unsavedElapsed != null) return xf.dispatch('ui:sheet', 'finish');
    db.sessionRider = db.rider.id;
    xf.dispatch('ui:screen', 'ride');
    xf.dispatch('ui:watchStart');
    if(equals(db.rideKind, 'workout')) xf.dispatch('ui:workoutStart');
});

xf.sub('ui:ride:toggle', () => {
    if(equals(db.watchStatus, 'started')) return xf.dispatch('ui:watchPause');
    if(equals(db.watchStatus, 'paused'))  return xf.dispatch('ui:watchResume');
    xf.dispatch('ui:ride:start');
});

xf.sub('ui:ride:finish', () => {
    if(saving || !isCurrent(db.sessionRider)) return;
    if(equals(db.watchStatus, 'started')) xf.dispatch('ui:watchPause');
    xf.dispatch('ui:sheet', 'finish');
});

xf.sub('ui:ride:resume', () => {
    if(!db.rider || db.unsavedElapsed != null) return;
    xf.dispatch('ui:sheet', '');
    xf.dispatch('ui:watchResume');
});

xf.sub('ui:ride:save', async () => {
    if(saving || !hasRide() || !isCurrent(db.sessionRider)) return;
    saving = true;
    xf.dispatch('ui:sheet', '');
    const elapsed = isRiding() ? db.elapsed : db.unsavedElapsed;
    db.unsavedElapsed = elapsed;
    // watch:stopped is dispatched synchronously, records and laps are complete after it
    xf.dispatch('ui:watchStop');

    await checkpointRide();
    let saved;
    try {
        saved = await rides.save(db, db.sessionRider, elapsed);
    } catch {
        // Encoding or storage can fail before the normal pending result.
    } finally {
        saving = false;
    }
    if(!saved) {
        // Keep the recording available for another save attempt.
        notice("The ride couldn't be saved, not on the server and not on this device. Try again, or discard it.");
        xf.dispatch('ui:sheet', 'finish');
        return;
    }
    db.unsavedElapsed = null;
    const { ride, pending } = saved;
    endSession();
    db.ride = ride;
    db.rides = [ride, ...db.rides.filter(r => r.id !== ride.id)];
    // replaces an error from an earlier attempt
    notice(pending ? "The server didn't answer. The ride is kept on this device and sent later." : '');
    xf.dispatch('ui:screen', 'summary');
});

xf.sub('ui:ride:discard', () => {
    if(saving || !isCurrent(db.sessionRider)) return;
    db.unsavedElapsed = null;
    xf.dispatch('ui:sheet', '');
    xf.dispatch('ui:watchStop');
    endSession();
    xf.dispatch('ui:screen', 'start');
});

async function checkpointRide() {
    try {
        await models.session.backup(db);
    } catch {
        // The server or activity store can still accept the recording.
    }
}

function endSession() {
    models.session.reset(db);
    db.sessionRider = '';
    models.session.backup(db);
}

// A ride restored from this device belongs to the rider who recorded it. When someone
// else logs in, it is kept on this device for its rider (sent with their next sync)
// and the session starts clean. Backups from before riders were recorded have no rider:
// the first rider to log in takes them, as before.
// -> a notice for the rider who logs in, or ''
async function claimSession(riderId) {
    const owner = db.sessionRider;
    if(!hasRide() && !(db.elapsed > 0)) return '';
    if(!owner || owner === riderId) {
        db.sessionRider = riderId;
        return '';
    }

    const elapsed = db.unsavedElapsed ?? db.elapsed;
    db.unsavedElapsed = elapsed;
    xf.dispatch('ui:watchStop');
    await checkpointRide();
    let kept;
    try {
        kept = await rides.keep(db, owner, elapsed);
    } catch {
        // Keep the stopped recording available for its owner.
    }
    if(!kept) {
        db.rider = null;
        await showRiders();
        notice("A ride on this device still needs saving. Sign in as the rider who recorded it.");
        return null;
    }
    db.unsavedElapsed = null;
    endSession();
    return 'A ride by another rider was still on this device. It is kept for them and sent when they log in.';
}

// the current workout list changed (upload): show the library
xf.sub('db:workouts', () => {
    if(equals(db.screen, 'start')) xf.dispatch('ui:screen', 'library');
});

export { todaysPlan };
