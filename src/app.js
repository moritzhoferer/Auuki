import { xf, equals } from './functions.js';
import { getStartEndOfWeek, isToday } from './utils.js';
import { models } from './models/models.js';
import { server, errorText } from './models/server.js';
import { rides } from './models/rides.js';

//
// App flows: who's riding, setup, accounts, choosing a ride, finishing it.
// The views only dispatch ui:* intents; this module talks to the server and
// moves db.screen along. State lives in db.js.
//

let db = {};
xf.reg('app:ready', (_, state) => { db = state; start(); });

function notice(text = '') {
    xf.dispatch('ui:notice', text);
}

function isRiding() {
    return !equals(db.watchStatus, 'stopped');
}

function setRider(me) {
    db.rider = me;
    db.ftp = models.ftp.set(me.ftp);
    db.weight = models.weight.set(me.weight);
}

async function start() {
    const me = await server.me();
    if(me.ok) {
        setRider(me.data);
        afterLogin();
        db.screen = (db.elapsed > 0 && isRiding()) ? 'ride' : 'start';
        return;
    }
    await showRiders(me.error);
}

async function showRiders(error = '') {
    const riders = await server.riders();
    db.riders = riders.ok ? riders.data : [];
    if(!riders.ok) notice(errorText(riders.error));
    db.screen = (riders.ok && db.riders.length === 0) ? 'setup' : 'riders';
}

function afterLogin() {
    notice('');
    loadPlanned();
    loadRides();
    syncBody();
}

// FTP and weight follow Intervals.icu or Garmin when the rider chose so
async function syncBody() {
    if(!db.rider || equals(db.rider.bodySource ?? 'manual', 'manual')) return;
    const result = await server.syncBody();
    if(result.ok) setRider(result.data);
}

// --- riders -----------------------------------------------------------------------------

xf.sub('ui:rider:pick', async ({id, pin}) => {
    const result = await server.login(id, pin);
    if(!result.ok) {
        xf.dispatch('rider:login-failed', {id, error: errorText(result.error)});
        return;
    }
    setRider(result.data);
    afterLogin();
    xf.dispatch('ui:screen', 'start');
});

xf.sub('ui:rider:create', async ({name, pin}) => {
    const result = await server.createRider(name, pin);
    if(!result.ok) {
        notice(errorText(result.error));
        return;
    }
    setRider(result.data);
    afterLogin();
    xf.dispatch('setup:step', 'accounts');
});

const finishFirst = 'A ride is in progress. Finish or discard it first.';

xf.sub('ui:rider:switch', async () => {
    if(isRiding()) return notice(finishFirst);
    await server.logout();
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
    if(isRiding()) return notice(finishFirst);
    const result = await server.deleteMe();
    if(!result.ok) return notice(errorText(result.error));
    db.rider = null;
    await showRiders();
});

xf.sub('server:logged-out', async () => {
    // never interrupt a ride: the save keeps the ride locally if needed
    if(!db.rider || isRiding()) return;
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

async function loadPlanned() {
    if(!db.rider?.intervals?.connected) {
        db.planned = [];
        db.plannedStatus = 'idle';
        return;
    }
    db.plannedStatus = 'loading';
    const { startOfWeek, endOfWeek } = getStartEndOfWeek(new Date(), true);
    const result = await server.planned(startOfWeek, endOfWeek);
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
    await rides.flush(db.rider.id);
    const result = await server.rides();
    const waiting = await rides.pendingSummaries(db.rider.id);
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
    db.workout = workout;
    db.rideKind = 'workout';
    xf.dispatch('ui:screen', 'ready');
}

xf.sub('ui:ride:free', () => {
    db.rideKind = 'free';
    xf.dispatch('ui:screen', 'ready');
});

xf.sub('ui:ride:start', () => {
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
    if(equals(db.watchStatus, 'started')) xf.dispatch('ui:watchPause');
    xf.dispatch('ui:sheet', 'finish');
});

xf.sub('ui:ride:resume', () => {
    xf.dispatch('ui:sheet', '');
    xf.dispatch('ui:watchResume');
});

xf.sub('ui:ride:save', async () => {
    xf.dispatch('ui:sheet', '');
    const elapsed = db.elapsed;
    // watch:stopped is dispatched synchronously, records and laps are complete after it
    xf.dispatch('ui:watchStop');

    const { ride, pending } = await rides.save(db, db.rider?.id ?? '', elapsed);
    endSession();
    db.ride = ride;
    db.rides = [ride, ...db.rides.filter(r => r.id !== ride.id)];
    if(pending) notice("The server didn't answer. The ride is kept on this device and sent later.");
    xf.dispatch('ui:screen', 'summary');
});

xf.sub('ui:ride:discard', () => {
    xf.dispatch('ui:sheet', '');
    xf.dispatch('ui:watchStop');
    endSession();
    xf.dispatch('ui:screen', 'start');
});

function endSession() {
    models.session.reset(db);
    models.session.backup(db);
}

// the current workout list changed (upload): show the library
xf.sub('db:workouts', () => {
    if(equals(db.screen, 'start')) xf.dispatch('ui:screen', 'library');
});

export { todaysPlan };
