import { xf, equals } from '../functions.js';
import { UIView, icon, html } from './ui.js';

//
// Riders: picker, first-time setup and the account forms.
// <intervals-account>, <garmin-account> and <body-settings> are used in setup and settings.
//

function initials(name = '') {
    return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function avatar(name) {
    return `<span class="avatar" aria-hidden="true">${html(initials(name))}</span>`;
}

function formData($form) {
    return Object.fromEntries(new FormData($form).entries());
}

function setBusy($form, busy, text) {
    const $submit = $form.querySelector('[type="submit"]');
    if(!$submit) return;
    if(busy) $submit.dataset.label = $submit.textContent;
    $submit.disabled = busy;
    $submit.textContent = busy ? text : ($submit.dataset.label ?? $submit.textContent);
}

function showError($form, text = '') {
    const $error = $form.querySelector('.form-error');
    if($error) {
        $error.textContent = text;
        $error.hidden = !text;
    }
}

const pinField = (label = 'PIN (optional)', help = '4 to 8 digits. Leave empty for no PIN.') =>
    `<label class="field"><span>${label}</span>
        <input name="pin" type="password" inputmode="numeric" autocomplete="new-password" pattern="\\d{4,8}" maxlength="8"
            aria-describedby="pin-help">
        <small id="pin-help" class="muted">${help}</small></label>`;


//
// <rider-picker>
//
class RiderPicker extends UIView {
    props() { return ['riders']; }
    config() {
        this.selected = '';
        this.on('rider:login-failed', ({id, error}) => {
            this.selected = id;
            this.render();
            showError(this.querySelector('form'), error);
            this.querySelector('input[name="pin"]')?.focus();
        });
        this.addEventListener('click', (e) => {
            const $rider = e.target.closest('[data-rider]');
            if(!$rider) return;
            if($rider.dataset.pin === 'true') {
                this.selected = $rider.dataset.rider;
                this.render();
                this.querySelector('input[name="pin"]')?.focus();
            } else {
                xf.dispatch('ui:rider:pick', {id: $rider.dataset.rider});
            }
        }, this.signal);
        this.addEventListener('submit', (e) => {
            e.preventDefault();
            const { pin } = formData(e.target);
            xf.dispatch('ui:rider:pick', {id: this.selected, pin});
        }, this.signal);
    }
    render() {
        const riders = this.data.riders ?? [];
        const selected = riders.find(r => equals(r.id, this.selected));
        this.innerHTML = `<ul class="rider-grid">${riders.map(r => `
            <li><button class="rider-btn" data-rider="${html(r.id)}" data-pin="${r.hasPin}"
                    aria-label="${html(r.name)}${r.hasPin ? ', needs a PIN' : ''}" aria-pressed="${equals(r.id, this.selected)}">
                ${avatar(r.name)}<span>${html(r.name)}</span>${r.hasPin ? icon('lock', 'rider-btn--lock') : ''}
            </button></li>`).join('')}
            <li><button class="rider-btn rider-btn--add" data-action="screen" data-param="setup">
                <span class="avatar avatar--add" aria-hidden="true">${icon('plus')}</span><span>Add rider</span>
            </button></li>
        </ul>
        ${selected ? `<form class="card pin-form">
            <label class="field"><span>PIN for ${html(selected.name)}</span>
                <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required pattern="\\d{4,8}" maxlength="8"></label>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn--primary" type="submit">Continue</button>
        </form>` : ''}`;
    }
}

customElements.define('rider-picker', RiderPicker);


//
// <intervals-account>
//
class IntervalsAccount extends UIView {
    props() { return ['rider']; }
    config() {
        this.on('account:error', ({service, error}) => {
            if(!equals(service, 'intervals')) return;
            const $form = this.querySelector('form');
            if($form) { setBusy($form, false); showError($form, error); }
        });
        this.on('intervals:connected', () => this.render());
        this.addEventListener('submit', (e) => {
            e.preventDefault();
            const { apiKey, athleteId } = formData(e.target);
            setBusy(e.target, true, 'Checking…');
            showError(e.target, '');
            xf.dispatch('ui:intervals:connect', {apiKey: apiKey.trim(), athleteId: athleteId.trim()});
        }, this.signal);
    }
    render() {
        const intervals = this.data.rider?.intervals ?? {};
        if(intervals.connected) {
            this.innerHTML = `<div class="account account--on">
                ${icon('intervals', 'account--icon')}
                <span class="account--text"><span class="account--name">Intervals.icu</span>
                    <span class="muted">Connected as athlete ${html(intervals.athleteId)}. Planned workouts show on the start screen.</span></span>
                <button class="btn btn--ghost" data-action="intervals:disconnect" aria-label="Disconnect Intervals.icu">Disconnect</button>
            </div>`;
            return;
        }
        this.innerHTML = `<form class="account">
            ${icon('intervals', 'account--icon')}
            <span class="account--text"><span class="account--name">Intervals.icu</span>
                <span class="muted">Planned workouts, FTP and weight. Find the API key and athlete ID in Intervals.icu under Settings, Developer settings.</span></span>
            <label class="field"><span>API key</span><input name="apiKey" type="password" autocomplete="off" required minlength="8"></label>
            <label class="field"><span>Athlete ID</span><input name="athleteId" placeholder="i12345" pattern="0|i?\\d{1,12}"></label>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn--primary" type="submit">Connect Intervals.icu</button>
        </form>`;
    }
}

customElements.define('intervals-account', IntervalsAccount);


//
// <garmin-account>
//
class GarminAccount extends UIView {
    props() { return ['rider']; }
    config() {
        this.step = 'login';
        this.on('account:error', ({service, error}) => {
            if(!equals(service, 'garmin')) return;
            const $form = this.querySelector('form');
            if($form) { setBusy($form, false); showError($form, error); }
        });
        this.on('garmin:mfa', () => {
            this.step = 'code';
            this.render();
            this.querySelector('input[name="code"]')?.focus();
        });
        this.on('garmin:connected', () => { this.step = 'login'; });
        this.addEventListener('submit', (e) => {
            e.preventDefault();
            const values = formData(e.target);
            showError(e.target, '');
            setBusy(e.target, true, 'Connecting…');
            if(equals(this.step, 'code')) {
                xf.dispatch('ui:garmin:code', values.code.trim());
            } else {
                xf.dispatch('ui:garmin:connect', {email: values.email.trim(), password: values.password});
            }
        }, this.signal);
    }
    render() {
        if(this.data.rider?.garmin?.connected) {
            this.innerHTML = `<div class="account account--on">
                ${icon('garmin', 'account--icon')}
                <span class="account--text"><span class="account--name">Garmin Connect</span>
                    <span class="muted">Connected. Rides can be uploaded after you finish.</span></span>
                <button class="btn btn--ghost" data-action="garmin:disconnect" aria-label="Disconnect Garmin Connect">Disconnect</button>
            </div>`;
            return;
        }
        if(equals(this.step, 'code')) {
            this.innerHTML = `<form class="account">
                ${icon('garmin', 'account--icon')}
                <span class="account--text"><span class="account--name">Garmin Connect</span>
                    <span class="muted">Garmin sent you a code by email or app.</span></span>
                <label class="field"><span>Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="\\d{4,8}"></label>
                <p class="form-error" role="alert" hidden></p>
                <button class="btn btn--primary" type="submit">Confirm code</button>
            </form>`;
            return;
        }
        this.innerHTML = `<form class="account">
            ${icon('garmin', 'account--icon')}
            <span class="account--text"><span class="account--name">Garmin Connect</span>
                <span class="muted">Upload rides to Garmin. Your password is used once to log in and isn't stored.</span></span>
            <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
            <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn--primary" type="submit">Connect Garmin</button>
        </form>`;
    }
}

customElements.define('garmin-account', GarminAccount);


//
// <body-settings>  FTP and weight, with import from Intervals.icu
//
// FTP and weight from Intervals.icu, offered until saved. Kept here because the
// setup's FTP step is created after the account was connected.
let suggestion = {riderId: '', athlete: null};
let currentRider = '';
xf.sub('db:rider', (rider) => { currentRider = rider?.id ?? ''; });
xf.sub('intervals:connected', (athlete) => {
    suggestion = {riderId: currentRider, athlete: (athlete?.ftp || athlete?.weight) ? athlete : null};
});
xf.sub('rider:saved', () => { suggestion = {riderId: '', athlete: null}; });

class BodySettings extends UIView {
    props() { return ['rider']; }
    config() {
        this.on('intervals:connected', () => this.render());
        this.saved = false;
        this.on('rider:saved', () => {
            this.saved = true;
            this.update();
        });
        this.addEventListener('input', () => {
            this.saved = false;
            const $saved = this.querySelector('.saved');
            if($saved) $saved.hidden = true;
        }, this.signal);
        this.addEventListener('submit', (e) => {
            e.preventDefault();
            const { ftp, weight } = formData(e.target);
            xf.dispatch('ui:rider:update', {ftp: parseInt(ftp), weight: parseFloat(weight)});
        }, this.signal);
    }
    render() {
        const rider = this.data.rider ?? {};
        const s = equals(suggestion.riderId, rider.id) ? suggestion.athlete : null;
        const offer = s ? `<div class="offer">
                <p>Intervals.icu has ${[s.ftp ? `FTP ${s.ftp} W` : '', s.weight ? `${s.weight} kg` : ''].filter(Boolean).join(' and ')}.</p>
                <button class="btn btn--primary" type="button" data-action="intervals:import">Use these</button>
            </div>` : (rider.intervals?.connected ? `<button class="btn btn--ghost" type="button" data-action="intervals:import"
                aria-label="Take FTP and weight from Intervals.icu">${icon('refresh')}<span>From Intervals.icu</span></button>` : '');
        this.innerHTML = `<form class="body-form">
            ${offer}
            <div class="row">
                <label class="field"><span>FTP</span>
                    <span class="input-unit"><input name="ftp" type="number" inputmode="numeric" min="50" max="700" required value="${rider.ftp ?? 200}"><span>W</span></span></label>
                <label class="field"><span>Weight</span>
                    <span class="input-unit"><input name="weight" type="number" inputmode="decimal" step="0.1" min="25" max="250" required value="${rider.weight ?? 75}"><span>kg</span></span></label>
            </div>
            <div class="row"><button class="btn" type="submit">Save</button><span class="saved muted" role="status" ${this.saved ? '' : 'hidden'}>Saved</span></div>
        </form>`;
    }
}

customElements.define('body-settings', BodySettings);


//
// <rider-setup>  profile -> accounts -> FTP and weight -> sensors
//
const steps = ['profile', 'accounts', 'body', 'sensors'];
const stepTitles = {
    profile:  'Add a rider',
    accounts: 'Connect your accounts',
    body:     'FTP and weight',
    sensors:  'Connect your sensors',
};
const stepHelp = {
    profile:  'Everyone on this home network sees the riders. A PIN keeps others out of your profile.',
    accounts: 'Both are optional. You can connect them later in settings.',
    body:     'Targets in workouts are based on your FTP.',
    sensors:  'Connect what you have. Only a trainer or a power meter is needed to ride.',
};

class RiderSetup extends UIView {
    props() { return ['rider', 'screen']; }
    config() {
        this.step = 'profile';
        this.on('setup:step', (step) => {
            this.step = step;
            this.renderStep();
            xf.dispatch('ui:screen', 'setup');
        });
        this.addEventListener('submit', (e) => {
            if(!e.target.matches('.profile-form')) return;
            e.preventDefault();
            const { name, pin } = formData(e.target);
            xf.dispatch('ui:rider:create', {name: name.trim(), pin: pin || undefined});
        }, this.signal);
        this.addEventListener('click', (e) => {
            const $next = e.target.closest('[data-setup]');
            if(!$next) return;
            const next = $next.dataset.setup;
            if(equals(next, 'done')) {
                xf.dispatch('ui:screen', 'start');
            } else {
                this.step = next;
                this.renderStep();
                this.querySelector('h1')?.focus();
            }
        }, this.signal);
        this.renderStep();
    }
    render() {
        // a new visit to the setup screen without a rider starts at the profile
        if(equals(this.data.screen, 'setup') && !this.data.rider && !equals(this.step, 'profile')) {
            this.step = 'profile';
            this.renderStep();
        }
    }
    renderStep() {
        const index = steps.indexOf(this.step);
        const next = steps[index + 1] ?? 'done';
        const body = {
            profile: `<form class="card profile-form">
                    <label class="field"><span>Name</span><input name="name" required maxlength="30" autocomplete="nickname"></label>
                    ${pinField()}
                    <div class="row">
                        <button class="btn btn--primary" type="submit">Continue</button>
                        <button class="btn btn--ghost" type="button" data-action="screen" data-param="riders">Cancel</button>
                    </div>
                </form>`,
            accounts: `<div class="stack"><intervals-account class="card"></intervals-account><garmin-account class="card"></garmin-account></div>`,
            body: `<body-settings class="card"></body-settings>`,
            sensors: `<sensor-list class="card"></sensor-list><ant-device-request class="card"></ant-device-request>`,
        }[this.step];

        this.innerHTML = `<header class="screen--head">
                <p class="muted step-count">Step ${index + 1} of ${steps.length}</p>
                <h1 tabindex="-1">${stepTitles[this.step]}</h1>
                <p class="muted">${stepHelp[this.step]}</p>
            </header>
            ${body}
            ${equals(this.step, 'profile') ? '' : `<div class="row setup-nav">
                <button class="btn btn--primary" data-setup="${next}">${equals(next, 'done') ? 'Done' : 'Next'}</button>
                ${equals(next, 'done') ? '' : `<button class="btn btn--ghost" data-setup="done">Skip setup</button>`}
            </div>`}`;
    }
}

customElements.define('rider-setup', RiderSetup);


//
// <rider-chip>  the current rider in the header, switches rider
//
class RiderChip extends UIView {
    props() { return ['rider', 'watchStatus']; }
    render() {
        const rider = this.data.rider;
        if(!rider) { this.innerHTML = ''; return; }
        this.innerHTML = `<button class="btn btn--ghost rider-chip" data-action="screen" data-param="settings"
            aria-label="${html(rider.name)}: FTP ${rider.ftp} W, ${rider.weight} kg. Open settings">
            <span class="rider-chip--facts">FTP ${rider.ftp} W · ${rider.weight} kg</span>${avatar(rider.name)}</button>`;
    }
}

customElements.define('rider-chip', RiderChip);

// <rider-profile-form>  name and PIN in settings
class RiderProfileForm extends UIView {
    props() { return ['rider']; }
    config() {
        this.addEventListener('submit', (e) => {
            e.preventDefault();
            const { name, pin, removePin } = formData(e.target);
            const changes = {name: name.trim()};
            if(removePin) changes.pin = '';
            else if(pin) changes.pin = pin;
            xf.dispatch('ui:rider:update', changes);
        }, this.signal);
        this.on('rider:saved', () => {
            const $saved = this.querySelector('.saved');
            if($saved) $saved.hidden = false;
        });
    }
    render() {
        const rider = this.data.rider ?? {};
        this.innerHTML = `<form class="stack">
            <label class="field"><span>Name</span><input name="name" required maxlength="30" value="${html(rider.name ?? '')}"></label>
            ${pinField(rider.hasPin ? 'New PIN' : 'PIN (optional)', rider.hasPin ? 'Leave empty to keep your PIN.' : '4 to 8 digits.')}
            ${rider.hasPin ? `<label class="check"><input type="checkbox" name="removePin"> Remove my PIN</label>` : ''}
            <div class="row"><button class="btn" type="submit">Save</button><span class="saved muted" role="status" ${this.saved ? '' : 'hidden'}>Saved</span></div>
        </form>`;
    }
}

customElements.define('rider-profile-form', RiderProfileForm);

// <confirm-button action="rider:delete" label="Delete rider" confirm="Press again to delete">
class ConfirmButton extends HTMLElement {
    connectedCallback() {
        const label = this.getAttribute('label');
        const confirmText = this.getAttribute('confirm');
        this.innerHTML = `<button class="btn btn--danger-ghost" type="button">${html(label)}</button>`;
        const $btn = this.querySelector('button');
        let armed = false;
        $btn.addEventListener('click', () => {
            if(armed) {
                xf.dispatch(`ui:${this.getAttribute('action')}`);
                return;
            }
            armed = true;
            $btn.textContent = confirmText;
            $btn.classList.add('btn--danger');
            setTimeout(() => { armed = false; $btn.textContent = label; $btn.classList.remove('btn--danger'); }, 4000);
        });
    }
}

customElements.define('confirm-button', ConfirmButton);

export { initials, avatar };
