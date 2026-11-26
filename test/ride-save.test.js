/**
 * @jest-environment jsdom
 */
import {xf} from '../src/functions.js';
import {models} from '../src/models/models.js';
import {server} from '../src/models/server.js';
import {rides} from '../src/models/rides.js';
import '../src/app.js';

let mockSnapshot;
jest.mock('../src/storage/idb.js', () => ({idb: {
    put: (_, session) => { mockSnapshot = session; },
    setId: session => session,
    getAll: () => mockSnapshot ? [mockSnapshot] : [],
}}));
jest.mock('../src/models/server.js', () => ({server: {
    me: jest.fn(), login: jest.fn(), riders: async () => ({ok: true, data: [{}]}),
    rides: async () => ({ok: true, data: []}),
}}));
jest.mock('../src/models/rides.js', () => ({rides: {
    flush: jest.fn(), pendingSummaries: async () => [], save: jest.fn(), keep: jest.fn(),
}}));

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const rider = id => ({ok: true, data: {id, ftp: 200, weight: 70}});
const fresh = () => ({watchStatus: 'stopped', elapsed: 0, rides: [], records: [], rideKind: 'free'});

xf.reg('ui:watchStop', (_, db) => { db.watchStatus = 'stopped'; db.elapsed = 0; });
xf.reg('ui:watchStart', (_, db) => { db.watchStatus = 'started'; });
xf.reg('ui:sheet', (sheet, db) => { db.sheet = sheet; });
xf.reg('ui:screen', (screen, db) => { db.screen = screen; });
xf.reg('ui:notice', (notice, db) => { db.notice = notice; });

async function open(state, id) {
    xf.create(state);
    server.me.mockResolvedValue(rider(id));
    xf.dispatch('app:ready');
    await settle();
}

beforeEach(() => { mockSnapshot = null; jest.clearAllMocks(); });

test('a pending save blocks competing actions and can be retried after reload', async () => {
    const state = fresh();
    await open(state, 'a');
    xf.dispatch('ui:ride:start');
    state.elapsed = 60;
    state.records = [{timestamp: 1000}];
    let finish;
    rides.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    xf.dispatch('ui:ride:save');
    await settle();
    for(const action of ['start', 'discard', 'resume', 'save']) xf.dispatch('ui:ride:' + action);
    expect(state.records).toHaveLength(1);
    expect(state.watchStatus).toBe('stopped');
    expect(rides.save).toHaveBeenCalledTimes(1);
    finish(null);
    await settle();
    const restored = fresh();
    await models.session.restore(restored);
    await open(restored, 'a');
    expect(restored.sheet).toBe('finish');
    expect(restored.records).toEqual([{timestamp: 1000}]);
    rides.save.mockResolvedValueOnce({ride: {id: 'saved'}, pending: false});
    xf.dispatch('ui:ride:save');
    await settle();
    expect(rides.save).toHaveBeenLastCalledWith(expect.any(Object), 'a', 60);
    expect(restored.screen).toBe('summary');
});

test('failed recovery refuses the other rider and keeps the original owner', async () => {
    const state = {...fresh(), watchStatus: 'paused', elapsed: 60, sessionRider: 'a'};
    rides.keep.mockResolvedValueOnce(null);
    await open(state, 'b');
    expect(state.rider).toBeNull();
    expect(state.screen).toBe('riders');
    for(const action of ['start', 'discard', 'save']) xf.dispatch('ui:ride:' + action);
    expect(state.unsavedElapsed).toBe(60);
    expect(mockSnapshot.sessionRider).toBe('a');
    expect(rides.save).not.toHaveBeenCalled();
    server.login.mockResolvedValueOnce(rider('a'));
    xf.dispatch('ui:rider:pick', {id: 'a'});
    await settle();
    expect(state.sheet).toBe('finish');
    expect(state.rider.id).toBe('a');
});

test('a successful retry clears the error of the failed save', async () => {
    const state = fresh();
    await open(state, 'a');
    xf.dispatch('ui:ride:start');
    state.elapsed = 60;
    rides.save.mockResolvedValueOnce(null);
    xf.dispatch('ui:ride:save');
    await settle();
    expect(state.notice).toMatch(/couldn't be saved/);
    rides.save.mockResolvedValueOnce({ride: {id: 'saved'}, pending: false});
    xf.dispatch('ui:ride:save');
    await settle();
    expect(state.screen).toBe('summary');
    expect(state.notice).toBe('');
});
