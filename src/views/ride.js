import { xf, exists, equals } from '../functions.js';
import { UIView, clock, icon } from './ui.js';
import {
    toleranceWatts, rangeStatus, gaugePosition, hasRange,
} from '../models/range.js';
import {
    workoutDuration, workoutPosition, profileBlocks, smooth, stepLabel, intervalTarget,
} from '../models/profile.js';

//
// The ride screen. One layout for every width: CSS arranges the same parts in one
// column (split view) or two (wide). Free rides hide the workout parts.
//

xf.sub('db:rideKind', (kind) => { document.body.dataset.rideKind = kind; });
// started | paused | stopped, for parts of the page that change during a ride
xf.sub('db:watchStatus', (status) => { document.body.dataset.watch = status; });

// adds the 'last 5 seconds of the interval' check to UIView
class RideView extends UIView {
    isFinalSeconds() {
        const { lapTime, watchStatus } = this.data;
        return equals(watchStatus, 'started') && lapTime > 0 && lapTime <= 5;
    }
}



//
// <interval-block>
// label (from the workout file), elapsed / duration, countdown and progress
//
class IntervalBlock extends RideView {
    props() {
        return ['workout', 'intervalIndex', 'stepIndex', 'lapTime', 'watchStatus'];
    }
    config() {
        this.$label     = this.querySelector('.rp-interval--label');
        this.$elapsed   = this.querySelector('.rp-interval--elapsed');
        this.$countdown = this.querySelector('.rp-interval--countdown');
        this.$progress  = this.querySelector('.rp-interval--progress-bar');
    }
    render() {
        const { workout, intervalIndex = 0, stepIndex = 0, lapTime = 0, watchStatus } = this.data;
        const interval  = workout?.intervals?.[intervalIndex];
        const step      = interval?.steps?.[stepIndex];
        const isRunning = !equals(watchStatus ?? 'stopped', 'stopped');
        const duration  = interval?.duration ?? 0;
        const remaining = isRunning ? lapTime : duration;
        const elapsed   = Math.min(duration, Math.max(0, duration - remaining));

        this.$label.textContent     = stepLabel(step) || stepLabel(interval?.steps?.[0]);
        this.$elapsed.textContent   = duration > 0 ? `${clock(elapsed)} / ${clock(duration)}` : '';
        this.$countdown.textContent = clock(remaining);
        this.$progress.style.width  = duration > 0 ? `${100 * elapsed / duration}%` : '0%';
        this.classList.toggle('final', this.isFinalSeconds());
    }
}

customElements.define('interval-block', IntervalBlock);


const statusText = {
    'in':        '● IN RANGE · hold it',
    'near-low':  '▼ SLIGHTLY LOW · push',
    'near-high': '▲ SLIGHTLY HIGH · ease off',
    'out-low':   '▼ TOO LOW · push',
    'out-high':  '▲ TOO HIGH · ease off',
};

function statusKey(status) {
    if(equals(status.zone, 'in')) return 'in';
    return `${status.zone}-${status.side}`;
}

