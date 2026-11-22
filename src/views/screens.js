import { xf, equals } from '../functions.js';
import { UIView, html, icon } from './ui.js';
import { isConnected } from '../models/sensors.js';

//
// Small parts of single screens: greeting, ready check, ride title, preferences.
//

class StartGreeting extends UIView {
    props() { return ['rider']; }
    render() {
        const name = this.data.rider?.name;
        this.textContent = name ? `Hi ${name}, what do you want to ride?` : 'What do you want to ride?';
    }
}

customElements.define('start-greeting', StartGreeting);

// what's missing before the ride can start
class ReadyCheck extends UIView {
    props() { return ['sensors', 'mode', 'rideKind']; }
    render() {
        const status = this.data.sensors ?? {};
        const trainer = isConnected(status, 'trainer');
        const power = trainer || isConnected(status, 'power');
        const notes = [];
        if(!power) notes.push(['warn', 'No trainer or power meter connected. Connect one to record power.']);
        if(!trainer && !equals(this.data.mode, 'sim')) notes.push(['warn', 'ERG and resistance need a connected trainer.']);
        if(!isConnected(status, 'hrm')) notes.push(['info', 'No heart rate sensor connected.']);
        this.innerHTML = notes.length ? `<ul class="notes">${notes.map(([kind, text]) =>
            `<li class="note note--${kind}">${icon(kind === 'warn' ? 'alert' : 'info')}<span>${html(text)}</span></li>`).join('')}</ul>
            <button class="btn btn--ghost" data-action="sheet" data-param="sensors">${icon('plus')}<span>Connect sensors</span></button>` :
            `<p class="note note--ok">${icon('check')}<span>Sensors ready.</span></p>`;
    }
}

customElements.define('ready-check', ReadyCheck);

class RideTitle extends UIView {
    props() { return ['workout', 'rideKind']; }
    render() {
        this.textContent = equals(this.data.rideKind, 'free') ? 'Free ride' : (this.data.workout?.meta?.name ?? 'Ride');
    }
}

customElements.define('ride-title', RideTitle);

class AppPreferences extends UIView {
    props() { return ['measurement', 'powerTolerance', 'volume']; }
    config() {
        this.addEventListener('change', (e) => {
            if(e.target.name === 'tolerance') xf.dispatch('ui:power-tolerance-set', parseInt(e.target.value));
        }, this.signal);
    }
    render() {
        const { measurement = 'metric', powerTolerance = 7, volume = 0 } = this.data;
        const metric = !equals(measurement, 'imperial');
        this.innerHTML = `<div class="stack">
            <div class="pref"><span><span class="pref--name">Units</span>
                <span class="muted">${metric ? 'Kilometres, kilograms, °C' : 'Miles, pounds, °F'}</span></span>
                <button class="btn btn--ghost" data-action="measurement-switch"
                    aria-label="Switch to ${metric ? 'imperial' : 'metric'} units">${metric ? 'Use imperial' : 'Use metric'}</button></div>
            <label class="pref"><span><span class="pref--name">Pacing tolerance</span>
                <span class="muted">How far outside the target range still counts as close, in % of FTP</span></span>
                <span class="input-unit"><input name="tolerance" type="number" min="1" max="30" value="${powerTolerance}"><span>%</span></span></label>
            <div class="pref"><span><span class="pref--name">Sound</span><span class="muted">Volume ${volume}%</span></span>
                <span class="row">
                    <button class="btn btn--icon btn--ghost" data-action="volume-down" aria-label="Quieter">${icon('minus')}</button>
                    <button class="btn btn--icon btn--ghost" data-action="volume-up" aria-label="Louder">${icon('plus')}</button>
                    <button class="btn btn--icon btn--ghost" data-action="volume-mute" aria-label="Mute">${icon('mute')}</button>
                </span></div>
        </div>`;
    }
}

customElements.define('app-preferences', AppPreferences);
