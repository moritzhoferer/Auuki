/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import { models } from '../../src/models/models.js';

describe('RollingInterval', () => {
    jest.useFakeTimers();

    const emitted = [];
    xf.sub('rolling:test', (x) => emitted.push(x));

    const rolling = new models.RollingInterval({
        prop: 'test:power',
        effect: 'rolling:test',
        interval: 1000,
        window: 3,
    });

    // 4 samples per second, like a trainer at 4 Hz
    function second(watts) {
        for(let i = 0; i < 4; i++) {
            xf.dispatch('test:power', watts);
            jest.advanceTimersByTime(250);
        }
    }

    beforeEach(() => {
        emitted.length = 0;
    });

    test('emits every second, averaging what is there before the window is full', () => {
        second(100);
        expect(emitted).toEqual([100]);

        second(200);
        expect(emitted).toEqual([100, 150]);

        second(300);
        expect(emitted).toEqual([100, 150, 200]);
    });

    test('drops samples older than the window', () => {
        second(400);
        expect(emitted).toEqual([300]); // 200, 300, 400

        second(400);
        second(400);
        expect(emitted).toEqual([300, 1100 / 3, 400]);
    });

    test('a second averages its own samples', () => {
        xf.dispatch('test:power', 100);
        jest.advanceTimersByTime(500);
        xf.dispatch('test:power', 300);
        jest.advanceTimersByTime(500);

        expect(emitted).toEqual([1000 / 3]); // 400, 400, 200
    });

    test('no samples, no update', () => {
        jest.advanceTimersByTime(3000);
        expect(emitted).toEqual([]);
    });

    test('power3s is a rolling 3s average updated every second', () => {
        expect(models.power3s).toBeInstanceOf(models.RollingInterval);
        expect(models.power3s.interval).toBe(1000);
        expect(models.power3s.window).toBe(3);
    });
});
