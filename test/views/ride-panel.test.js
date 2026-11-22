/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import '../../src/views/ride-panel.js';

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

describe('<panel-watch>', () => {
    let events;
    let abort;

    afterEach(() => abort.abort());

    beforeEach(() => {
        document.body.innerHTML = `
            <panel-watch>
                <button class="rp-watch--play"><svg><use href="#icon--play-btn"/></svg></button>
                <button class="rp-watch--skip"><svg><use href="#icon--skip-next-btn"/></svg></button>
                <div class="rp-finish">
                    <button class="rp-finish--save"></button>
                    <button class="rp-finish--resume"></button>
                    <button class="rp-finish--discard"></button>
                </div>
            </panel-watch>`;
        events = [];
        abort = new AbortController();
        ['ui:watchStart', 'ui:workoutStart', 'ui:watchPause', 'ui:watchResume',
         'ui:watchLap', 'ui:watchStop', 'ui:activity:save'].forEach(name => {
             xf.sub(name, () => events.push(name), {signal: abort.signal});
         });
    });

    const tap = (selector) => document.querySelector(selector)
          .dispatchEvent(new Event('pointerup', {bubbles: true}));

    test('play starts, pauses and resumes', async () => {
        setDb({watchStatus: 'stopped'}); await frame();
        tap('.rp-watch--play');
        setDb({watchStatus: 'started'}); await frame();
        expect(document.querySelector('.rp-watch--play use').getAttribute('href')).toBe('#icon--pause-btn');
        tap('.rp-watch--play');
        setDb({watchStatus: 'paused'}); await frame();
        tap('.rp-watch--play');
        expect(events).toEqual(['ui:watchStart', 'ui:workoutStart', 'ui:watchPause', 'ui:watchResume']);
    });

    test('skip while running, stop only while paused', async () => {
        setDb({watchStatus: 'started'}); await frame();
        tap('.rp-watch--skip');
        expect(events).toEqual(['ui:watchLap']);
        expect(document.querySelector('.rp-finish').classList.contains('active')).toBe(false);

        setDb({watchStatus: 'paused'}); await frame();
        expect(document.querySelector('.rp-watch--skip use').getAttribute('href')).toBe('#icon--stop-btn');
        tap('.rp-watch--skip');
        expect(document.querySelector('.rp-finish').classList.contains('active')).toBe(true);
        expect(events).toEqual(['ui:watchLap']);

        tap('.rp-finish--save');
        expect(events).toEqual(['ui:watchLap', 'ui:watchStop', 'ui:activity:save']);
        expect(document.querySelector('.rp-finish').classList.contains('active')).toBe(false);
    });
});
