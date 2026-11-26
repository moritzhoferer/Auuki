import { xf } from '../functions.js';

//
// Client for the self-hosted server (server/app/main.py), same origin.
// Every call resolves to {ok, status, data, error}; it never throws.
// A 401 means "no rider logged in" and is broadcast as 'server:logged-out'.
//

async function request(method, path, body) {
    const options = { method, credentials: 'same-origin', headers: {} };

    if(body instanceof FormData) {
        options.body = body;
    } else if(body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`/api${path}`, options);
        const type = response.headers.get('Content-Type') ?? '';
        const data = type.includes('json') ? await response.json() : await response.blob();

        if(response.status === 401) xf.dispatch('server:logged-out');

        return {
            ok: response.ok,
            status: response.status,
            data: response.ok ? data : undefined,
            error: response.ok ? '' : (data?.error?.message ?? `HTTP_${response.status}`),
        };
    } catch(e) {
        console.warn(`:server ${method} ${path} :unreachable`);
        return { ok: false, status: 0, data: undefined, error: 'SERVER_UNREACHABLE' };
    }
}

const server = Object.freeze({
    riders:          ()             => request('GET', '/riders'),
    createRider:     (name, pin)    => request('POST', '/riders', pin ? {name, pin} : {name}),
    login:           (rider, pin)   => request('POST', '/session', pin ? {rider, pin} : {rider}),
    logout:          ()             => request('DELETE', '/session'),
    logoutAll:       ()             => request('DELETE', '/sessions'),
    me:              ()             => request('GET', '/me'),
    updateMe:        (changes)      => request('PATCH', '/me', changes),
    deleteMe:        ()             => request('DELETE', '/me'),

    connectIntervals:    (apiKey, athleteId) => request('PUT', '/me/intervals', {apiKey, athleteId: athleteId || '0'}),
    disconnectIntervals: ()                  => request('DELETE', '/me/intervals'),
    planned: (oldest, newest) => request('GET', `/me/intervals/events?oldest=${oldest}&newest=${newest}`),

    setBodySource: (source) => request('PUT', '/me/body-source', {source}),
    syncBody:      ()       => request('POST', '/me/body/sync'),

    connectGarmin:    (email, password) => request('POST', '/me/garmin', {email, password}),
    garminCode:       (code)            => request('POST', '/me/garmin/mfa', {code}),
    disconnectGarmin: ()                => request('DELETE', '/me/garmin'),

    rides:      ()                => request('GET', '/me/rides'),
    rideFile:   (id)              => request('GET', `/me/rides/${encodeURIComponent(id)}/file`),
    deleteRide: (id)              => request('DELETE', `/me/rides/${encodeURIComponent(id)}`),
    uploadRide: (id, service)     => request('POST', `/me/rides/${encodeURIComponent(id)}/upload/${service}`),
    addRide(blob, summary, riderId) {
        const form = new FormData();
        form.append('riderId', riderId);
        form.append('file', blob, 'ride.fit');
        form.append('summary', JSON.stringify(summary));
        return request('POST', '/me/rides', form);
    },
});

// error code -> text for the person on the bike
const messages = {
    SERVER_UNREACHABLE:      "Can't reach the Auuki server. Check that it's running.",
    WRONG_PIN:               "That PIN doesn't match. Try again.",
    TOO_MANY_TRIES:          'Too many wrong PINs. Wait a while and try again; each new round locks longer.',
    INTERVALS_KEY_REJECTED:  'Intervals.icu rejected that API key. Check it and the athlete ID.',
    INTERVALS_UNREACHABLE:   "Can't reach Intervals.icu right now. Try again later.",
    INTERVALS_NOT_CONNECTED: 'Connect Intervals.icu in settings first.',
    GARMIN_FAILED:           "Garmin didn't accept that. Check your login and try again.",
    GARMIN_NOT_CONNECTED:    'Connect Garmin in settings first.',
};

function errorText(code = '') {
    if(messages[code]) return messages[code];
    if(code.startsWith('INTERVALS_')) return "Intervals.icu didn't answer as expected. Try again later.";
    return 'Something went wrong. Try again.';
}

export { server, errorText };
