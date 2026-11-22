import { xf, equals } from '../functions.js';
import { UIView, icon, html } from './ui.js';
import { sensors, sharedMetrics, sensorBySource, isConnected, connectedCount } from '../models/sensors.js';

//
// <sensor-badges>  compact status icons, opens the sensors sheet
// <sensor-list>    one row per sensor type: status, name, battery, connect
// <ant-device-request>  ANT+ search results, pick one to pair
//

xf.sub('ui:sensor:switch', (source) => xf.dispatch(`ui:${source}:switch`));
xf.sub('ui:sensor:ant-driver', () => xf.dispatch('ui:ant:driver:switch'));
xf.sub('ui:sensor:source', (value) => {
    const [metric, source] = value.split('=');
    xf.dispatch('sources', {[metric]: source});
});

function statusText(entry) {
    if(entry.status === 'connecting') return 'Connecting…';
    if(entry.status !== 'on') return 'Not connected';
    const parts = [entry.name || 'Connected'];
    if(entry.battery >= 0) parts.push(`battery ${entry.battery}%`);
    if(entry.via) parts.push(entry.via);
    return parts.join(' · ');
}

class SensorBadges extends UIView {
    props() { return ['sensors']; }
    config() {
        this.limit = parseInt(this.getAttribute('limit') ?? '7');
    }
    render() {
        const status = this.data.sensors ?? {};
        // connected first, then the rest in their usual order
        const ordered = [...sensors].sort((a, b) =>
            Number(isConnected(status, b.id)) - Number(isConnected(status, a.id)));
        const shown = ordered.slice(0, this.limit);

        this.innerHTML = shown.map(sensor => {
            const entry = status[sensor.id] ?? {};
            return `<button class="badge" data-action="sheet" data-param="sensors" data-status="${entry.status ?? 'off'}"
                    aria-label="${html(`${sensor.label}: ${statusText(entry)}`)}">${icon(sensor.icon)}</button>`;
        }).join('') + `<button class="badge badge--more" data-action="sheet" data-param="sensors"
            aria-label="Sensors: ${connectedCount(status)} of ${sensors.length} connected">${icon('sensors')}</button>`;
    }
}

customElements.define('sensor-badges', SensorBadges);

