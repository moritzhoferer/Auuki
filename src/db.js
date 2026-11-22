import { xf, exists, equals } from './functions.js';
import { models } from './models/models.js';
import { Sound } from './sound.js';
import { idb } from './storage/idb.js';
import { ControlMode, } from './ble/enums.js';
import { TimerStatus, } from './activity/enums.js';
import { rangeStatus, hasRange, TimeInRange, } from './models/range.js';
import { sensors, emptyStatus, } from './models/sensors.js';

const timeInRange = TimeInRange();

// import { trainerMock } from './simulation-scripts.js';

let db = {
    // Data Screen
    power: models.power.default,
    heartRate: models.heartRate.default,
    rrInterval: [],
    cadence: models.cadence.default,
    speed: models.speed.default,
    sources: models.sources.default,
    smo2: models.smo2.default,
    thb: models.thb.default,
    coreBodyTemperature: 0,
    skinTemperature: 0,
    position_lat: 0,
    position_long: 0,

    speedVirtual: models.virtualState.speed,
    altitude: models.virtualState.altitude,
    distance: models.virtualState.distance,
    ascent: models.virtualState.ascent,

    power1s: models.power1s.default,
    power3s: models.power3s.default,
    powerInZone: models.powerInZone.default,

    powerLap: models.powerLap.default,
    heartRateLap: models.heartRateLap.default,
    cadenceLap: models.cadenceLap.default,
    kcal: models.kcal.default,
    powerAvg: models.powerAvg.default,
    virtualGear: models.virtualGear.default,
    cadenceAvg: models.cadenceAvg.default,
    heartRateAvg: models.heartRateAvg.default,

    powerLapCount: models.powerLap.count,
    heartRateLapCount: models.heartRateLap.count,
    cadenceLapCount: models.cadenceLap.count,
    powerAvgCount: models.powerAvg.count,
    cadenceAvgCount: models.cadenceAvg.count,
    heartRateAvgCount: models.heartRateAvg.count,

    heartRateMax: 0,

    // Targets
    powerTarget: models.powerTarget.default,
    resistanceTarget: models.resistanceTarget.default,
    slopeTarget: models.slopeTarget.default,
    cadenceTarget: models.cadenceTarget.default,
    powerTargetRange: {low: 0, high: 0},
    powerTolerance: models.powerTolerance.default,
    timeInRange: 0,

    mode: models.mode.default,

    // Profile
    ftp: models.ftp.default,
    weight: models.weight.default,
    measurement: models.measurement.default,
    volume: models.volume.default,

    // UI options
    powerSmoothing: 0,

    // Workouts
    workouts: [],
    workout: models.workout.default,
    workoutTextEvent: "",


    // Recording
    records: [],
    lap: [],
    laps: [],
    events: [],
    lapStartTime: false,

    // Watch
    elapsed: 0,
    lapTime: 0,
    stepTime: 0,
    intervalIndex: 0,
    stepIndex: 0,
    intervalDuration: 0,
    stepDuration: 0,
    watchStatus: TimerStatus.stopped,
    workoutStatus: TimerStatus.stopped,

    // Course
    courseIndex: 0,

    // App
    screen: 'loading',   // loading | riders | setup | start | library | ready | ride | summary | settings | editor
    sheet: '',           // '' | sensors | finish
    rideKind: 'workout', // workout | free
    notice: '',

    // Riders (server)
    rider: null,
    riders: [],
    rides: [],
    ride: null,          // the ride just saved, for the summary
    planned: [],
    plannedStatus: 'idle', // idle | loading | ok | error

    // Sensors
    sensors: emptyStatus(),
    antDriver: 'off',
};



xf.create(db);

// Data Screen
xf.reg(models.heartRate.prop, (heartRate, db) => {
    db.heartRate = heartRate;
    db.heartRateLap = models.heartRateLap.setState(heartRate);
    db.heartRateAvg = models.heartRateAvg.setState(heartRate);
    db.heartRateLapCount = models.heartRateLap.count;
    db.heartRateAvgCount = models.heartRateAvg.count;

    if(heartRate > db.heartRateMax) {
        db.heartRateMax = heartRate;
    }
});

xf.reg('rrInterval', (rrInterval, db) => {
    db.rrInterval = rrInterval;
});

xf.reg(models.power.prop, (power, db) => {
    db.power = power;
});

xf.reg(models.cadence.prop, (cadence, db) => {
    db.cadence = cadence;
    db.cadenceLap = models.cadenceLap.setState(cadence);
    db.cadenceAvg = models.cadenceAvg.setState(cadence);
    db.cadenceLapCount = models.cadenceLap.count;
    db.cadenceAvgCount = models.cadenceAvg.count;
});

xf.reg(models.speed.prop, (speed, db) => {
    db.speed = speed;
});

xf.reg(models.smo2.prop, (smo2, db) => {
    db.smo2 = smo2;
});

xf.reg(models.thb.prop, (thb, db) => {
    db.thb = thb;
});