//
// <pacing-box>
// status line, big 3 s power and the range gauge
//
class PacingBox extends RideView {
    props() {
        return ['power3s', 'powerLap', 'powerTargetRange', 'powerTolerance', 'ftp', 'watchStatus'];
    }
    config() {
        this.$status  = this.querySelector('.rp-pacing--status');
        this.$power   = this.querySelector('.rp-pacing--power');
        this.$low     = this.querySelector('.rp-gauge--low');
        this.$high    = this.querySelector('.rp-gauge--high');
        this.$needle  = this.querySelector('.rp-gauge--needle');
        this.$avg     = this.querySelector('.rp-gauge--avg');
    }
    render() {
        const { power3s = 0, powerLap = 0, powerTargetRange, powerTolerance = 7, ftp = 0, watchStatus } = this.data;
        const power = Math.round(power3s);

        this.$power.textContent = power;

        // neutral until the ride starts, and again after stop
        if(!hasRange(powerTargetRange) || equals(watchStatus ?? 'stopped', 'stopped')) {
            this.dataset.zone = 'none';
            this.$status.textContent = '';
            return;
        }

        const tolerance = toleranceWatts(powerTolerance, ftp);
        const status    = rangeStatus(power, powerTargetRange, tolerance);

        this.dataset.zone        = status.zone;
        this.$status.textContent = statusText[statusKey(status)];
        this.$low.textContent    = powerTargetRange.low;
        this.$high.textContent   = powerTargetRange.high;
        this.$needle.style.left  = `${gaugePosition(power, powerTargetRange, tolerance)}%`;

        if(powerLap > 0) {
            const lap = Math.round(powerLap);
            this.$avg.style.display = '';
            this.$avg.style.left    = `${gaugePosition(lap, powerTargetRange, tolerance)}%`;
            this.$avg.dataset.zone  = rangeStatus(lap, powerTargetRange, tolerance).zone;
        } else {
            this.$avg.style.display = 'none';
        }
    }
}

customElements.define('pacing-box', PacingBox);


//
// <lap-power-status>
// interval average, coloured by its status
//
class LapPowerStatus extends RideView {
    props() {
        return ['powerLap', 'powerTargetRange', 'powerTolerance', 'ftp'];
    }
    render() {
        const { powerLap = 0, powerTargetRange, powerTolerance = 7, ftp = 0 } = this.data;
        const lap = Math.round(powerLap);

        this.textContent = lap > 0 ? lap : '--';
        this.dataset.zone = (lap > 0 && hasRange(powerTargetRange)) ?
            rangeStatus(lap, powerTargetRange, toleranceWatts(powerTolerance, ftp)).zone :
            'none';
    }
}

customElements.define('lap-power-status', LapPowerStatus);


//
// <time-in-range>
//
class TimeInRangeValue extends RideView {
    props() {
        return ['timeInRange', 'powerTargetRange'];
    }
    render() {
        const { timeInRange = 0, powerTargetRange } = this.data;
        this.textContent = hasRange(powerTargetRange) ? `${timeInRange}%` : '--';
    }
}

customElements.define('time-in-range', TimeInRangeValue);


//
// <next-interval>
// only the next interval: label (if any), duration and target
//
class NextInterval extends RideView {
    props() {
        return ['workout', 'intervalIndex', 'lapTime', 'watchStatus', 'ftp'];
    }
    config() {
        this.$label    = this.querySelector('.rp-next--label');
        this.$duration = this.querySelector('.rp-next--duration');
        this.$target   = this.querySelector('.rp-next--target');
    }
    render() {
        const { workout, intervalIndex = 0, ftp = 0 } = this.data;
        const next = workout?.intervals?.[intervalIndex + 1];

        if(!exists(next)) {
            this.$label.textContent    = 'Finish';
            this.$duration.textContent = '';
            this.$target.textContent   = '';
        } else {
            this.$label.textContent    = stepLabel(next.steps?.[0]);
            this.$duration.textContent = clock(next.duration ?? 0);
            this.$target.textContent   = intervalTarget(next, ftp);
        }
        this.classList.toggle('final', this.isFinalSeconds());
    }
}

customElements.define('next-interval', NextInterval);


//
// <ride-profile>
// workout blocks, ridden fill, now line and the recorded power line
//
const svgns = 'http://www.w3.org/2000/svg';
const profileWidth  = 1000;
const profileHeight = 100;

