import { xf, exists } from '../functions.js';
import { ControlMode, } from '../ble/enums.js';

function Keyboard() {

    const isKeyUp    = (code) => code === 'ArrowUp';
    const isKeyDown  = (code) => code === 'ArrowDown';
    const isKeyE     = (code) => code === 'KeyE';
    const isKeyR     = (code) => code === 'KeyR';
    const isKeyS     = (code) => code === 'KeyS';
    const isKeyL     = (code) => code === 'KeyL';
    const isKeyB     = (code) => code === 'KeyB';
    const isKeySpace = (code) => code === 'Space';

    window.addEventListener('keydown', onKeydown.bind(this));

    function onKeydown(e) {
        let keyCode = e.keyCode;
        let code = e.code;

        if(e.isComposing ||
            keyCode === 229 ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey ||
            exists(e.target.form)) {
            return;
        }
        // shortcuts are for the ride screen; a focused control keeps its own keys
        if(document.body.dataset.screen !== 'ride' ||
           document.querySelector('dialog[open]') ||
           e.target.closest?.('input, select, textarea, [contenteditable]') ||
           (isKeySpace(code) && e.target.closest?.('button, a'))) {
            return;
        }

        if(isKeyUp(code)) {
            e.preventDefault();
            xf.dispatch('key:up');
        }
        if(isKeyDown(code)) {
            e.preventDefault();
            xf.dispatch('key:down');
        }
        if(isKeyS(code)) {
            xf.dispatch('key:s');
        }
        if(isKeyR(code)) {
            xf.dispatch('key:r');
        }
        if(isKeyE(code)) {
            xf.dispatch('key:e');
        }
        if(isKeyL(code)) {
            xf.dispatch('key:l');
        }
        if(isKeyB(code)) {
            xf.dispatch('key:b');
        }
        if(isKeySpace(code)) {
            e.preventDefault();
            xf.dispatch('key:space');
        }
    }
}


function KeyboardControls() {
    let mode = ControlMode.erg;
    xf.sub('db:mode', x => mode = x);

    let watchStatus = 'stopped';
    xf.sub('db:watchStatus', x => watchStatus = x);

    // Modes Inc/Dec
    xf.sub('key:up', e => {
        if(mode === ControlMode.erg) {
            xf.dispatch('ui:power-target-inc');
        }
        if(mode === ControlMode.resistance) {
            xf.dispatch('ui:resistance-target-inc');
        }
        if(mode === ControlMode.sim) {
            xf.dispatch('ui:slope-target-inc');
        }
    });
    xf.sub('key:down', e => {
        if(mode === ControlMode.erg) {
            xf.dispatch('ui:power-target-dec');
        }
        if(mode === ControlMode.resistance) {
            xf.dispatch('ui:resistance-target-dec');
        }
        if(mode === ControlMode.sim) {
            xf.dispatch('ui:slope-target-dec');
        }
    });

    // Modes
    xf.sub('key:e', e => {
        xf.dispatch('ui:mode-set', ControlMode.erg);
    });
    xf.sub('key:r', e => {
        xf.dispatch('ui:mode-set', ControlMode.resistance);
    });
    xf.sub('key:s', e => {
        xf.dispatch('ui:mode-set', ControlMode.sim);
    });

    // Watch
    xf.sub('key:space', e => {
        xf.dispatch('ui:ride:toggle');
    });
    xf.sub('key:l', e => {
        xf.dispatch('ui:watchLap');
    });
    xf.sub('key:b', e => {
        if(document.body.dataset.rideKind === 'free') return;
        xf.dispatch('ui:watchBack');
    });
}

Keyboard();
KeyboardControls();

export { Keyboard, KeyboardControls };
