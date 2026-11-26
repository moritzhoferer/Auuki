import { xf, isArray, equals } from '../../functions.js';
import { ControlMode } from '../enums.js';
import { toControlMessages as di2Messages } from '../di2/di2.js';

// screens where resume may start the chosen ride (same as auto-start in watch.js)
const startScreens = ['ready', 'ride'];

function OpenBikeControl() {

    const upForMode = {
        [ControlMode.erg]: 'ui:power-target-inc',
        [ControlMode.resistance]: 'ui:resistance-target-inc',
        [ControlMode.sim]: 'ui:slope-target-inc',
    };

    const downForMode = {
        [ControlMode.erg]: 'ui:power-target-dec',
        [ControlMode.resistance]: 'ui:resistance-target-dec',
        [ControlMode.sim]: 'ui:slope-target-dec',
    };

    const nextMode = {
        [ControlMode.erg]: ControlMode.resistance,
        [ControlMode.resistance]: ControlMode.sim,
        [ControlMode.sim]: ControlMode.erg,
    };

    function pushArrow(actions, seen, direction, {mode, rideKind}) {
        if(seen[direction]) return;
        seen[direction] = true;

        const table = equals(direction, 'up') ? upForMode : downForMode;
        const event = mode === ControlMode.erg && rideKind === 'workout'
            ? (direction === 'up' ? 'ui:intensity-inc' : 'ui:intensity-dec')
            : table[mode];
        if(event) actions.push({event});
    }

    // [Message], {mode, rideKind, watchStatus, screen} -> [{event, data?}]
    function controlsFor(messages = [], context = {}) {
        const list = isArray(messages) ? messages : [];
        const mode = context.mode;
        const watchStatus = context.watchStatus;
        const actions = [];
        const seen = {up: false, down: false};

        for(let i = 0; i < list.length; i++) {
            const message = list[i];
            if(!message || !equals(message.state, 'pressed')) continue;

            if(equals(message.action, 'shiftUp') || equals(message.action, 'increaseDifficulty')) {
                pushArrow(actions, seen, 'up', context);
                continue;
            }
            if(equals(message.action, 'shiftDown') || equals(message.action, 'decreaseDifficulty')) {
                pushArrow(actions, seen, 'down', context);
                continue;
            }
            if(equals(message.action, 'skipInterval') || equals(message.action, 'lap')) {
                actions.push({event: 'ui:watchLap'});
                continue;
            }
            if(equals(message.action, 'previousInterval')) {
                actions.push({event: 'ui:watchBack'});
                continue;
            }
            if(equals(message.action, 'pause')) {
                if(equals(watchStatus, 'started')) actions.push({event: 'ui:watchPause'});
                continue;
            }
            if(equals(message.action, 'resume')) {
                if(equals(watchStatus, 'paused')) {
                    actions.push({event: 'ui:watchResume'});
                } else if(equals(watchStatus, 'stopped') && startScreens.includes(context.screen)) {
                    // the chosen ride decides: free rides start no workout
                    actions.push({event: 'ui:ride:start'});
                }
                continue;
            }
            if(equals(message.action, 'changeMode')) {
                actions.push({event: 'ui:mode-set', data: nextMode[mode] || ControlMode.erg});
            }
        }

        return actions;
    }

    function dispatchActions(actions) {
        for(let i = 0; i < actions.length; i++) {
            const action = actions[i];
            if('data' in action) {
                xf.dispatch(action.event, action.data);
            } else {
                xf.dispatch(action.event);
            }
        }
    }

    function onButtonState(messages, db) {
        dispatchActions(controlsFor(messages, db || {}));
    }

    xf.reg('ble:openBikeControl:buttonState', onButtonState);
    // Di2 sends raw button events, the left/right swap is a rider setting
    xf.reg('ble:di2:buttonState', (events, db) => {
        const swap = db?.sources?.di2Swap === true;
        onButtonState(di2Messages(events, {swap}), db);
    });

    return Object.freeze({
        controlsFor,
    });
}

const openBikeControl = OpenBikeControl();

export {
    OpenBikeControl,
    openBikeControl,
};
