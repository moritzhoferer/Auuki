import { xf, equals, escapeHtml } from '../functions.js';

//
// Shared building blocks for every view.
//
//   <button data-action="ride:free" data-param="x">  -> xf.dispatch('ui:ride:free', 'x')
//   <button data-pressed="mode:erg">                 -> aria-pressed follows db.mode === 'erg'
//   aria-label / data-tip                            -> tooltip on hover, focus and long-press
//   <section class="screen" data-screen="start">     -> shown while db.screen === 'start'
//   <dialog class="sheet" data-sheet="sensors">      -> open while db.sheet === 'sensors'
//

// Int -> 'm:ss' or 'h:mm:ss'
function clock(seconds = 0) {
    const value = Math.max(0, Math.round(seconds));
    const h = Math.floor(value / 3600);
    const m = Math.floor(value % 3600 / 60);
    const s = value % 60;
    const pad = (x) => String(x).padStart(2, '0');
    if(h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
}

// Int -> '1:05 h' or '45 min'
function duration(seconds = 0) {
    const minutes = Math.round(seconds / 60);
    if(minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`;
}

function icon(name, extra = '') {
    return `<svg class="icon ${extra}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

const html = escapeHtml;


// the db, once the app is ready: views created later start from the current values
let state = null;
xf.reg('app:ready', (_, db) => { state = db; });

//
// UIView: keeps a copy of some db props, renders at most once per frame.
//
class UIView extends HTMLElement {
    constructor() {
        super();
        this.data = {};
        this.pending = false;
    }
    props() { return []; }
    connectedCallback() {
        this.abortController = new AbortController();
        this.signal = { signal: this.abortController.signal };
        this.config();
        for(const prop of this.props()) {
            if(state) this.data[prop] = state[prop];
            xf.sub(`db:${prop}`, (value) => {
                this.data[prop] = value;
                this.update();
            }, this.signal);
        }
        this.update();
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    config() {}
    on(event, handler) {
        xf.sub(event, handler.bind(this), this.signal);
    }
    update() {
        if(this.pending) return;
        this.pending = true;
        window.requestAnimationFrame(() => {
            this.pending = false;
            this.render();
        });
    }
    render() {}
}


//
// actions: one click listener for every [data-action] button
//
document.addEventListener('click', (e) => {
    const $el = e.target.closest('[data-action]');
    if(!$el || $el.disabled || $el.getAttribute('aria-disabled') === 'true') return;
    xf.dispatch(`ui:${$el.dataset.action}`, $el.dataset.param ?? '');
});

// aria-pressed for toggle buttons, data-pressed="prop:value"
const pressedProps = new Set();
function syncPressed(prop, value) {
    for(const $el of document.querySelectorAll(`[data-pressed^="${prop}:"]`)) {
        $el.setAttribute('aria-pressed', String(equals($el.dataset.pressed.split(':')[1], String(value))));
    }
}
function bindPressed(root = document) {
    for(const $el of root.querySelectorAll('[data-pressed]')) {
        const prop = $el.dataset.pressed.split(':')[0];
        if(pressedProps.has(prop)) continue;
        pressedProps.add(prop);
        xf.sub(`db:${prop}`, (value) => syncPressed(prop, value));
    }
}


//
// <ui-tooltip>: one tooltip for the whole app.
// Shows the aria-label (or data-tip) of buttons and links: after a short hover,
// at once on keyboard focus, and on a long press on touch screens.
//
const tipTargets = 'button, a[href], [role="button"], [data-tip], select, input';

class UITooltip extends HTMLElement {
    connectedCallback() {
        this.setAttribute('role', 'tooltip');
        this.id = 'ui-tooltip';
        this.timer = 0;
        this.$target = null;
        const signal = { signal: (this.abortController = new AbortController()).signal };

        document.addEventListener('pointerover', (e) => {
            if(e.pointerType === 'touch') return;
            this.schedule(e.target, 450);
        }, signal);
        document.addEventListener('pointerout', (e) => {
            if(!this.$target || !this.$target.contains(e.relatedTarget)) this.hide();
        }, signal);
        document.addEventListener('focusin', (e) => {
            if(e.target.matches?.(':focus-visible')) this.schedule(e.target, 0);
        }, signal);
        document.addEventListener('focusout', () => this.hide(), signal);
        document.addEventListener('keydown', (e) => { if(e.key === 'Escape') this.hide(); }, signal);
        document.addEventListener('scroll', () => this.hide(), {...signal, capture: true});

        // long press on touch
        document.addEventListener('touchstart', (e) => {
            this.schedule(e.target, 500);
        }, {...signal, passive: true});
        document.addEventListener('touchend', () => {
            clearTimeout(this.timer);
            if(this.$target) setTimeout(() => this.hide(), 1500);
        }, signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    text($el) {
        return $el.dataset.tip || $el.getAttribute('aria-label') || '';
    }
    schedule(target, delay) {
        clearTimeout(this.timer);
        const $el = target?.closest?.(tipTargets);
        if(!$el || !this.text($el)) return this.hide();
        // a visible label that says the same needs no tooltip
        if(!$el.dataset.tip && $el.textContent.trim() === this.text($el)) return this.hide();
        this.timer = setTimeout(() => this.show($el), delay);
    }
    show($el) {
        this.$target = $el;
        this.textContent = this.text($el);
        this.classList.add('active');
        const box = $el.getBoundingClientRect();
        const tip = this.getBoundingClientRect();
        const margin = 8;
        let top = box.top - tip.height - margin;
        if(top < margin) top = box.bottom + margin;
        const left = Math.min(window.innerWidth - tip.width - margin,
                              Math.max(margin, box.left + box.width / 2 - tip.width / 2));
        this.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }
    hide() {
        clearTimeout(this.timer);
        this.$target = null;
        this.classList.remove('active');
    }
}

customElements.define('ui-tooltip', UITooltip);


//
// screens and sheets
//
const titles = {
    riders: "Who's riding?", setup: 'Set up', start: 'Start', library: 'Workouts', ready: 'Ready',
    ride: 'Ride', summary: 'Ride saved', rides: 'Rides', settings: 'Settings', editor: 'Workout editor',
};

let firstScreen = true;
xf.sub('db:screen', (screen) => {
    for(const $screen of document.querySelectorAll('.screen')) {
        $screen.hidden = !equals($screen.dataset.screen, screen);
    }
    document.body.dataset.screen = screen;
    document.title = titles[screen] ? `${titles[screen]} · Auuki` : 'Auuki';

    // move focus to the new screen's heading for screen readers and keyboards
    if(!firstScreen) {
        const $heading = document.querySelector(`.screen[data-screen="${screen}"] h1`);
        if($heading) {
            $heading.setAttribute('tabindex', '-1');
            $heading.focus({preventScroll: false});
        }
    }
    if(!equals(screen, 'loading')) firstScreen = false;
});

xf.sub('db:sheet', (sheet) => {
    for(const $sheet of document.querySelectorAll('dialog.sheet')) {
        const open = equals($sheet.dataset.sheet, sheet);
        if(open && !$sheet.open) $sheet.showModal();
        if(!open && $sheet.open) $sheet.close();
    }
});

function bindSheets() {
    for(const $sheet of document.querySelectorAll('dialog.sheet')) {
        $sheet.addEventListener('close', () => xf.dispatch('ui:sheet', ''));
        // click on the backdrop closes
        $sheet.addEventListener('click', (e) => {
            if(e.target === $sheet && $sheet.dataset.dismiss !== 'false') $sheet.close();
        });
    }
}

// a short status line at the top (errors, offline)
class UINotice extends UIView {
    props() { return ['notice']; }
    config() {
        this.setAttribute('role', 'status');
        this.setAttribute('aria-live', 'polite');
    }
    render() {
        const text = this.data.notice ?? '';
        this.hidden = !text;
        this.innerHTML = text ? `<span>${html(text)}</span>
            <button class="btn btn--icon btn--ghost" data-action="notice" aria-label="Dismiss">${icon('close')}</button>` : '';
    }
}

customElements.define('ui-notice', UINotice);

let bound = false;
function init() {
    if(bound) return;
    bound = true;
    bindPressed();
    bindSheets();
}
if(document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

export {
    UIView,
    clock,
    duration,
    icon,
    html,
    bindPressed,
};
