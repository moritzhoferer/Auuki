import { exists, empty } from '../functions.js';
import { toWatts, stepRange } from './range.js';

//
// Helpers for the ride panel: workout geometry, position and labels.
// Times are in seconds, power in watts.
//

function intervalsOf(workout = {}) {
    return workout?.intervals ?? [];
}

// Workout -> Int
function workoutDuration(workout) {
    return intervalsOf(workout).reduce((acc, interval) => acc + (interval.duration ?? 0), 0);
}

// Workout, Int, Int -> Int
// seconds done in the workout, lapTime is the remaining time in the interval
function workoutPosition(workout, intervalIndex = 0, lapTime = 0) {
    const intervals = intervalsOf(workout);
    let done = 0;

    for(let i = 0; i < Math.min(intervalIndex, intervals.length); i++) {
        done += intervals[i].duration ?? 0;
    }

    const current = intervals[intervalIndex]?.duration ?? 0;

    return done + Math.max(0, current - lapTime);
}

// Step, Int -> Number
// intensity of a step as a fraction of FTP, slope steps get a mild default
function stepIntensity(step = {}, ftp = 0) {
    if(exists(step.power) && step.power > 0) {
        if(step.power < 9) return step.power;
        return ftp > 0 ? step.power / ftp : 0;
    }
    if(exists(step.slope)) return 0.5;
    return 0.3;
}

// Workout, Int -> [{start, duration, intensity}]
function profileBlocks(workout, ftp = 0) {
    const blocks = [];
    let cursor = 0;

    for(const interval of intervalsOf(workout)) {
        for(const step of interval.steps ?? []) {
            const duration = step.duration ?? 0;
            if(duration <= 0) continue;
            blocks.push({start: cursor, duration, intensity: stepIntensity(step, ftp)});
            cursor += duration;
        }
    }

    return blocks;
}

// [Number], Int -> [Number]
// trailing moving average
function smooth(values = [], window = 10) {
    const result = [];
    let sum = 0;

    for(let i = 0; i < values.length; i++) {
        sum += values[i];
        if(i >= window) sum -= values[i - window];
        result.push(sum / Math.min(i + 1, window));
    }

    return result;
}

// Step -> String
// the step's own text at its start, as written in the workout file
function stepLabel(step = {}) {
    const messages = step?.messages ?? [];
    const message  = messages.find(m => (m.offset ?? 0) === 0);
    if(!exists(message) || empty(message.message ?? '')) return '';
    return message.message.replace(/^[\s-]+/, '').trim();
}

// Interval, Int -> String
// target of an interval's first step for the 'up next' card
function intervalTarget(interval = {}, ftp = 0) {
    const step = interval?.steps?.[0] ?? {};

    if(exists(step.powerLow) && exists(step.powerHigh)) {
        const range = stepRange(step, ftp);
        return `${range.low}–${range.high} W`;
    }
    if(exists(step.power) && step.power > 0) {
        return `${toWatts(step.power, ftp)} W`;
    }
    if(exists(step.slope)) {
        return `${step.slope.toFixed(1)} %`;
    }
    return '';
}

export {
    workoutDuration,
    workoutPosition,
    stepIntensity,
    profileBlocks,
    smooth,
    stepLabel,
    intervalTarget,
};
