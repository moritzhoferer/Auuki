import {
    workoutDuration, workoutPosition, stepIntensity, profileBlocks, smooth, stepLabel, intervalTarget,
} from '../../src/models/profile.js';

const ftp = 295;

const workout = {
    intervals: [
        {duration: 1800, steps: [{duration: 1800, power: 0.559, powerLow: 0.474, powerHigh: 0.644,
                                  messages: [{offset: 0, duration: 10, message: 'Press lap'}]}]},
        {duration: 1500, steps: [{duration: 1500, power: 0.915, powerLow: 0.898, powerHigh: 0.932}]},
        {duration: 300,  steps: [{duration: 300, power: 1.0}]},
        {duration: 120,  steps: [{duration: 60, slope: 2}, {duration: 60, slope: 4}]},
    ],
};

describe('workout geometry', () => {
    test('duration is the sum of the intervals', () => {
        expect(workoutDuration(workout)).toBe(3720);
        expect(workoutDuration(undefined)).toBe(0);
    });

    test('position from interval index and remaining lap time', () => {
        expect(workoutPosition(workout, 0, 1800)).toBe(0);
        expect(workoutPosition(workout, 0, 1700)).toBe(100);
        expect(workoutPosition(workout, 1, 1500)).toBe(1800);
        expect(workoutPosition(workout, 1, 0)).toBe(3300);
        expect(workoutPosition(workout, 3, 60)).toBe(3660);
    });

    test('blocks per step with start, duration and intensity', () => {
        const blocks = profileBlocks(workout, ftp);
        expect(blocks.length).toBe(5);
        expect(blocks[0]).toEqual({start: 0, duration: 1800, intensity: 0.559});
        expect(blocks[1].start).toBe(1800);
        expect(blocks[4]).toEqual({start: 3660, duration: 60, intensity: 0.5});
    });

    test('intensity of watt and slope steps', () => {
        expect(stepIntensity({power: 295}, ftp)).toBe(1);
        expect(stepIntensity({slope: 3}, ftp)).toBe(0.5);
        expect(stepIntensity({}, ftp)).toBe(0.3);
    });
});

describe('smooth', () => {
    test('trailing moving average', () => {
        expect(smooth([10, 20, 30, 40], 2)).toEqual([10, 15, 25, 35]);
        expect(smooth([], 10)).toEqual([]);
    });
});

describe('labels and targets', () => {
    test('label is the step text at offset 0', () => {
        expect(stepLabel(workout.intervals[0].steps[0])).toBe('Press lap');
        expect(stepLabel(workout.intervals[1].steps[0])).toBe('');
        expect(stepLabel({messages: [{offset: 30, message: 'later'}]})).toBe('');
        expect(stepLabel({messages: [{offset: 0, message: '- Warm up 10m'}]})).toBe('Warm up 10m');
        expect(stepLabel(undefined)).toBe('');
    });

    test('next interval target', () => {
        expect(intervalTarget(workout.intervals[1], ftp)).toBe('265–275 W');
        expect(intervalTarget(workout.intervals[2], ftp)).toBe('286–304 W');
        expect(intervalTarget(workout.intervals[3], ftp)).toBe('2.0 %');
        expect(intervalTarget({}, ftp)).toBe('');
    });
});
