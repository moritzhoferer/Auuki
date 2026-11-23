import { xf, equals } from '../functions.js';
import { UIView, icon, html, duration } from './ui.js';

//
// <ride-list limit="3">  recent rides with their Garmin status
// <ride-summary>         the ride just saved: facts, then upload and download rows
//

function day(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    if(date.toDateString() === today.toDateString()) return 'Today';
    return date.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});
}

function rideFacts(ride) {
    return [
        ride.duration ? duration(ride.duration) : '',
        ride.power ? `${ride.power} W` : '',
        ride.heartRate ? `${ride.heartRate} bpm` : '',
    ].filter(Boolean).join(' · ');
}

function garminButton(ride, rider, size = 'btn--small') {
    if(ride.pending) return `<span class="status status--waiting">Waiting to sync</span>`;
    const status = ride.uploads?.garmin ?? 'none';
    if(equals(status, 'done')) return `<span class="status status--ok">${icon('check')} On Garmin</span>`;
    if(!rider?.garmin?.connected) {
        return `<button class="btn btn--ghost ${size}" data-action="screen" data-param="settings"
            aria-label="Connect Garmin in settings to upload">Connect Garmin</button>`;
    }
    const retry = equals(status, 'failed');
    return `<button class="btn ${size}" data-ride-upload data-service="garmin" data-param="${html(ride.id)}"
        aria-label="${retry ? 'Upload failed, try again' : 'Upload this ride to Garmin Connect'}">${retry ? 'Retry Garmin' : 'Upload to Garmin'}</button>`;
}

class RideList extends UIView {
    props() { return ['rides', 'rider']; }
    config() {
        this.limit = parseInt(this.getAttribute('limit') ?? '50');
        this.confirm = '';
        this.addEventListener('click', (e) => {
            const $btn = e.target.closest('[data-ride-delete]');
            if(!$btn) return;
            const id = $btn.dataset.rideDelete;
            if(equals(this.confirm, id)) {
                this.confirm = '';
                xf.dispatch('ui:ride:delete', id);
            } else {
                this.confirm = id;
                this.render();
                this.querySelector(`[data-ride-delete="${CSS.escape(id)}"]`)?.focus();
            }
        }, this.signal);
    }
    render() {
        const rides = (this.data.rides ?? []).slice(0, this.limit);
        if(rides.length === 0) {
            this.innerHTML = `<p class="muted">Your rides show up here.</p>`;
            return;
        }
        this.innerHTML = `<ul class="ride-rows">${rides.map(ride => `
            <li class="ride-row">
                <span class="ride-row--text">
                    <span class="ride-row--name">${html(day(ride.timestamp))} · ${html(ride.name)}</span>
                    <span class="ride-row--facts">${html(rideFacts(ride))}</span>
                </span>
                <span class="ride-row--actions">
                    ${garminButton(ride, this.data.rider)}
                    ${ride.pending || this.hasAttribute('compact') ? '' : `
                    <button class="btn btn--icon btn--ghost" data-action="ride:download" data-param="${html(ride.id)}"
                        aria-label="Download the FIT file">${icon('download')}</button>
                    <button class="btn btn--icon btn--ghost ${equals(this.confirm, ride.id) ? 'btn--danger' : ''}"
                        data-ride-delete="${html(ride.id)}"
                        aria-label="${equals(this.confirm, ride.id) ? 'Press again to delete this ride for good' : 'Delete this ride'}">${icon('trash')}</button>`}
                </span>
            </li>`).join('')}</ul>`;
    }
}

customElements.define('ride-list', RideList);

// both lists and the summary upload through here
document.addEventListener('click', (e) => {
    const $btn = e.target.closest('[data-ride-upload]');
    if(!$btn || $btn.disabled) return;
    $btn.disabled = true;
    $btn.textContent = 'Uploading…';
    xf.dispatch('ui:ride:upload', {id: $btn.dataset.param, service: $btn.dataset.service ?? 'garmin'});
});

// summary: one row per place the ride can go, like the account rows
const services = {intervals: 'Intervals.icu', garmin: 'Garmin Connect'};

function shareRow({iconName, label, status, on = false, action = ''}) {
    return `<div class="sensor-row" data-status="${on ? 'on' : 'off'}">
        ${icon(iconName, 'sensor-row--icon')}
        <span class="sensor-row--text"><span class="sensor-row--label">${html(label)}</span>
            <span class="sensor-row--status">${html(status)}</span></span>
        <span class="sensor-row--actions">${action}</span>
    </div>`;
}

function uploadRow(ride, rider, service) {
    const label = services[service];
    const status = ride.uploads?.[service] ?? 'none';
    if(ride.pending) return shareRow({iconName: service, label, status: 'Waiting to sync with the server'});
    if(equals(status, 'done')) return shareRow({iconName: service, label, status: 'Uploaded', on: true});
    if(!rider?.[service]?.connected) {
        return shareRow({iconName: service, label, status: 'Not connected',
            action: `<button class="btn btn--ghost" data-action="screen" data-param="settings"
                aria-label="Connect ${label} in settings">Connect</button>`});
    }
    const failed = equals(status, 'failed');
    return shareRow({iconName: service, label, status: failed ? 'Upload failed' : 'Not uploaded yet',
        action: `<button class="btn" data-ride-upload data-service="${service}" data-param="${html(ride.id)}"
            aria-label="Upload this ride to ${label}">${failed ? 'Retry' : 'Upload'}</button>`});
}

class RideSummary extends UIView {
    props() { return ['ride', 'rider']; }
    render() {
        const ride = this.data.ride;
        if(!ride) {
            this.innerHTML = '';
            return;
        }
        const facts = [
            ['Time',       ride.duration ? duration(ride.duration) : '--'],
            ['Avg power',  ride.power ? `${ride.power} W` : '--'],
            ['Avg HR',     ride.heartRate ? `${ride.heartRate} bpm` : '--'],
            ['Cadence',    ride.cadence ? `${ride.cadence} rpm` : '--'],
            ['Distance',   ride.distance ? `${(ride.distance / 1000).toFixed(1)} km` : '--'],
            ['Energy',     ride.kcal ? `${ride.kcal} kcal` : '--'],
        ];
        this.innerHTML = `<h2 class="summary--name">${html(ride.name)}</h2>
            <dl class="facts">${facts.map(([k, v]) => `<div class="tile"><dt class="tile--label">${k}</dt><dd class="tile--value">${html(v)}</dd></div>`).join('')}</dl>
            <div class="summary--share">
                ${uploadRow(ride, this.data.rider, 'intervals')}
                ${uploadRow(ride, this.data.rider, 'garmin')}
                ${ride.pending ? '' : shareRow({iconName: 'download', label: 'FIT file', status: 'For other apps',
                    action: `<button class="btn btn--ghost" data-action="ride:download" data-param="${html(ride.id)}"
                        aria-label="Download the FIT file">Download</button>`})}
            </div>`;
    }
}

customElements.define('ride-summary', RideSummary);

export { RideList, RideSummary };