class SensorList extends UIView {
    props() { return ['sensors', 'antDriver', 'sources']; }
    render() {
        const status = this.data.sensors ?? {};
        const antOn = equals(this.data.antDriver, 'on');

        const row = (sensor) => {
            const entry = status[sensor.id] ?? {};
            const on = entry.status === 'on';
            const busy = entry.status === 'connecting';
            const viaAnt = equals(entry.via, 'ANT+');
            const bleBtn = (on && !viaAnt) || !on ?
                `<button class="btn ${on ? 'btn--ghost' : ''}" data-action="sensor:switch" data-param="${sensor.ble}"
                    ${busy || (on && viaAnt) ? 'disabled' : ''}
                    aria-label="${on ? 'Disconnect' : 'Connect'} ${html(sensor.label)}${on ? '' : ' over Bluetooth'}">${on ? 'Disconnect' : 'Connect'}</button>` : '';
            const antBtn = sensor.ant && antOn && (!on || viaAnt) ?
                `<button class="btn ${on ? 'btn--ghost' : ''}" data-action="sensor:switch" data-param="${sensor.ant}"
                    aria-label="${on ? 'Disconnect' : 'Connect'} ${html(sensor.label)} over ANT+">${on ? 'Disconnect' : 'ANT+'}</button>` : '';
            return `<li class="sensor-row" data-status="${entry.status ?? 'off'}">
                ${icon(sensor.icon, 'sensor-row--icon')}
                <span class="sensor-row--text">
                    <span class="sensor-row--label">${html(sensor.label)}</span>
                    <span class="sensor-row--status">${html(statusText(entry))}</span>
                </span>
                <span class="sensor-row--actions">${on && viaAnt ? '' : bleBtn}${antBtn}</span>
            </li>`;
        };
        const main = sensors.filter(s => !s.more);
        const more = sensors.filter(s => s.more);
        // opens by itself while one of them is in use, otherwise remembers the rider's choice
        const moreInUse = more.some(s => (status[s.id]?.status ?? 'off') !== 'off');

        this.innerHTML = `<ul class="sensor-rows" aria-label="Sensors">${main.map(row).join('')}</ul>
            <details class="sensor-more" ${(this.moreOpen ?? moreInUse) ? 'open' : ''}>
                <summary class="sensor-row">
                    <span class="sensor-row--text">
                        <span class="sensor-row--label">More sensors</span>
                        <span class="sensor-row--status">${html(more.map(s => s.label).join(', '))}</span>
                    </span>
                    ${icon('chevron', 'sensor-more--chevron')}
                </summary>
                <ul class="sensor-rows" aria-label="More sensors">${more.map(row).join('')}</ul>
            </details>
            ${this.sourcesTemplate(status)}
            <div class="sensor-ant">
                <span><span class="sensor-row--label">ANT+ USB stick</span>
                <span class="sensor-row--status">${antOn ? 'On: trainer and heart rate can use ANT+' : 'Off'}</span></span>
                <button class="btn btn--ghost" data-action="sensor:ant-driver"
                    aria-label="${antOn ? 'Turn off the ANT+ stick' : 'Use an ANT+ USB stick'}">${antOn ? 'Turn off' : 'Use ANT+'}</button>
            </div>`;
    }
    // when two connected sensors can provide the same value, let the rider pick
    sourcesTemplate(status) {
        const sources = this.data.sources ?? {};
        const choices = sharedMetrics.map(({metric, label}) => {
            const providers = sensors.filter(s => s.provides.includes(metric) && isConnected(status, s.id));
            if(providers.length < 2) return '';
            const current = sensorBySource(sources[metric])?.id;
            return `<label class="field field--inline"><span>${html(label)}</span>
                <select data-source="${metric}">
                    ${providers.map(p => `<option value="${p.ble}" ${equals(p.id, current) ? 'selected' : ''}>${html(p.label)}</option>`).join('')}
                </select></label>`;
        }).join('');
        return choices ? `<div class="sensor-sources">${choices}</div>` : '';
    }
    config() {
        this.moreOpen = null; // null: follow whether one of them is in use
        // toggle doesn't bubble
        this.addEventListener('toggle', (e) => {
            if(e.target.classList?.contains('sensor-more')) this.moreOpen = e.target.open;
        }, {...this.signal, capture: true});
        this.addEventListener('change', (e) => {
            const metric = e.target.dataset?.source;
            if(metric) xf.dispatch('ui:sensor:source', `${metric}=${e.target.value}`);
        }, this.signal);
    }
}

customElements.define('sensor-list', SensorList);

class ANTDeviceRequest extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        const signal = { signal: this.abortController.signal };
        this.devices = new Map();
        this.hidden = true;
        xf.sub('ant:search:start',  () => this.open(), signal);
        xf.sub('ant:search:cancel', () => this.close(), signal);
        xf.sub('ant:search:found',  (channelId) => this.add(channelId), signal);
        this.addEventListener('click', (e) => {
            const $item = e.target.closest('[data-device]');
            if($item) this.pair(parseInt($item.dataset.device));
            if(e.target.closest('[data-cancel]')) xf.dispatch('ant:search:cancel');
        }, signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    open() {
        this.devices = new Map();
        this.hidden = false;
        this.render();
    }
    close() {
        this.hidden = true;
    }
    add(channelId) {
        if(this.devices.has(channelId.deviceNumber)) return;
        this.devices.set(channelId.deviceNumber, channelId);
        this.render();
    }
    pair(deviceNumber) {
        const channelId = this.devices.get(deviceNumber);
        this.close();
        xf.dispatch('ant:search:pair', channelId);
    }
    render() {
        const items = [...this.devices.values()].map(d =>
            `<li><button class="btn btn--ghost" data-device="${html(d.deviceNumber)}">ANT+ ${html(d.deviceType)} · ${html(d.deviceNumber)}</button></li>`
        ).join('');
        this.innerHTML = `<p class="sensor-row--label">Searching for ANT+ devices…</p>
            <ul class="ant-devices">${items}</ul>
            <button class="btn btn--ghost" data-cancel>Cancel search</button>`;
    }
}

customElements.define('ant-device-request', ANTDeviceRequest);

export { SensorBadges, SensorList };