xf.reg(`coreBodyTemperature`, (coreBodyTemperature, db) => {
    db.coreBodyTemperature = coreBodyTemperature;
});

xf.reg(`skinTemperature`, (skinTemperature, db) => {
    db.skinTemperature = skinTemperature;
});

xf.reg('ble:openBikeControl:buttonState', (messages, db) => {
    db.virtualGear = models.virtualGear.apply(db.virtualGear, messages);
});

xf.reg(models.sources.prop, (sources, db) => {
    db.sources = models.sources.set(db.sources, sources);
    models.sources.backup(db.sources);
    console.log(db.sources);
});


xf.reg('power1s', (power, db) => {
    db.power1s = power;

    db.powerLap = models.powerLap.setState(power);
    db.powerAvg = models.powerAvg.setState(power);
    db.kcal = models.kcal.setState(power);

    db.powerLapCount = models.powerLap.count;
    db.powerAvgCount = models.powerAvg.count;
});

xf.reg('power3s', (power, db) => {
    db.power3s = power;

    if(equals(db.watchStatus, TimerStatus.started) && hasRange(db.powerTargetRange)) {
        const isInside = equals(rangeStatus(power, db.powerTargetRange).zone, 'in');
        db.timeInRange = timeInRange.add(isInside);
    }
});

// time in range is per interval
xf.reg('watch:lap', (_, db) => {
    db.timeInRange = timeInRange.reset();
});
xf.reg('watch:stopped', (_, db) => {
    db.timeInRange = timeInRange.reset();
    db.powerTargetRange = {low: 0, high: 0};
});
xf.reg('workout:done', (_, db) => {
    db.powerTargetRange = {low: 0, high: 0};
});

xf.reg('powerInZone', (powerInZone, db) => {
    db.powerInZone = powerInZone;
});

xf.reg('speedVirtual', (speedVirtual, db) => {
    db.speedVirtual = speedVirtual;
});

xf.reg('altitude', (altitude, db) => {
    db.altitude = altitude;
});

xf.reg('ascent', (ascent, db) => {
    db.ascent = ascent;
});

xf.reg('distance', (distance, db) => {
    if(equals(db.watchStatus, 'started')) {
        db.distance = distance;
    };
});

// Screens and sheets
xf.reg('ui:screen', (screen, db) => {
    db.sheet = '';
    db.screen = screen;
});
xf.reg('ui:sheet', (sheet, db) => {
    db.sheet = sheet ?? '';
});
xf.reg('ui:notice', (notice, db) => {
    db.notice = notice ?? '';
});

// Sensors: one status entry per sensor type, from the BLE and ANT+ device events
function setSensor(db, id, changes) {
    db.sensors = {...db.sensors, [id]: {...db.sensors[id], ...changes}};
}
for(const sensor of sensors) {
    for(const source of [sensor.ble, sensor.ant].filter(Boolean)) {
        const via = source.startsWith('ant') ? 'ANT+' : 'Bluetooth';
        xf.reg(`${source}:connecting`,   (_, db) => setSensor(db, sensor.id, {status: 'connecting', via}));
        xf.reg(`${source}:connected`,    (_, db) => setSensor(db, sensor.id, {status: 'on', via}));
        xf.reg(`${source}:disconnected`, (_, db) => {
            if(db.sensors[sensor.id].via !== via && db.sensors[sensor.id].status === 'on') return;
            setSensor(db, sensor.id, {status: 'off', name: '', battery: -1, via: ''});
        });
        xf.reg(`${source}:name`, (name, db) => {
            if(name && name !== '--') setSensor(db, sensor.id, {name});
        });
        xf.reg(`${source}:batteryLevel`, (battery, db) => setSensor(db, sensor.id, {battery}));
    }
}
xf.reg('ant:driver:connecting', (_, db) => db.antDriver = 'connecting');
xf.reg('ant:driver:connected',  (_, db) => db.antDriver = 'on');
xf.reg('ant:driver:closed',     (_, db) => db.antDriver = 'off');
xf.reg('ant:driver:disable',    (_, db) => db.antDriver = 'off');

// Modes
// the mode is the user's choice, workouts only set targets
xf.reg('ui:mode-set', (mode, db) => {
    db.mode = models.mode.set(mode);
    models.mode.backup(db.mode);

    if(equals(mode, ControlMode.erg)) {
        xf.dispatch(`ui:power-target-set`, db.powerTarget);
    }
    if(equals(mode, ControlMode.resistance)) {
        xf.dispatch(`ui:resistance-target-set`, db.resistanceTarget);
    }
    if(equals(mode, ControlMode.sim)) {
        xf.dispatch(`ui:slope-target-set`, db.slopeTarget);
    }
});



