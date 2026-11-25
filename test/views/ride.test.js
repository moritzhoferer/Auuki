/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import '../../src/views/ride.js';

const frame = () => new Promise(resolve => window.requestAnimationFrame(resolve));

function setDb(values) {
    for(const [prop, value] of Object.entries(values)) {
        xf.dispatch(`db:${prop}`, {[prop]: value});
    }
}

describe('<pacing-box>', () => {
    let box;

    beforeEach(() => {
        document.body.innerHTML = `
            <pacing-box data-zone="none">
                <div class="rp-pacing--status"></div>
                <span class="rp-pacing--power"></span>
                <span class="rp-gauge--low"></span><span class="rp-gauge--high"></span>
                <div class="rp-gauge--needle"></div>
                <div class="rp-gauge--avg"></div>
            </pacing-box>`;
        box = document.querySelector('pacing-box');
    });

    test('neutral without a range or while stopped', async () => {
        setDb({power3s: 270, powerTargetRange: {low: 0, high: 0}, watchStatus: 'started'});
        await frame();
        expect(box.dataset.zone).toBe('none');
        expect(box.querySelector('.rp-pacing--power').textContent).toBe('270');

        setDb({powerTargetRange: {low: 265, high: 275}, watchStatus: 'stopped'});
        await frame();
        expect(box.dataset.zone).toBe('none');
    });

    test.each([
        [270, 'in',   '● IN RANGE · hold it',      50],
        [255, 'near', '▼ SLIGHTLY LOW · push',     undefined],
        [350, 'out',  '▲ TOO HIGH · ease off',     100],
    ])('%i W is %s', async (power, zone, text, needle) => {
        setDb({ftp: 295, powerTolerance: 7, powerTargetRange: {low: 265, high: 275},
               watchStatus: 'started', powerLap: 0, power3s: power});
        await frame();
        expect(box.dataset.zone).toBe(zone);
        expect(box.querySelector('.rp-pacing--status').textContent).toBe(text);
        expect(box.querySelector('.rp-gauge--low').textContent).toBe('265');
        if(needle !== undefined) {
            expect(box.querySelector('.rp-gauge--needle').style.left).toBe(`${needle}%`);
        }
        expect(box.querySelector('.rp-gauge--avg').style.display).toBe('none');
    });

    test('interval average diamond with its own status', async () => {
        setDb({ftp: 295, powerTolerance: 7, powerTargetRange: {low: 265, high: 275},
               watchStatus: 'started', power3s: 270, powerLap: 250});
        await frame();
        const avg = box.querySelector('.rp-gauge--avg');
        expect(avg.style.display).toBe('');
        expect(avg.dataset.zone).toBe('near');
    });
});

describe('<ride-controls>', () => {
    let events;
    let abort;

    afterEach(() => abort.abort());

    beforeEach(async () => {
        document.body.innerHTML = `<ride-controls></ride-controls>`;
        events = [];
        abort = new AbortController();
        ['ui:ride:toggle', 'ui:ride:finish', 'ui:watchLap', 'ui:watchBack'].forEach(name => {
             xf.sub(name, () => events.push(name), {signal: abort.signal});
        });
        await frame();
    });

    const $ = (selector) => document.querySelector(selector);

    test('buttons are labelled and follow the watch', async () => {
        setDb({watchStatus: 'stopped', rideKind: 'workout'}); await frame();
        expect($('.ride-controls--play').getAttribute('aria-label')).toBe('Start (space)');
        expect($('.ride-controls--skip').disabled).toBe(true);
        expect($('.ride-controls--finish').disabled).toBe(true);

        setDb({watchStatus: 'started'}); await frame();
        expect($('.ride-controls--play').getAttribute('aria-label')).toBe('Pause (space)');
        expect($('.ride-controls--play use').getAttribute('href')).toBe('#icon-pause');
        expect($('.ride-controls--skip').getAttribute('aria-label')).toBe('Skip to the next interval (L)');

        expect($('.ride-controls--back').disabled).toBe(true);   // first interval
        setDb({intervalIndex: 2}); await frame();
        expect($('.ride-controls--back').disabled).toBe(false);

        setDb({rideKind: 'free'}); await frame();
        expect($('.ride-controls--skip').getAttribute('aria-label')).toBe('New lap (L)');
    });

    test('previous and next also work while paused', async () => {
        setDb({watchStatus: 'paused', rideKind: 'workout', intervalIndex: 0}); await frame();
        expect($('.ride-controls--play').getAttribute('aria-label')).toBe('Resume (space)');
        expect($('.ride-controls--skip').disabled).toBe(false);
        expect($('.ride-controls--back').disabled).toBe(true);   // first interval
        setDb({intervalIndex: 1}); await frame();
        expect($('.ride-controls--back').disabled).toBe(false);

        $('.ride-controls--skip').click();
        $('.ride-controls--back').click();
        expect(events).toEqual(['ui:watchLap', 'ui:watchBack']);
    });

    test('clicks dispatch intents', async () => {
        setDb({watchStatus: 'started', rideKind: 'workout'}); await frame();
        $('.ride-controls--play').click();
        setDb({intervalIndex: 1}); await frame();
        $('.ride-controls--skip').click();
        $('.ride-controls--back').click();
        $('.ride-controls--finish').click();
        expect(events).toEqual(['ui:ride:toggle', 'ui:watchLap', 'ui:watchBack', 'ui:ride:finish']);
    });
});
