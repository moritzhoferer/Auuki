/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import {
    decodeFrame,
    Di2Buttons,
    toControlMessages,
} from '../../src/ble/di2/di2.js';
import { openBikeControl } from '../../src/ble/obc/controls.js';

// frames captured from an RDR8150 (fw 4.1.0.0) on 2026-11-25
function frame(hex) {
    const bytes = hex.split(' ').map((b) => parseInt(b, 16));
    return new DataView(new Uint8Array(bytes).buffer);
}

describe('decodeFrame', () => {
    test('splits each channel byte into type and sequence', () => {
        expect(decodeFrame(frame('23 44 f0 f0 f0'))).toEqual({
            counter: 0x23,
            channels: [{channel: 1, type: 'double', seq: 4}],
        });
    });

    test('skips unassigned channels', () => {
        expect(decodeFrame(frame('28 08 11 f0 f0')).channels).toEqual([
            {channel: 1, type: 'release', seq: 8},
            {channel: 2, type: 'short', seq: 1},
        ]);
    });

    test('rejects short frames', () => {
        expect(decodeFrame(frame('04 ff ff'))).toBeUndefined();
        expect(decodeFrame(undefined)).toBeUndefined();
    });
});

describe('Di2Buttons', () => {
    // 3x short, double, long hold on ch1, then the same on ch2
    const session = [
        ['20 11 f0 f0 f0', []], // baseline: last press before connecting
        ['21 12 f0 f0 f0', [{channel: 1, press: 'short'}]],
        ['22 13 f0 f0 f0', [{channel: 1, press: 'short'}]],
        ['23 44 f0 f0 f0', [{channel: 1, press: 'double'}]],
        ['24 25 f0 f0 f0', [{channel: 1, press: 'long'}]],
        ['25 36 f0 f0 f0', [{channel: 1, press: 'held'}]],
        ['26 37 f0 f0 f0', [{channel: 1, press: 'held'}]],
        ['27 08 f0 f0 f0', [{channel: 1, press: 'release'}]],
        ['28 08 11 f0 f0', [{channel: 2, press: 'short'}]],
        ['29 08 12 f0 f0', [{channel: 2, press: 'short'}]],
        ['2a 08 13 f0 f0', [{channel: 2, press: 'short'}]],
        ['2b 08 44 f0 f0', [{channel: 2, press: 'double'}]],
        ['2c 08 25 f0 f0', [{channel: 2, press: 'long'}]],
        ['2d 08 36 f0 f0', [{channel: 2, press: 'held'}]],
        ['2e 08 37 f0 f0', [{channel: 2, press: 'held'}]],
        ['2f 08 38 f0 f0', [{channel: 2, press: 'held'}]],
        ['21 08 09 f0 f0', [{channel: 2, press: 'release'}]], // global counter wraps
    ];

    test('recorded session yields one event per press', () => {
        const buttons = Di2Buttons();
        for(const [hex, expected] of session) {
            expect(buttons.decode(frame(hex))).toEqual(expected);
        }
    });

    test('a repeated frame is not a new press', () => {
        const buttons = Di2Buttons();
        buttons.decode(frame('20 11 f0 f0 f0'));
        expect(buttons.decode(frame('21 12 f0 f0 f0'))).toHaveLength(1);
        expect(buttons.decode(frame('21 12 f0 f0 f0'))).toEqual([]);
    });

    test('reset makes the next frame a baseline again', () => {
        const buttons = Di2Buttons();
        buttons.decode(frame('20 11 f0 f0 f0'));
        buttons.reset();
        expect(buttons.decode(frame('21 12 f0 f0 f0'))).toEqual([]);
    });
});

describe('toControlMessages', () => {
    const pressed = (action) => ({action, state: 'pressed'});

    test.each([
        [2, 'short', [pressed('increaseDifficulty')]],
        [1, 'short', [pressed('decreaseDifficulty')]],
        [2, 'long', [pressed('skipInterval')]],
        [1, 'long', [pressed('previousInterval')]],
        [1, 'double', [pressed('togglePause')]],
        [2, 'double', [pressed('togglePause')]],
        [1, 'held', []],
        [1, 'release', []],
        [3, 'short', []],
    ])('channel %i %s', (channel, press, expected) => {
        expect(toControlMessages([{channel, press}])).toEqual(expected);
    });
});

describe('togglePause', () => {
    const toggle = [{action: 'togglePause', state: 'pressed'}];
    const events = (watchStatus) => openBikeControl
        .controlsFor(toggle, {mode: 'erg', watchStatus})
        .map((a) => a.event);

    test('pauses a running workout', () => {
        expect(events('started')).toEqual(['ui:watchPause']);
    });

    test('resumes a paused workout', () => {
        expect(events('paused')).toEqual(['ui:watchResume']);
    });

    test('does not start a stopped workout', () => {
        expect(events('stopped')).toEqual([]);
    });
});

describe('ble:di2:buttonState', () => {
    test('right (channel 2) short press raises the power target in erg', () => {
        xf.create({mode: 'erg', watchStatus: 'started'});

        let notches = 0;
        xf.reg('ui:power-target-inc', () => { notches += 1; });

        const buttons = Di2Buttons();
        buttons.decode(frame('20 08 11 f0 f0'));
        const messages = toControlMessages(buttons.decode(frame('21 08 12 f0 f0')));
        xf.dispatch('ble:di2:buttonState', messages);

        expect(notches).toBe(1);
    });
});
