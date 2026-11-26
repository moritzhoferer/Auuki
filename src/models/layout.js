//
// Ride screen layout on the row grid (docs/design/PRINCIPLES.md §6).
// Pure: takes the size of the ride grid's content box and the fields to show,
// returns where each tile goes. The view only writes the result into CSS.
//

const unit = 64;            // one row
const gap = 8;              // between rows and between tiles in a row
const row = unit + gap;     // 72
const columnGap = 12;       // between the two columns in wide
const wideFrom = 668;       // content width for two columns (a 700 px screen)
const rightShare = 1 / 2.2; // columns are 1.2fr 1fr
const minField = {s: 104, m: 150};
const fieldRows = {s: 1, m: 2};
const pacingSteps = [8, 6, 4, 3];
const stepName = {3: 's', 4: 'm', 6: 'l', 8: 'xl'};
// the least any ride shows: interval (or elapsed) 2 rows + the smallest pacing box
const minRows = 2 + pacingSteps.at(-1);
const minUnit = 32;         // below this rows are not shrunk any further

// Number -> Int
const rowsFor = (height) => Math.max(0, Math.floor((height + gap) / row));

// Number, Number -> Int, how many tiles of min width fit next to each other
const perRow = (width, min) => Math.max(1, Math.floor((width + gap) / (min + gap)));

// a block of field tiles of one size
function group(size, fields, width) {
    const cols = Math.min(perRow(width, minField[size]), Math.max(1, fields.length));
    return {size, fields, cols, span: fields.length ? Math.ceil(fields.length / cols) * fieldRows[size] : 0};
}

const pacing = (row, span) => ({key: 'pacing', col: 1, row, span, step: stepName[span]});
const fieldsItem = (col, row, g) => ({key: 'fields', col, row, span: g.span, size: g.size, cols: g.cols, fields: g.fields});

// narrow: one column, top to bottom
function narrow(rows, width, kind, primary) {
    const workout = kind !== 'free';
    const cols = perRow(width, minField.s);
    // the biggest pacing box next to as many field rows as fit, fields go before pacing goes below S
    const fit = (profileMin) => {
        let fr = Math.ceil(primary.length / cols);
        let p;
        while(!(p = pacingSteps.find(x => 2 + x + fr + profileMin <= rows)) && fr > 0) fr--;
        return p ? {p, fr} : undefined;
    };
    let profileMin = workout ? 1 : 0;
    let best = fit(profileMin);
    if(!best && profileMin) {
        // too short even for one profile row: drop the profile before anything overflows
        profileMin = 0;
        best = fit(0);
    }
    const { p, fr } = best ?? {p: pacingSteps.at(-1), fr: 0};

    let profile = profileMin;
    if(workout && rows - (2 + p + fr + profile) >= 1) profile = 2;

    const items = [];
    let r = 1;
    items.push({key: workout ? 'interval' : 'elapsed', col: 1, row: r, span: 2, next: workout}); r += 2;
    items.push(pacing(r, p)); r += p;
    if(fr) {
        const g = group('s', primary.slice(0, fr * cols), width);
        items.push(fieldsItem(1, r, g)); r += g.span;
    }
    if(profile) { items.push({key: 'profile', col: 1, row: r, span: profile}); r += profile; }
    return {rows, wide: false, items, spare: Math.max(0, rows - (r - 1))};
}

// wide: interval + pacing on the left; up next, fields, profile on the right
function wide(rows, width, kind, primary, secondary) {
    const workout = kind !== 'free';
    const right = (width - columnGap) * rightShare;
    const p = pacingSteps.find(x => 2 + x <= rows) ?? pacingSteps.at(-1);
    const items = [
        {key: workout ? 'interval' : 'elapsed', col: 1, row: 1, span: 2, next: false},
        pacing(3, p),
    ];

    const top = workout ? 1 : 0;      // up next
    const bottom = workout ? 2 : 0;   // profile, at least 2 rows
    const avail = rows - top - bottom;
    const options = [
        [group('m', [...primary, ...secondary], right)],
        [group('m', primary, right), group('s', secondary, right)],
        [group('s', [...primary, ...secondary], right)],
        [group('m', primary, right)],
        [group('s', primary, right)],
    ];
    const total = (o) => o.reduce((a, g) => a + g.span, 0);
    let groups = options.find(o => total(o) <= avail);
    if(!groups) {
        // not even the small primary fields fit: show as many rows as there is room for
        const cols = perRow(right, minField.s);
        groups = [group('s', primary.slice(0, Math.max(0, avail) * cols), right)];
    }

    let r = 1;
    if(workout) items.push({key: 'next', col: 2, row: r++, span: 1});
    for(const g of groups) {
        if(!g.span) continue;
        items.push(fieldsItem(2, r, g)); r += g.span;
    }
    if(workout) {
        const profile = rows - (r - 1) - bottom >= 1 ? 3 : 2;
        items.push({key: 'profile', col: 2, row: r, span: profile}); r += profile;
    }
    const used = Math.max(2 + p, r - 1);
    return {rows, wide: true, items, spare: Math.max(0, rows - used)};
}

// {width, height, kind: 'workout'|'free', primary: [field], secondary: [field]}
// -> {rows, unit, wide, items: [{key, col, row, span, step?, size?, cols?, fields?, next?}], spare}
// width and height are the ride grid's content box. secondary (ride totals) is only used in wide.
// unit is the row height in px: 64, or less on screens too short for minRows (phone in landscape).
function rideLayout({width, height, kind = 'workout', primary = [], secondary = []} = {}) {
    let rows = rowsFor(height);
    let rowUnit = unit;
    if(rows < minRows) {
        rows = minRows;
        rowUnit = Math.max(minUnit, Math.floor((height + gap) / minRows) - gap);
    }
    const layout = width >= wideFrom ?
        wide(rows, width, kind, primary, secondary) :
        narrow(rows, width, kind, primary);
    return {...layout, unit: rowUnit};
}

export {
    rideLayout,
    rowsFor,
    perRow,
    unit,
    gap,
    row,
    columnGap,
    wideFrom,
    minRows,
};
