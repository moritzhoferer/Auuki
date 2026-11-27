import { xf, equals, exists } from '../functions.js';
import { isToday } from '../utils.js';
import { UIView, icon, html, duration } from './ui.js';
import { models } from '../models/models.js';
import { workoutDuration, profileBlocks, intervalTarget } from '../models/profile.js';

//
// Workout views, all built from the same two templates:
//   profileSvg(workout, ftp)   the workout's shape
//   workoutCard(workout, ...)  name, meta, shape and a ride button
//

function profileSvg(workout, ftp, className = '') {
    const total = workoutDuration(workout);
    const blocks = profileBlocks(workout, ftp);
    if(total <= 0 || blocks.length === 0) return '';
    const scale = Math.max(1.2, ...blocks.map(b => b.intensity));
    const rects = blocks.map(b => {
        const h = 100 * b.intensity / scale;
        const zone = models.ftp.percentageToZone(b.intensity);
        return `<rect data-zone="${zone}" x="${(1000 * b.start / total).toFixed(1)}" y="${(100 - h).toFixed(1)}"
            width="${Math.max(1, 1000 * b.duration / total - 1.5).toFixed(1)}" height="${h.toFixed(1)}"/>`;
    }).join('');
    return `<svg class="profile ${className}" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
}

function weekday(dateString) {
    if(!dateString) return '';
    if(isToday(dateString)) return 'Today';
    return new Date(dateString).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric'});
}

// 'Custom' is the .zwo parser's placeholder for a missing category, not worth showing
function workoutMeta(workout) {
    const parts = [];
    const total = workoutDuration(workout) || workout?.meta?.duration;
    if(total) parts.push(duration(total));
    const category = workout?.meta?.category;
    if(category && category !== 'Custom') parts.push(category);
    return parts.join(' · ');
}

function workoutCard(workout, ftp, action, {when = '', primary = false} = {}) {
    const name = workout?.meta?.name || 'Workout';
    return `<article class="card workout-card ${primary ? 'card--accent' : ''}">
        <header class="workout-card--head">
            <h3 class="workout-card--name">${html(name)}</h3>
            <span class="workout-card--meta">${when ?
                `<span class="workout-card--when ${when.startsWith('Today') ? 'is-today' : ''}">${html(when)}</span> · ` : ''}${html(workoutMeta(workout))}</span>
        </header>
        ${profileSvg(workout, ftp)}
        <button class="btn ${primary ? 'btn--primary' : ''}" data-action="${action}" data-param="${html(workout.id)}"
            aria-label="Ride ${html(name)}">Ride</button>
    </article>`;
}


//
// <today-card>  today's planned workout, or a nudge
//
class TodayCard extends UIView {
    props() { return ['planned', 'plannedStatus', 'rider', 'ftp']; }
    render() {
        const { planned = [], plannedStatus, rider, ftp } = this.data;
        const today = planned.find(w => isToday(w.meta?.startDateLocal));

        if(today) {
            this.innerHTML = workoutCard(today, ftp, 'ride:planned', {when: 'Today', primary: true});
            return;
        }

        let text = 'Nothing planned for today.';
        let extra = '';
        if(!rider?.intervals?.connected) {
            text = 'Connect Intervals.icu to see your planned workouts here.';
            extra = `<button class="btn btn--ghost" data-action="screen" data-param="settings">Connect Intervals.icu</button>`;
        } else if(equals(plannedStatus, 'loading')) {
            text = 'Loading your plan…';
        } else if(equals(plannedStatus, 'error')) {
            text = "Couldn't load your plan from Intervals.icu.";
            extra = `<button class="btn btn--ghost" data-action="planned:refresh">Try again</button>`;
        }

        this.innerHTML = `<article class="card card--accent today-empty">
            <p><span class="workout-card--when is-today">Today</span> · ${html(text)}</p>
            ${extra ? `<div class="row">${extra}</div>` : ''}
        </article>`;
    }
}

customElements.define('today-card', TodayCard);


//
// <planned-list>  the plan from Intervals.icu: today, the next 7 days behind "More"
//
class PlannedList extends UIView {
    props() { return ['planned', 'plannedStatus', 'ftp', 'rider']; }
    config() {
        this.more = false;
        this.addEventListener('click', (e) => {
            if(!e.target.closest('.planned-more')) return;
            this.more = !this.more;
            this.render();
        }, this.signal);
    }
    render() {
        const { planned = [], ftp, rider } = this.data;
        if(!rider?.intervals?.connected) {
            this.innerHTML = `<p class="muted">Connect Intervals.icu in settings to see your plan.</p>`;
            return;
        }
        const card = (w) => workoutCard(w, ftp, 'ride:planned', {when: weekday(w.meta?.startDateLocal)});
        const today = planned.filter(w => isToday(w.meta?.startDateLocal));
        const later = planned.filter(w => !isToday(w.meta?.startDateLocal));
        // the toggle is the last tile of the grid; a plain button once the grid is one column
        const toggle = later.length ? `<button class="btn btn--ghost planned-more" aria-expanded="${this.more}"
                aria-label="${this.more ? 'Show only today' : `Show ${later.length} more in the next 7 days`}">
                <span>${this.more ? 'Less' : `${later.length} more`}</span>${icon('chevron', 'planned-more--chevron')}</button>` : '';
        const cards = [...today, ...(this.more ? later : [])].map(card).join('');
        this.innerHTML = `${today.length ? '' : `<p class="muted">Nothing planned for today.</p>`}
            ${cards || toggle ? `<div class="card-grid">${cards}${toggle}</div>` : ''}`;
    }
}

customElements.define('planned-list', PlannedList);


//
// <library-list>  built-in and uploaded workouts, with search and category
//
class LibraryList extends UIView {
    props() { return ['workouts', 'ftp']; }
    config() {
        this.query = '';
        this.category = '';
        this.innerHTML = `<div class="row library-filters">
                <label class="field"><span>Search</span><input type="search" class="library-search" placeholder="Sweet spot"></label>
                <label class="field"><span>Type</span><select class="library-category"><option value="">All</option></select></label>
            </div>
            <div class="card-grid library-items"></div>`;
        this.$items = this.querySelector('.library-items');
        this.$category = this.querySelector('.library-category');
        this.querySelector('.library-search').addEventListener('input', (e) => {
            this.query = e.target.value.trim().toLowerCase();
            this.renderItems();
        }, this.signal);
        this.$category.addEventListener('change', (e) => {
            this.category = e.target.value;
            this.renderItems();
        }, this.signal);
    }
    render() {
        const categories = [...new Set((this.data.workouts ?? []).map(w => w.meta?.category).filter(Boolean))].sort();
        this.$category.innerHTML = `<option value="">All</option>` +
            categories.map(c => `<option ${equals(c, this.category) ? 'selected' : ''}>${html(c)}</option>`).join('');
        this.renderItems();
    }
    renderItems() {
        const items = (this.data.workouts ?? []).filter(w => {
            const name = (w.meta?.name ?? '').toLowerCase();
            return (!this.query || name.includes(this.query) ||
                    (w.meta?.description ?? '').toLowerCase().includes(this.query)) &&
                   (!this.category || equals(w.meta?.category, this.category));
        });
        this.$items.innerHTML = items.length ?
            items.map(w => workoutCard(w, this.data.ftp, 'ride:library')).join('') :
            `<p class="muted">No workout matches.</p>`;
    }
}

customElements.define('library-list', LibraryList);


//
// <workout-preview>  the ready check: what you're about to ride
//
class WorkoutPreview extends UIView {
    props() { return ['workout', 'ftp', 'rideKind', 'mode']; }
    render() {
        const { workout, ftp, rideKind } = this.data;
        if(equals(rideKind, 'free')) {
            this.innerHTML = `<h2 class="preview--name">Free ride</h2>
                <p class="muted">No workout: set your own target with − and +, or pedal in slope mode.</p>`;
            return;
        }
        const intervals = workout?.intervals ?? [];
        const first = intervals[0];
        this.innerHTML = `<h2 class="preview--name">${html(workout?.meta?.name ?? 'Workout')}</h2>
            <p class="muted">${html(workoutMeta(workout))}${intervals.length ? ` · ${intervals.length} intervals` : ''}</p>
            ${profileSvg(workout, ftp, 'profile--large')}
            ${first ? `<p class="preview--first">Starts with ${html(duration(first.duration))} at ${html(intervalTarget(first, ftp) || 'your own pace')}</p>` : ''}
            ${workout?.meta?.description ? `<details class="preview--description"><summary>Description</summary><p>${html(workout.meta.description)}</p></details>` : ''}`;
    }
}

customElements.define('workout-preview', WorkoutPreview);


//
// <file-picker>  a real button that opens the file dialog (.zwo, .fit course)
//
class FilePicker extends HTMLElement {
    connectedCallback() {
        const label = this.getAttribute('label') ?? 'Upload file';
        this.innerHTML = `<button class="${this.getAttribute('button-class') ?? 'btn'}" type="button"
                aria-label="${html(this.getAttribute('aria') ?? 'Load a .zwo workout or a .fit course')}">
                ${this.hasAttribute('icon') ? icon('upload') : ''}<span>${html(label)}</span></button>
            <input type="file" accept=".zwo,.fit" multiple hidden>`;
        const $input = this.querySelector('input');
        this.querySelector('button').addEventListener('click', () => $input.click());
        $input.addEventListener('change', () => {
            if($input.files.length) xf.dispatch('ui:workout:upload', $input.files);
            $input.value = '';
        });
    }
}

customElements.define('file-picker', FilePicker);

export { profileSvg, workoutCard, workoutMeta };
