/**
 * @jest-environment jsdom
 */

import { Characteristic } from '../../src/ble/characteristic.js';
import Connectable from '../../src/ble/connectable.js';
import { uuids } from '../../src/ble/web-ble.js';

global.console = {...console, log: jest.fn(), warn: jest.fn(), error: jest.fn()};

const frame = (...bytes) => new DataView(new Uint8Array(bytes).buffer);

// a GATT characteristic that can send a value as soon as notifications start
// (Di2 sends its current button state right away) and can refuse to start
function FakeCharacteristic(uuid, {sendOnStart, failStarts = 0} = {}) {
    const target = new EventTarget();
    target.uuid = uuid;
    target.properties = {notify: true};
    target.starts = 0;
    target.send = (value) => {
        const e = new Event('characteristicvaluechanged');
        Object.defineProperty(e, 'target', {value: {value}});
        target.dispatchEvent(e);
    };
    target.startNotifications = async () => {
        target.starts += 1;
        if(target.starts <= failStarts) throw new Error('GATT operation failed');
        if(sendOnStart) target.send(sendOnStart);
    };
    target.stopNotifications = async () => {};
    return target;
}

// a Di2 junction box: one service with the buttons characteristic
function FakeDi2(characteristic) {
    const device = new EventTarget();
    const service = {uuid: uuids.di2, getCharacteristics: async () => [characteristic]};
    device.id = 'di2';
    device.name = 'RDR8150';
    device.gatt = {
        connected: false,
        connect: async () => {
            device.gatt.connected = true;
            return {getPrimaryServices: async () => [service]};
        },
        disconnect: () => { device.gatt.connected = false; },
    };
    device.drop = () => {
        device.gatt.connected = false;
        device.dispatchEvent(new Event('gattserverdisconnected'));
    };
    return device;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Characteristic notifications', () => {
    test('a value sent right when notifications start is not missed', async () => {
        const gatt = FakeCharacteristic('x', {sendOnStart: frame(1)});
        const handler = jest.fn();
        await Characteristic({characteristic: gatt, name: 'test'}).startNotifications(handler);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('a failed start leaves no listener behind', async () => {
        const gatt = FakeCharacteristic('x', {failStarts: 1});
        const handler = jest.fn();
        expect(await Characteristic({characteristic: gatt, name: 'test'}).startNotifications(handler)).toBe(false);
        gatt.send(frame(1));
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('Di2 connection', () => {
    test('without button notifications the connection fails instead of showing connected', async () => {
        jest.useFakeTimers();
        const gatt = FakeCharacteristic(uuids.di2Buttons, {failStarts: 99});
        const device = FakeDi2(gatt);
        const onConnected = jest.fn();
        const onConnectFail = jest.fn();
        const di2 = Connectable({device, onConnected, onConnectFail});

        const connecting = di2.connect();
        await jest.runAllTimersAsync();   // the notification retries
        await connecting;
        jest.useRealTimers();

        expect(onConnected).not.toHaveBeenCalled();
        expect(onConnectFail).toHaveBeenCalledTimes(1);
        expect(di2.isConnected()).toBe(false);
        expect(device.gatt.connected).toBe(false);
    });

    test('after a dropout: not connected at once, and one value per press after reconnecting', async () => {
        const gatt = FakeCharacteristic(uuids.di2Buttons);
        const device = FakeDi2(gatt);
        const onData = jest.fn();
        const onDisconnect = jest.fn();
        const onConnected = jest.fn();
        const di2 = Connectable({device, onData, onDisconnect, onConnected});

        await di2.connect();
        expect(di2.isConnected()).toBe(true);

        device.drop();
        expect(di2.isConnected()).toBe(false);
        expect(onDisconnect).toHaveBeenCalledTimes(1);
        await settle();                    // reconnects to the same device
        await settle();
        expect(onConnected).toHaveBeenCalledTimes(2);
        expect(di2.isConnected()).toBe(true);

        onData.mockClear();
        gatt.send(frame(0x28, 0xf0, 0x11, 0xf0, 0xf0));
        expect(onData).toHaveBeenCalledTimes(1);

        // a second dropout is handled once, not once per earlier connection
        device.drop();
        expect(onDisconnect).toHaveBeenCalledTimes(2);
    });
});
