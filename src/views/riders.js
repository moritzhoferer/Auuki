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
// <intervals-account> <garmin-account>
// one row like a sensor: icon, name, status, button on the right.
// Connect opens the form below the row.
//
function accountRow({iconName, label, status, on, action}) {
    return `<div class="sensor-row" data-status="${on ? 'on' : 'off'}">
        ${icon(iconName, 'sensor-row--icon')}
        <span class="sensor-row--text"><span class="sensor-row--label">${html(label)}</span>
            <span class="sensor-row--status">${html(status)}</span></span>
        <span class="sensor-row--actions">${action}</span>
    </div>`;
}

function connectButton(open, label) {
    return open ? '' : `<button class="btn" type="button" data-account="open" aria-label="Connect ${html(label)}">Connect</button>`;
}

const formButtons = (submit) => `<div class="row">
    <button class="btn btn--primary" type="submit">${submit}</button>
    <button class="btn btn--ghost" type="button" data-account="cancel">Cancel</button>
</div>`;

// open / close the form of an account view
function accountToggle(view) {
    view.open = false;
    view.addEventListener('click', (e) => {
        const toggle = e.target.closest('[data-account]')?.dataset.account;
        if(!toggle) return;
        view.open = equals(toggle, 'open');
        view.render();
        if(view.open) view.querySelector('form input')?.focus();
    }, view.signal);
}

class IntervalsAccount extends UIView {
    props() { return ['rider']; }
    config() {
        accountToggle(this);
        this.on('account:error', ({service, error}) => {
            if(!equals(service, 'intervals')) return;
            const $form = this.querySelector('form');
            if($form) { setBusy($form, false); showError($form, error); }
        });
        this.on('intervals:connected', () => { this.open = false; this.render(); });
        this.addEventListener('submit', (e) => {
            e.preventDefault();
            const { apiKey, athleteId } = formData(e.target);
            setBusy(e.target, true, 'Checking…');
            showError(e.target, '');
            xf.dispatch('ui:intervals:connect', {apiKey: apiKey.trim(), athleteId: athleteId.trim()});
        }, this.signal);
    }
    render() {
        const label = 'Intervals.icu';
        const intervals = this.data.rider?.intervals ?? {};
        if(intervals.connected) {
            this.innerHTML = accountRow({iconName: 'intervals', label, on: true,
                status: `Athlete ${intervals.athleteId}`,
                action: `<button class="btn btn--ghost" data-action="intervals:disconnect" aria-label="Disconnect Intervals.icu">Disconnect</button>`});
            return;
        }
        this.innerHTML = accountRow({iconName: 'intervals', label, status: 'Not connected', action: connectButton(this.open, label)}) +
            (this.open ? `<form class="account-form">
                <p class="muted">Planned workouts, FTP and weight. Find the API key and athlete ID in Intervals.icu under Settings, Developer settings.</p>
                <label class="field"><span>API key</span><input name="apiKey" type="password" autocomplete="off" required minlength="8"></label>
                <label class="field"><span>Athlete ID</span><input name="athleteId" placeholder="i12345" pattern="0|i?\\d{1,12}"></label>
                <p class="form-error" role="alert" hidden></p>
                ${formButtons('Connect')}
            </form>` : '');
    }
}

customElements.define('intervals-account', IntervalsAccount);

class GarminAccount extends UIView {
    props() { return ['rider']; }
    config() {
        this.step = 'login';
        accountToggle(this);
        this.on('account:error', ({service, error}) => {
            if(!equals(service, 'garmin')) return;
            const $form = this.querySelector('form');
            if($form) { setBusy($form, false); showError($form, error); }
        });
        this.on('garmin:mfa', () => {
            this.step = 'code';
            this.open = true;
            this.render();
            this.querySelector('input[name="code"]')?.focus();
        });
        this.on('garmin:connected', () => { this.step = 'login'; this.open = false; });
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
        const label = 'Garmin Connect';
        if(this.data.rider?.garmin?.connected) {
            this.innerHTML = accountRow({iconName: 'garmin', label, on: true, status: 'Connected',
                action: `<button class="btn btn--ghost" data-action="garmin:disconnect" aria-label="Disconnect Garmin Connect">Disconnect</button>`});
            return;
        }
        if(!this.open) this.step = 'login';
        const form = equals(this.step, 'code') ?
            `<form class="account-form">
                <p class="muted">Garmin sent you a code by email or app.</p>
                <label class="field"><span>Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="\\d{4,8}"></label>
                <p class="form-error" role="alert" hidden></p>
                ${formButtons('Confirm code')}
            </form>` :
            `<form class="account-form">
                <p class="muted">Upload rides, FTP and weight. Your password is used once to log in and isn't stored.</p>
                <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
                <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
                <p class="form-error" role="alert" hidden></p>
                ${formButtons('Connect')}
            </form>`;
        this.innerHTML = accountRow({iconName: 'garmin', label, status: 'Not connected', action: connectButton(this.open, label)}) +
            (this.open ? form : '');
    }
}

customElements.define('garmin-account', GarminAccount);


