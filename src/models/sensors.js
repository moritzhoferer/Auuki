//
// The sensor types the app can connect, in display order.
// `more` ones are rarely used and sit behind 'More sensors' until connected.
// `ble` / `ant` are the event prefixes of ble/devices.js and ant/devices.js:
// ui:<id>:switch connects or disconnects, <id>:connected / :disconnected / :connecting,
// <id>:name and <id>:batteryLevel report back.
//

const sensors = [
    {id: 'trainer',    label: 'Trainer',           icon: 'trainer',    ble: 'ble:controllable',       ant: 'ant:controllable', provides: ['power', 'cadence', 'speed']},
    {id: 'hrm',        label: 'Heart rate',        icon: 'hrm',        ble: 'ble:heartRateMonitor',   ant: 'ant:hrm',          provides: ['heartRate']},
    {id: 'power',      label: 'Power meter',       icon: 'power',      ble: 'ble:powerMeter',                                  provides: ['power', 'cadence']},
    {id: 'cadence',    label: 'Speed and cadence', icon: 'cadence',    ble: 'ble:speedCadenceSensor',                          provides: ['cadence', 'speed']},
    {id: 'smo2',       label: 'Muscle oxygen',     icon: 'smo2',       ble: 'ble:smo2',                                        provides: ['smo2', 'thb'], more: true},
    {id: 'core',       label: 'Core temperature',  icon: 'core',       ble: 'ble:coreTemp',                                    provides: ['coreBodyTemperature', 'skinTemperature'], more: true},
    {id: 'controller', label: 'Controller',        icon: 'controller', ble: 'ble:openBikeControl',                             provides: ['virtualGear'], more: true},
];

// data that several sensors can provide: which one is used is db.sources[metric]
const sharedMetrics = [
    {metric: 'power',   label: 'Power from'},
    {metric: 'cadence', label: 'Cadence from'},
    {metric: 'speed',   label: 'Speed from'},
];

function sensorById(id) {
    return sensors.find(s => s.id === id);
}

// 'ble:powerMeter' -> sensor
function sensorBySource(source = '') {
    return sensors.find(s => s.ble === source || s.ant === source);
}

function emptyStatus() {
    return Object.fromEntries(sensors.map(s => [s.id, {status: 'off', name: '', battery: -1, via: ''}]));
}

function isConnected(sensorStatus = {}, id) {
    return sensorStatus[id]?.status === 'on';
}

function connectedCount(sensorStatus = {}) {
    return sensors.filter(s => isConnected(sensorStatus, s.id)).length;
}

export {
    sensors,
    sharedMetrics,
    sensorById,
    sensorBySource,
    emptyStatus,
    isConnected,
    connectedCount,
};
