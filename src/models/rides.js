import { avg } from '../functions.js';
import { idb } from '../storage/idb.js';
import { uuid } from '../storage/uuid.js';
import { fileHandler } from '../file.js';
import { fit } from '../fit/fit.js';
import { server } from './server.js';

//
// A finished ride: encoded as FIT and kept on the server, per rider.
// When the server can't be reached the ride waits in IndexedDB ('activity' store)
// and is sent with the next sync.
//

const store = 'activity';

function encode(db) {
    return fileHandler.toBlob(fit.localActivity.encode({
        records: db.records,
        laps: db.laps,
        events: db.events,
        ftp: db.ftp,
    }));
}

function summarize(db, elapsed = db.elapsed) {
    const records = db.records.filter(r => r.timestamp);
    return {
        name: db.rideKind === 'free' ? 'Free ride' : (db.workout?.meta?.name || 'Ride'),
        timestamp: records[0]?.timestamp ?? Date.now(),
        duration: elapsed ?? 0,
        distance: Math.round(db.distance ?? 0),
        power: Math.round(db.powerAvg ?? 0),
        heartRate: Math.round(avg(records.filter(r => r.heart_rate > 0), 'heart_rate') || 0),
        cadence: Math.round(db.cadenceAvg ?? 0),
        kcal: Math.round(db.kcal ?? 0),
        ftp: db.ftp,
    };
}

// -> {ride, pending}
// elapsed: the moving time, read before the watch stops (stopping resets it)
async function save(db, riderId, elapsed = db.elapsed) {
    const blob = encode(db);
    const summary = summarize(db, elapsed);
    const result = await server.addRide(blob, summary);

    if(result.ok) return {ride: result.data, pending: false};

    const id = uuid();
    const ride = {...summary, id, pending: true, uploads: {garmin: 'none', intervals: 'none'}};
    await idb.put(store, {id, riderId, blob, summary: ride});
    return {ride, pending: true};
}

async function pending(riderId) {
    const records = await idb.getAll(store) ?? [];
    return records.filter(r => r.riderId === riderId && r.blob);
}

// send waiting rides to the server, -> number still waiting
async function flush(riderId) {
    let waiting = 0;
    for(const record of await pending(riderId)) {
        const { pending: _, id: __, uploads: ___, ...summary } = record.summary;
        const result = await server.addRide(record.blob, summary);
        if(result.ok) {
            await idb.remove(store, record.id);
        } else {
            waiting += 1;
        }
    }
    return waiting;
}

async function pendingSummaries(riderId) {
    return (await pending(riderId)).map(r => r.summary);
}

async function download(ride) {
    const name = `auuki-${new Date(ride.timestamp).toISOString().slice(0, 10)}.fit`;
    const result = await server.rideFile(ride.id);
    if(result.ok) {
        fileHandler.download()(result.data, name, fileHandler.Type.OctetStream);
    }
    return result.ok;
}

export const rides = Object.freeze({
    encode,
    summarize,
    save,
    flush,
    pendingSummaries,
    download,
});