//
// <body-source>    where FTP and weight come from: Intervals.icu, Garmin or by hand
// <body-settings>  FTP and weight, editable when entered by hand
//
class BodySettings extends UIView {
    props() { return ['rider']; }
    config() {
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
        const source = sourceNames[rider.bodySource] ? rider.bodySource : 'manual';
        const manual = equals(source, 'manual');
        const lock = manual ? '' : 'readonly';
        this.innerHTML = `<form class="body-form">
            <div class="row">
                <label class="field"><span>FTP</span>
                    <span class="input-unit"><input name="ftp" type="number" inputmode="numeric" min="50" max="700" required ${lock} value="${rider.ftp ?? 200}"><span>W</span></span></label>
                <label class="field"><span>Weight</span>
                    <span class="input-unit"><input name="weight" type="number" inputmode="decimal" step="0.1" min="25" max="250" required ${lock} value="${rider.weight ?? 75}"><span>kg</span></span></label>
            </div>
            ${manual ?
                `<div class="row"><button class="btn" type="submit">Save</button><span class="saved muted" role="status" ${this.saved ? '' : 'hidden'}>Saved</span></div>` :
                `<div class="row"><span class="muted">From ${sourceNames[source]}, updated when you open Auuki.</span>
                    <button class="btn btn--ghost btn--small" type="button" data-action="body:sync"
                        aria-label="Load FTP and weight from ${sourceNames[source]} now">${icon('refresh')}<span>Update now</span></button>
                    <span class="saved muted" role="status" ${this.saved ? '' : 'hidden'}>Updated</span></div>`}
        </form>`;
    }
}

customElements.define('body-settings', BodySettings);

const sourceNames = {intervals: 'Intervals.icu', garmin: 'Garmin Connect', manual: 'Enter by hand'};

class BodySource extends UIView {
    props() { return ['rider']; }
    config() {
        this.state = {status: '', source: '', error: ''};
        this.on('body:source', (state) => {
            this.state = {error: '', ...state};
            this.update();
        });
        this.addEventListener('change', (e) => {
            if(e.target.name === 'bodySource') xf.dispatch('ui:body:source', e.target.value);
        }, this.signal);
    }
    render() {
        const rider = this.data.rider ?? {};
        const current = rider.bodySource ?? 'manual';
        const connected = {intervals: rider.intervals?.connected, garmin: rider.garmin?.connected, manual: true};
        const loading = equals(this.state.status, 'loading');
        const options = ['intervals', 'garmin', 'manual'].map(key => {
            const hint = connected[key] ? '' : `<span class="muted">Connect ${sourceNames[key]} first</span>`;
            return `<label class="choice-row ${connected[key] ? '' : 'is-off'}">
                <input type="radio" name="bodySource" value="${key}" ${equals(current, key) ? 'checked' : ''}
                    ${connected[key] && !loading ? '' : 'disabled'}>
                <span><span>${sourceNames[key]}</span>${hint}</span></label>`;
        }).join('');
        const values = equals(current, 'manual') ? '' :
            `<p class="muted body-source--values" role="status">${loading ? 'Loading…' : `FTP ${rider.ftp} W · ${rider.weight} kg`}</p>`;
        this.innerHTML = `<fieldset class="choice-group">
                <legend>Where do FTP and weight come from?</legend>
                ${options}
            </fieldset>
            ${values}
            <p class="form-error" role="alert" ${equals(this.state.status, 'error') ? '' : 'hidden'}>${html(this.state.error)}</p>`;
    }
}

customElements.define('body-source', BodySource);


//
// <rider-setup>  profile -> accounts -> FTP and weight -> sensors
//
const allSteps = ['profile', 'accounts', 'body', 'sensors'];
const stepTitles = {
    profile:  'Add a rider',
    accounts: 'Connect your accounts',
    body:     'FTP and weight',
    sensors:  'Connect your sensors',
};
const stepHelp = {
    profile:  'Everyone on this home network sees the riders. A PIN keeps others out of your profile.',
    accounts: 'Both are optional. You can connect them later in settings. Then choose where FTP and weight come from.',
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
            let next = $next.dataset.setup;
            if(equals(next, 'next')) next = this.next();
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
            return;
        }
        // the FTP choice changes how many steps there are
        const $count = this.querySelector('.step-count');
        if($count) $count.textContent = this.countText();
    }
    next() {
        const steps = this.steps();
        return steps[steps.indexOf(this.step) + 1] ?? 'done';
    }
    countText() {
        const steps = this.steps();
        return `Step ${steps.indexOf(this.step) + 1} of ${steps.length}`;
    }
    // FTP and weight from Intervals.icu or Garmin need no step of their own
    steps() {
        const manual = equals(this.data.rider?.bodySource ?? 'manual', 'manual');
        return manual ? allSteps : allSteps.filter(step => !equals(step, 'body'));
    }
    renderStep() {
        const next = this.next();
        const body = {
            profile: `<form class="card profile-form">
                    <label class="field"><span>Name</span><input name="name" required maxlength="30" autocomplete="nickname"></label>
                    ${pinField()}
                    <div class="row">
                        <button class="btn btn--primary" type="submit">Continue</button>
                        <button class="btn btn--ghost" type="button" data-action="screen" data-param="riders">Cancel</button>
                    </div>
                </form>`,
            accounts: `<div class="stack"><div class="card account-list"><intervals-account></intervals-account><garmin-account></garmin-account></div>
                <body-source class="card"></body-source></div>`,
            body: `<body-settings class="card"></body-settings>`,
            sensors: `<sensor-list class="card"></sensor-list><ant-device-request class="card"></ant-device-request>`,
        }[this.step];

        this.innerHTML = `<header class="screen--head">
                <p class="muted step-count">${this.countText()}</p>
                <h1 tabindex="-1">${stepTitles[this.step]}</h1>
                <p class="muted">${stepHelp[this.step]}</p>
            </header>
            ${body}
            ${equals(this.step, 'profile') ? '' : `<div class="row setup-nav">
                <button class="btn btn--primary" data-setup="next">${equals(next, 'done') ? 'Done' : 'Next'}</button>
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
            aria-label="${html(rider.name)}: open settings">${avatar(rider.name)}</button>`;
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
