import { isConnected } from './sensors.js';

//
// Every value a tile can show, defined once. Tiles and the ride summary read this.
//
//   key      db prop
//   label    tile heading
//   unit     (db) -> String
//   format   (value, db) -> String
//   sensors  the tile shows while one of these sensors is connected ([] = always)
//   deps     other db props the format reads
//

const metric = (db) => db.measurement !== 'imperial';
const fixed = (digits) => (value) => Number.isFinite(value) && value !== 0 ? Number(value).toFixed(digits) : '--';
const whole = (value) => value > 0 ? String(Math.round(value)) : '--';

function speed(db) {
    // the trainer's own speed, or the virtual speed computed from power
    return db.sources?.virtualState === 'speed' ? db.speed : db.speedVirtual;
}

const fields = [
    {key: 'heartRate',    label: 'Heart rate',  unit: () => 'bpm',  format: whole,            sensors: ['hrm', 'trainer']},
    {key: 'cadence',      label: 'Cadence',     unit: () => 'rpm',  format: whole,            sensors: ['trainer', 'power', 'cadence']},
    {key: 'speedVirtual', label: 'Speed',       unit: (db) => metric(db) ? 'km/h' : 'mph',
     format: (_, db) => {
         const mps = speed(db) ?? 0;
         if(mps <= 0) return '--';
         return (metric(db) ? mps * 3.6 : mps * 2.23694).toFixed(1);
     },
     sensors: ['trainer', 'cadence', 'power'], deps: ['speed']},
    {key: 'distance',     label: 'Distance',    unit: (db) => metric(db) ? 'km' : 'mi',
     format: (meters, db) => meters > 0 ? (meters / (metric(db) ? 1000 : 1609.34)).toFixed(2) : '--',
     sensors: ['trainer', 'cadence', 'power']},
    {key: 'smo2',         label: 'SmO2',        unit: () => '%',    format: fixed(1),         sensors: ['smo2']},
    {key: 'thb',          label: 'tHb',         unit: () => 'g/dl', format: fixed(2),         sensors: ['smo2']},
    {key: 'coreBodyTemperature', label: 'Core', unit: (db) => metric(db) ? '°C' : '°F',
     format: (c, db) => c > 0 ? (metric(db) ? c : c * 9 / 5 + 32).toFixed(1) : '--',
     sensors: ['core']},
    {key: 'skinTemperature', label: 'Skin',     unit: (db) => metric(db) ? '°C' : '°F',
     format: (c, db) => c > 0 ? (metric(db) ? c : c * 9 / 5 + 32).toFixed(1) : '--',
     sensors: ['core']},
    {key: 'virtualGear',  label: 'Gear',        unit: () => '',     format: whole,            sensors: ['controller']},
    {key: 'powerAvg',     label: 'Avg power',   unit: () => 'W',    format: whole,            sensors: ['trainer', 'power']},
    {key: 'kcal',         label: 'Energy',      unit: () => 'kcal', format: whole,            sensors: ['trainer', 'power']},
    {key: 'heartRateAvg', label: 'Avg HR',      unit: () => 'bpm',  format: whole,            sensors: ['hrm']},
    {key: 'ascent',       label: 'Climbed',     unit: (db) => metric(db) ? 'm' : 'ft',
     format: (m, db) => m > 0 ? String(Math.round(metric(db) ? m : m * 3.28084)) : '--',
     sensors: ['trainer']},
];

function fieldByKey(key) {
    return fields.find(f => f.key === key);
}

// a field is shown while one of its sensors is connected
function isAvailable(field, sensorStatus = {}) {
    if(!field) return false;
    if(field.sensors.length === 0) return true;
    return field.sensors.some(id => isConnected(sensorStatus, id));
}

function availableFields(keys, sensorStatus = {}) {
    return keys.map(fieldByKey).filter(f => isAvailable(f, sensorStatus));
}

export {
    fields,
    fieldByKey,
    isAvailable,
    availableFields,
};
