import { exists } from '../functions.js';

//
// Target range helpers for pacing against a power range.
// All power values are in watts.
//

// half width of the band put around a single value target
const singleTargetBand = 0.03;

// gauge layout in % of its width: red | amber | green | amber | red
const gaugeStops = [0, 15, 30, 70, 85, 100];

// Number, Int -> Int
// step values below 9 are fractions of FTP, larger values are watts
function toWatts(value, ftp) {
    if(value < 9) return Math.round(value * ftp);
    return Math.round(value);
}

// Step, Int -> {low: Int, high: Int}
function stepRange(step = {}, ftp = 0) {
    const watts = (x) => toWatts(x, ftp);

    if(exists(step.powerLow) && exists(step.powerHigh)) {
        return {low: watts(step.powerLow), high: watts(step.powerHigh)};
    }
    if(exists(step.power) && step.power > 0) {
        const target = watts(step.power);
        return {
            low:  Math.round(target * (1 - singleTargetBand)),
            high: Math.round(target * (1 + singleTargetBand)),
        };
    }
    return {low: 0, high: 0};
}

// workout intensity in % of the written workout (100 = as written), changed in 1 % steps
const intensityLimits = {min: 50, max: 150, step: 1};

// Int -> Int, a valid intensity
function clampIntensity(intensity = 100) {
    const value = Math.round(Number(intensity));
    if(!Number.isFinite(value)) return 100;
    return Math.min(intensityLimits.max, Math.max(intensityLimits.min, value));
}

// Number (watts), Int (%) -> Int (watts)
function scaleWatts(watts = 0, intensity = 100) {
    return Math.round(watts * intensity / 100);
}

// {low, high}, Int -> {low, high}
function scaleRange(range = {}, intensity = 100) {
    return {low: scaleWatts(range.low ?? 0, intensity), high: scaleWatts(range.high ?? 0, intensity)};
}

function hasRange(range = {}) {
    return range.high > 0;
}

// Int, Int -> Int
// tolerance setting in % of FTP to watts
function toleranceWatts(percent, ftp) {
    return Math.max(1, Math.round(ftp * percent / 100));
}

// Number, {low, high}, Int -> {zone: 'in'|'near'|'out'|'none', side: 'in'|'low'|'high'|'none'}
function rangeStatus(power, range = {}, tolerance = 0) {
    if(!hasRange(range)) return {zone: 'none', side: 'none'};

    const { low, high } = range;

    if(power >= low && power <= high) return {zone: 'in', side: 'in'};

    const side     = power < low ? 'low' : 'high';
    const distance = power < low ? low - power : power - high;

    return {zone: distance <= tolerance ? 'near' : 'out', side};
}

// Number, {low, high}, Int -> Number (0 - 100)
// piecewise-linear and zoomed on the range, edges at
// low-3tol, low-tol, low, high, high+tol, high+3tol
function gaugePosition(power, range = {}, tolerance = 0) {
    const { low, high } = range;
    const edges = [
        low - 3 * tolerance, low - tolerance, low,
        high, high + tolerance, high + 3 * tolerance,
    ];

    if(power <= edges[0]) return 0;
    if(power >= edges[5]) return 100;
    if(power >= low && power <= high && high === low) return 50;

    for(let i = 1; i < edges.length; i++) {
        if(power <= edges[i]) {
            const span = edges[i] - edges[i-1];
            if(span <= 0) return gaugeStops[i];
            const ratio = (power - edges[i-1]) / span;
            return gaugeStops[i-1] + ratio * (gaugeStops[i] - gaugeStops[i-1]);
        }
    }
    return 100;
}

// share of samples inside the range, for the current interval
function TimeInRange() {
    let inside = 0;
    let total  = 0;

    function add(isInside) {
        total += 1;
        if(isInside) inside += 1;
        return percent();
    }

    function reset() {
        inside = 0;
        total  = 0;
        return 0;
    }

    function percent() {
        if(total === 0) return 0;
        return Math.round(100 * inside / total);
    }

    return Object.freeze({ add, reset, percent, });
}

export {
    singleTargetBand,
    intensityLimits,
    clampIntensity,
    scaleWatts,
    scaleRange,
    toWatts,
    gaugeStops,
    stepRange,
    hasRange,
    toleranceWatts,
    rangeStatus,
    gaugePosition,
    TimeInRange,
};