// Targets
xf.reg('ui:power-target-set', (powerTarget, db) => {
    db.powerTarget = models.powerTarget.set(powerTarget);
});
xf.reg('ui:power-target-inc', (_, db) => {
    db.powerTarget = models.powerTarget.inc(db.powerTarget);
});
xf.reg(`ui:power-target-dec`, (_, db) => {
    db.powerTarget = models.powerTarget.dec(db.powerTarget);
});
xf.reg('ui:cadence-target-set', (cadenceTarget, db) => {
    db.cadenceTarget = models.cadenceTarget.set(cadenceTarget);
});

xf.reg('ui:resistance-target-set', (resistanceTarget, db) => {
    db.resistanceTarget = models.resistanceTarget.set(resistanceTarget);
});
xf.reg('ui:resistance-target-inc', (_, db) => {
    db.resistanceTarget = models.resistanceTarget.inc(db.resistanceTarget);
});
xf.reg(`ui:resistance-target-dec`, (_, db) => {
    db.resistanceTarget = models.resistanceTarget.dec(db.resistanceTarget);
});

xf.reg('ui:slope-target-set', (slopeTarget, db) => {
    db.slopeTarget = models.slopeTarget.set(slopeTarget);
});
xf.reg('ui:slope-target-inc', (_, db) => {
    db.slopeTarget = models.slopeTarget.inc(db.slopeTarget);
});
xf.reg(`ui:slope-target-dec`, (_, db) => {
    db.slopeTarget = models.slopeTarget.dec(db.slopeTarget);
});

// Profile
// ftp and weight belong to the rider (server), see app.js
xf.reg('ui:ftp-set', (ftp, db) => {
    db.ftp = models.ftp.set(ftp);
});
xf.reg('ui:power-tolerance-set', (tolerance, db) => {
    db.powerTolerance = models.powerTolerance.set(tolerance);
    models.powerTolerance.backup(db.powerTolerance);
});
xf.reg('ui:power-target-range-set', (range, db) => {
    db.powerTargetRange = {low: range?.low ?? 0, high: range?.high ?? 0};
});
xf.reg('ui:weight-set', (weight, db) => {
    db.weight = models.weight.set(weight);
});
xf.reg('ui:measurement-switch', (_, db) => {
    db.measurement = models.measurement.switch(db.measurement);
    models.measurement.backup(db.measurement);
});

xf.reg('ui:volume-mute', (_, db) => {
    db.volume = models.volume.mute();
    models.volume.backup(db.volume);
});
xf.reg('ui:volume-down', (_, db) => {
    db.volume = models.volume.dec(db.volume);
    models.volume.backup(db.volume);
});
xf.reg(`ui:volume-up`, (_, db) => {
    db.volume = models.volume.inc(db.volume);
    models.volume.backup(db.volume);
});

// Workouts
xf.reg('workout', (workout, db) => {
    db.workout = models.workout.set(workout);
});
xf.reg('ui:workout:select', (id, db) => {
    db.workout = models.workouts.get(db.workouts, id);
});
xf.reg('ui:planned:select', (id, db) => {
    db.workout = db.planned.find(w => w.id === id) ?? db.workout;
});
xf.reg('ui:workout:remove', (id, db) => {
    db.workouts = models.workouts.remove(db.workouts, id);
});
xf.reg('ui:workout:upload', async function(files, db) {
    for(let file of Object.values(files)) {
        const { result, name } = await models.workout.readFromFile(file);
        const workout = models.workout.parse(result, name);
        models.workouts.add(db.workouts, workout);
        xf.dispatch('db:workouts', db);
    }

});

xf.reg('course:index', (index, db) => {
    db.courseIndex = index;
});

xf.reg('course:position', (position, db) => {
    db.position_lat = position.position_lat;
    db.position_long = position.position_long;
});

// Wake Lock
xf.reg('lock:beforeunload', (e, db) => {
    // backup session
    models.session.backup(db);
});
xf.reg('lock:release', (e, db) => {
    // backup session
    models.session.backup(db);
});



//
xf.reg('app:start', async function(_, db) {

    db.powerTolerance = models.powerTolerance.set(models.powerTolerance.restore());
    db.mode = models.mode.set(models.mode.restore());
    db.measurement = models.measurement.set(models.measurement.restore());
    db.volume = models.volume.set(models.volume.restore());

    db.sources = models.sources.set(models.sources.restore());

    // IndexedDB Schema Version 3
    await idb.start('store', 3, ['session', 'workouts', 'activity']);
    db.workouts = await models.workouts.restore();
    db.workout = models.workout.restore(db);

    await models.session.restore(db);
    xf.dispatch('workout:restore');
    xf.dispatch('activity:restore');

    models.kcal.restore(db);
    models.powerLap.restore(db);
    models.powerAvg.restore(db);
    models.cadenceLap.restore(db);
    models.cadenceAvg.restore(db);
    models.heartRateLap.restore(db);
    models.heartRateAvg.restore(db);

    const sound = Sound({volume: db.volume});
    sound.start();

    // riders, planned workouts and rides: app.js
    xf.dispatch('app:ready');
});

function start () {
    console.log('start db');
    xf.dispatch('db:start');

}

start();

export { db };

