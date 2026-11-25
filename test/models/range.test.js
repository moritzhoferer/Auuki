/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import { models } from '../../src/models/models.js';
import { db } from '../../src/db.js';
import {
    stepRange, hasRange, toleranceWatts, rangeStatus, gaugePosition, TimeInRange,
} from '../../src/models/range.js';

const ftp = 295;

describe('stepRange', () => {
    test('range from PowerLow/PowerHigh', () => {
        expect(stepRange({duration: 1500, power: 0.915, powerLow: 0.898, powerHigh: 0.932}, ftp))
            .toEqual({low: 265, high: 275});
    });

    test('single value gets a ±3 % band', () => {
        expect(stepRange({duration: 60, power: 1.0}, ftp)).toEqual({low: 286, high: 304});
    });

    test('absolute watts stay watts', () => {
        expect(stepRange({duration: 60, power: 200}, ftp)).toEqual({low: 194, high: 206});
    });

    test('no power target, no range', () => {
        expect(stepRange({duration: 60, slope: 2}, ftp)).toEqual({low: 0, high: 0});
        expect(stepRange({duration: 60, power: 0, slope: 0}, ftp)).toEqual({low: 0, high: 0});
        expect(hasRange(stepRange({duration: 60}, ftp))).toBe(false);
    });
});

describe('rangeStatus', () => {
    const range = {low: 265, high: 275};
    const tol = toleranceWatts(7, ftp); // 21 W

    test('tolerance in watts', () => {
        expect(tol).toBe(21);
        expect(toleranceWatts(0, 100)).toBe(1);
    });

    test.each([
        [265, 'in',   'in'],
        [270, 'in',   'in'],
        [275, 'in',   'in'],
        [264, 'near', 'low'],
        [244, 'near', 'low'],
        [243, 'out',  'low'],
        [276, 'near', 'high'],
        [296, 'near', 'high'],
        [297, 'out',  'high'],
    ])('%i W -> %s %s', (power, zone, side) => {
        expect(rangeStatus(power, range, tol)).toEqual({zone, side});
    });

    test('no range', () => {
        expect(rangeStatus(200, {low: 0, high: 0}, tol)).toEqual({zone: 'none', side: 'none'});
    });
});

describe('gaugePosition', () => {
    const range = {low: 246, high: 263};
    const tol = 20;

    test.each([
        [0,   0],
        [186, 0],
        [206, 7.5],
        [226, 15],
        [246, 30],
        [263, 70],
        [283, 85],
        [303, 92.5],
        [323, 100],
        [999, 100],
    ])('%i W -> %d %%', (power, position) => {
        expect(gaugePosition(power, range, tol)).toBeCloseTo(position, 5);
    });

    test('middle of the range is the middle of the gauge', () => {
        expect(gaugePosition(254.5, range, tol)).toBeCloseTo(50, 5);
    });

    test('a range of one value', () => {
        expect(gaugePosition(250, {low: 250, high: 250}, tol)).toBe(50);
        expect(gaugePosition(249, {low: 250, high: 250}, tol)).toBeLessThan(30);
        expect(gaugePosition(251, {low: 250, high: 250}, tol)).toBeGreaterThan(70);
    });
});

describe('TimeInRange', () => {
    test('percent of samples inside', () => {
        const tir = TimeInRange();
        expect(tir.percent()).toBe(0);
        tir.add(true); tir.add(true); tir.add(false);
        expect(tir.percent()).toBe(67);
        expect(tir.reset()).toBe(0);
        expect(tir.add(true)).toBe(100);
    });
});

describe('db', () => {
    beforeEach(() => {
        window.localStorage.clear();
        xf.dispatch('watch:stopped');
    });

    test('tolerance setting is stored', () => {
        expect(db.powerTolerance).toBe(7);
        xf.dispatch('ui:power-tolerance-set', 10);
        expect(db.powerTolerance).toBe(10);
        expect(window.localStorage.getItem('powerTolerance')).toBe('10');
    });

    test('invalid tolerance falls back to the default', () => {
        xf.dispatch('ui:power-tolerance-set', 0);
        expect(db.powerTolerance).toBe(7);
    });

    test('time in range counts 3s power while the watch runs, reset on lap', () => {
        xf.dispatch('ui:power-target-range-set', {low: 265, high: 275});

        db.watchStatus = 'paused';
        xf.dispatch('power3s', 270);
        expect(db.timeInRange).toBe(0);

        db.watchStatus = 'started';
        xf.dispatch('power3s', 270);
        xf.dispatch('power3s', 272);
        xf.dispatch('power3s', 250);
        xf.dispatch('power3s', 275);
        expect(db.timeInRange).toBe(75);

        xf.dispatch('watch:lap');
        expect(db.timeInRange).toBe(0);
        xf.dispatch('power3s', 280);
        expect(db.timeInRange).toBe(0);
        xf.dispatch('power3s', 270);
        expect(db.timeInRange).toBe(50);
    });

    test('no range, no time in range', () => {
        db.watchStatus = 'started';
        xf.dispatch('ui:power-target-range-set', {low: 0, high: 0});
        xf.dispatch('power3s', 270);
        expect(db.timeInRange).toBe(0);
    });

    test('stop clears the range', () => {
        xf.dispatch('ui:power-target-range-set', {low: 265, high: 275});
        xf.dispatch('watch:stopped');
        expect(db.powerTargetRange).toEqual({low: 0, high: 0});
    });
});
