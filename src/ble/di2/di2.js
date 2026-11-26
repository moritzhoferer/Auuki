//
// Shimano Di2 D-Fly buttons
//
// Undocumented by Shimano. Verified on an RDR8150 (Ultegra 12-speed, fw 4.1.0.0).
//
// Service:        000018ef-5348-494d-414e-4f5f424c4500 (D-Fly)
// Characteristic: 00002ac2-5348-494d-414e-4f5f424c4500 (indicate)
//
// Frame: [counter, ch1, ch2, ch3, ch4]
// - counter: global, low nibble cycles 1..15, do not rely on it for dedupe
// - each channel byte: high nibble = press type, low nibble = per-channel sequence
//   - type: 0x1 short, 0x2 long (start), 0x3 held (repeats ~1/s), 0x4 double, 0x0 release
//   - 0xF0 = channel not assigned to D-Fly in E-TUBE
//   - a new event on a channel = its sequence nibble changed
// - the first frame after subscribing repeats the last event before the
//   connection and must be ignored
//

import { expect, } from '../../functions.js';
import { uuids, } from '../web-ble.js';
import { Service } from '../service.js';

const PressType = Object.freeze({
    release: 'release',
    short: 'short',
    long: 'long',
    held: 'held',
    double: 'double',
});

const pressTypes = {
    0x0: PressType.release,
    0x1: PressType.short,
    0x2: PressType.long,
    0x3: PressType.held,
    0x4: PressType.double,
};

const unassigned = 0xF;
const channelCount = 4;

// DataView -> {counter: Int, channels: [{channel: Int, type: String?, seq: Int}]} | undefined
function decodeFrame(dataview) {
    if(!dataview || dataview.byteLength < 1 + channelCount) return undefined;

    const channels = [];
    for(let i = 1; i <= channelCount; i++) {
        const byte = dataview.getUint8(i);
        const nibble = byte >> 4;
        if(nibble === unassigned) continue;
        channels.push({
            channel: i,
            type: pressTypes[nibble],
            seq: byte & 0x0F,
        });
    }

    return {counter: dataview.getUint8(0), channels};
}

// Stateful: tracks the last sequence per channel, so create one per connection.
//
// Void -> {decode: DataView -> [{channel: Int, press: String}], reset: Void -> Void}
function Di2Buttons() {
    let lastSeq = {};
    let baseline = true;

    function reset() {
        lastSeq = {};
        baseline = true;
    }

    function decode(dataview) {
        const frame = decodeFrame(dataview);
        if(!frame) return [];

        const events = [];
        for(const {channel, type, seq} of frame.channels) {
            const changed = lastSeq[channel] !== seq;
            lastSeq[channel] = seq;
            if(baseline || !changed || !type) continue;
            events.push({channel, press: type});
        }
        baseline = false;

        return events;
    }

    return Object.freeze({decode, reset});
}

// Which D-Fly channel sits on which lever depends on the E-TUBE assignment and
// can't be read over BLE. Default: left lever -> channel 1, right lever -> channel 2.
// The rider can swap them (sources.di2Swap).
//
// Bool -> {left: Int, right: Int}
function channels(swap = false) {
    return swap ? {left: 2, right: 1} : {left: 1, right: 2};
}

// Maps Di2 events to the same messages Open Bike Control produces,
// so obc/controls.js can turn them into app actions (it applies sources.di2Swap).
//
// right short: harder, right long: next interval
// left short:  easier, left long:  previous interval
// double, held and release do nothing
//
// [{channel, press}], {swap: Bool} -> [{action: String, state: 'pressed'}]
function toControlMessages(events = [], {swap = false} = {}) {
    const Channel = channels(swap);
    const messages = [];

    for(const {channel, press} of events) {
        let action;

        if(channel === Channel.right && press === PressType.short) {
            action = 'increaseDifficulty';
        } else if(channel === Channel.left && press === PressType.short) {
            action = 'decreaseDifficulty';
        } else if(channel === Channel.right && press === PressType.long) {
            action = 'skipInterval';
        } else if(channel === Channel.left && press === PressType.long) {
            action = 'previousInterval';
        }

        if(action) messages.push({action, state: 'pressed'});
    }

    return messages;
}

function Di2(args = {}) {
    const onData = args.onData;

    const gattService = expect(
        args.service, 'Di2 needs BluetoothRemoteGATTService!'
    );

    const buttons = Di2Buttons();

    const spec = {
        measurement: {
            uuid: uuids.di2Buttons,
            notify: {
                callback: onData,
                parser: {decode: buttons.decode},
                // without button notifications the device does nothing
                required: true,
            },
        },
    };

    const service = Service({spec, service: gattService,});

    return Object.freeze({
        ...service,
    });
}

export {
    PressType,
    decodeFrame,
    Di2Buttons,
    toControlMessages,
};

export default Di2;