class RideProfile extends RideView {
    props() {
        return ['workout', 'ftp', 'intervalIndex', 'lapTime', 'watchStatus', 'power1s'];
    }
    config() {
        this.$svg     = this.querySelector('svg');
        this.$clip    = this.querySelector('.rp-profile--clip-rect');
        this.$todo    = this.querySelector('.rp-profile--todo');
        this.$done    = this.querySelector('.rp-profile--done');
        this.$now     = this.querySelector('.rp-profile--now');
        this.$line    = this.querySelector('.rp-profile--power');
        this.$elapsed = this.querySelector('.rp-profile--elapsed');
        this.$left    = this.querySelector('.rp-profile--left');
        this.samples  = [];
        this.lastPosition = -1;
        this.blocksKey = '';
        this.scale = 1.2;

        xf.sub('watch:started', this.onStarted.bind(this), this.signal);
    }
    onStarted() {
        // a new session starts from stopped, a resume keeps the samples
        if(equals(this.data.watchStatus ?? 'stopped', 'stopped')) {
            this.samples = [];
            this.lastPosition = -1;
        }
    }
    renderBlocks(workout, ftp, total) {
        const key = `${workout?.id ?? workout?.meta?.name}:${ftp}:${total}`;
        if(equals(key, this.blocksKey)) return;
        this.blocksKey = key;

        const blocks = profileBlocks(workout, ftp);
        this.scale = Math.max(1.2, ...blocks.map(b => b.intensity));

        const toRects = (group) => {
            group.replaceChildren();
            for(const block of blocks) {
                const rect   = document.createElementNS(svgns, 'rect');
                const height = profileHeight * block.intensity / this.scale;
                rect.setAttribute('x', profileWidth * block.start / total);
                rect.setAttribute('y', profileHeight - height);
                rect.setAttribute('width', Math.max(1, profileWidth * block.duration / total - 2));
                rect.setAttribute('height', height);
                group.appendChild(rect);
            }
        };

        toRects(this.$todo);
        toRects(this.$done);
    }
    recordSample(position) {
        const { watchStatus, power1s = 0 } = this.data;
        if(!equals(watchStatus, 'started')) return;
        if(position === this.lastPosition) return;
        this.lastPosition = position;
        this.samples.push({position, power: power1s});
    }
    renderLine(total, ftp) {
        if(this.samples.length < 2 || ftp <= 0) {
            this.$line.setAttribute('points', '');
            return;
        }
        const powers = smooth(this.samples.map(s => s.power), 10);
        const step   = Math.max(1, Math.floor(this.samples.length / 400));
        const points = [];

        for(let i = 0; i < this.samples.length; i += step) {
            const x = profileWidth * this.samples[i].position / total;
            const y = profileHeight - profileHeight * Math.min(powers[i] / ftp, this.scale) / this.scale;
            points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
        this.$line.setAttribute('points', points.join(' '));
    }
    render() {
        const { workout, ftp = 0, intervalIndex = 0, lapTime = 0, watchStatus } = this.data;
        const total = workoutDuration(workout);
        if(total <= 0) return;

        const isRunning = !equals(watchStatus ?? 'stopped', 'stopped');
        const position  = isRunning ?
                          Math.min(total, workoutPosition(workout, intervalIndex, lapTime)) :
                          0;
        const x = profileWidth * position / total;

        this.renderBlocks(workout, ftp, total);
        this.recordSample(position);

        this.$clip.setAttribute('width', x);
        this.$now.setAttribute('x1', x);
        this.$now.setAttribute('x2', x);
        this.$elapsed.textContent = `${clock(position)} elapsed`;
        this.$left.textContent    = `${clock(total - position)} left`;

        // redraw the power line every 5 s
        if(this.samples.length % 5 === 1 || !isRunning) {
            this.renderLine(total, ftp);
        }
    }
}

customElements.define('ride-profile', RideProfile);


//
// <target-stepper>
// − value + for the target of the active mode, the unit follows the mode
//
const stepperModes = {
    erg:        {prop: 'powerTarget',      effect: 'power-target',      unit: 'W', label: 'Target', name: 'power target',      format: (x) => Math.round(x)},
    resistance: {prop: 'resistanceTarget', effect: 'resistance-target', unit: '',  label: 'Resistance', name: 'resistance',        format: (x) => Math.round(x)},
    sim:        {prop: 'slopeTarget',      effect: 'slope-target',      unit: '%', label: 'Slope', name: 'slope',             format: (x) => Number(x).toFixed(1)},
};

class TargetStepper extends RideView {
    props() {
        return ['mode', 'powerTarget', 'resistanceTarget', 'slopeTarget'];
    }
    config() {
        this.innerHTML = `<button class="btn btn--icon stepper--dec">${icon('minus')}</button>
            <output class="stepper--value" aria-live="off"><span class="stepper--label"></span><span class="stepper--reading"><span class="stepper--number">0</span><span class="stepper--unit"></span></span></output>
            <button class="btn btn--icon stepper--inc">${icon('plus')}</button>`;
        this.$number = this.querySelector('.stepper--number');
        this.$unit   = this.querySelector('.stepper--unit');
        this.$label  = this.querySelector('.stepper--label');
        this.$dec    = this.querySelector('.stepper--dec');
        this.$inc    = this.querySelector('.stepper--inc');
        this.$dec.addEventListener('click', () => this.step('dec'), this.signal);
        this.$inc.addEventListener('click', () => this.step('inc'), this.signal);
    }
    current() {
        return stepperModes[this.data.mode] ?? stepperModes.erg;
    }
    step(direction) {
        xf.dispatch(`ui:${this.current().effect}-${direction}`);
    }
    render() {
        const mode = this.current();
        this.$number.textContent = mode.format(this.data[mode.prop] ?? 0);
        this.$unit.textContent   = mode.unit;
        this.$label.textContent  = mode.label;
        this.$dec.setAttribute('aria-label', `Lower the ${mode.name} (arrow down)`);
        this.$inc.setAttribute('aria-label', `Raise the ${mode.name} (arrow up)`);
    }
}

customElements.define('target-stepper', TargetStepper);


//
// <ride-controls>
// finish (opens the finish sheet), previous interval, play/pause, skip (lap in free ride)
//
class RideControls extends RideView {
    props() {
        return ['watchStatus', 'rideKind', 'intervalIndex'];
    }
    config() {
        this.innerHTML = `<button class="btn btn--icon btn--ghost ride-controls--finish" data-action="ride:finish"
                aria-label="Finish the ride">${icon('stop')}</button>
            <button class="btn btn--icon btn--ghost ride-controls--back workout-only" data-action="watchBack"
                aria-label="Back to the previous interval (B)">${icon('previous')}</button>
            <button class="btn btn--icon btn--play ride-controls--play" data-action="ride:toggle"></button>
            <button class="btn btn--icon btn--ghost ride-controls--skip" data-action="watchLap"></button>`;
        this.$play   = this.querySelector('.ride-controls--play');
        this.$skip   = this.querySelector('.ride-controls--skip');
        this.$finish = this.querySelector('.ride-controls--finish');
        this.$back   = this.querySelector('.ride-controls--back');
    }
    render() {
        const status = this.data.watchStatus ?? 'stopped';
        const started = equals(status, 'started');
        const free = equals(this.data.rideKind, 'free');
        this.dataset.status = status;
        this.$play.innerHTML = icon(started ? 'pause' : 'play');
        this.$play.setAttribute('aria-label', started ? 'Pause (space)' : (equals(status, 'paused') ? 'Resume (space)' : 'Start (space)'));
        this.$skip.innerHTML = icon(free ? 'lap' : 'skip');
        this.$skip.setAttribute('aria-label', free ? 'New lap (L)' : 'Skip to the next interval (L)');
        this.$skip.disabled = !started;
        this.$back.disabled = !started || (this.data.intervalIndex ?? 0) === 0;
        this.$finish.disabled = equals(status, 'stopped');
    }
}

customElements.define('ride-controls', RideControls);


//
// <elapsed-time>  total ride time
//
class ElapsedTime extends RideView {
    props() { return ['elapsed']; }
    render() {
        this.textContent = clock(this.data.elapsed ?? 0);
    }
}

customElements.define('elapsed-time', ElapsedTime);

export {
    statusText,
    statusKey,
};
