/**
 * @jest-environment jsdom
 */

const mockStore = new Map();
let mockFailWrites = false;

jest.mock('../../src/storage/idb.js', () => ({
    idb: {
        // like idb.js: a failed write still resolves
        put: jest.fn(async (_, item) => { if(!mockFailWrites) mockStore.set(item.id, item); return mockFailWrites ? [] : item.id; }),
        get: jest.fn(async (_, id) => mockStore.get(id)),
        getAll: jest.fn(async () => [...mockStore.values()]),
        remove: jest.fn(async (_, id) => mockStore.delete(id)),
    },
}));
jest.mock('../../src/models/server.js', () => ({
    server: { addRide: jest.fn(async () => ({ok: false, error: 'SERVER_UNREACHABLE'})) },
}));
jest.mock('../../src/file.js', () => ({ fileHandler: { toBlob: (x) => x } }));
jest.mock('../../src/fit/fit.js', () => ({ fit: { localActivity: { encode: () => 'fit' } } }));

import { rides } from '../../src/models/rides.js';

const db = {records: [{timestamp: 1000, heart_rate: 120}], laps: [], events: [], ftp: 250,
    rideKind: 'free', distance: 1000, powerAvg: 200, cadenceAvg: 90, kcal: 100};

beforeEach(() => { mockStore.clear(); mockFailWrites = false; });

describe('rides.save without the server', () => {
    test('keeps the ride on this device for the rider', async () => {
        const saved = await rides.save(db, 'a', 60);
        expect(saved.pending).toBe(true);
        expect(await rides.pendingSummaries('a')).toEqual([saved.ride]);
        expect(await rides.pendingSummaries('b')).toEqual([]);
    });

    test('says so when this device could not keep it either', async () => {
        mockFailWrites = true;
        expect(await rides.save(db, 'a', 60)).toBeNull();
    });
});

describe('rides.keep', () => {
    test('puts a ride aside for another rider', async () => {
        const kept = await rides.keep(db, 'b', 60);
        expect(kept.ride.duration).toBe(60);
        expect((await rides.pendingSummaries('b')).length).toBe(1);
    });
});

test('first upload and queued retry both specify the recording owner', async () => {
    const {server} = require('../../src/models/server.js');
    await rides.save(db, 'a', 60);
    expect(server.addRide).toHaveBeenLastCalledWith('fit', expect.any(Object), 'a');
    server.addRide.mockClear();
    expect(await rides.flush('a')).toBe(1);
    expect(server.addRide).toHaveBeenCalledWith('fit', expect.any(Object), 'a');
    expect(await rides.pendingSummaries('a')).toHaveLength(1);
});
