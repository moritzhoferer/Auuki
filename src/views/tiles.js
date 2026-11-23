import { UIView, html } from './ui.js';
import { fieldByKey, availableFields } from '../models/fields.js';

//
// <metric-tile field="heartRate">  one value with its label and unit
// <tile-row fields="heartRate,cadence,smo2">  the tiles whose sensor is connected
//

class MetricTile extends UIView {
    // config() runs before props(), so the field is looked up here
    config() {
        this.field = fieldByKey(this.getAttribute('field'));
        if(!this.field) return;
        this.classList.add('tile');
        this.innerHTML = `<span class="tile--label">${html(this.field.label)}</span>
            <span class="tile--value"><span class="tile--number">--</span> <span class="tile--unit"></span></span>`;
        this.$number = this.querySelector('.tile--number');
        this.$unit   = this.querySelector('.tile--unit');
    }
    props() {
        if(!this.field) return [];
        return [this.field.key, 'measurement', 'sources', ...(this.field.deps ?? [])];
    }
    render() {
        if(!this.field) return;
        this.$number.textContent = this.field.format(this.data[this.field.key] ?? 0, this.data);
        this.$unit.textContent   = this.field.unit(this.data);
    }
}

customElements.define('metric-tile', MetricTile);

class TileRow extends UIView {
    props() { return ['sensors']; }
    config() {
        this.keys = (this.getAttribute('fields') ?? '').split(',').map(k => k.trim()).filter(Boolean);
        this.shown = '';
    }
    render() {
        const fields = availableFields(this.keys, this.data.sensors);
        const shown = fields.map(f => f.key).join(',');
        if(shown === this.shown) return;
        this.shown = shown;
        this.hidden = fields.length === 0;
        this.replaceChildren(...fields.map(f => {
            const $tile = document.createElement('metric-tile');
            $tile.setAttribute('field', f.key);
            return $tile;
        }));
    }
}

customElements.define('tile-row', TileRow);

export { MetricTile, TileRow };
