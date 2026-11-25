import { rideLayout, rowsFor } from '../../src/models/layout.js';

// screen size -> the ride grid's content box, as in docs/design/ride-v2/ride-v3-mockup.html:
// header 48, bottom bar 64, grid padding 10 top and bottom, 12 (narrow) or 16 (wide) at the sides
const box = (w, h) => ({width: w - (w < 700 ? 24 : 32), height: h - 48 - 64 - 20});

const few = ['heartRate', 'cadence'];
const many = ['heartRate', 'cadence', 'smo2', 'thb', 'coreBodyTemperature', 'skinTemperature'];
const totals = ['powerAvg', 'kcal', 'distance', 'speedVirtual'];

const layout = (w, h, primary, kind = 'workout') => rideLayout({...box(w, h), kind, primary, secondary: totals});
const item = (l, key) => l.items.find(i => i.key === key);
const fieldGroups = (l) => l.items.filter(i => i.key === 'fields').map(i => `${i.size}${i.span}`);

// one line per screen: pacing step and rows, field groups, profile rows
const summary = (l) => [
    `${item(l, 'pacing').step}${item(l, 'pacing').span}`,
    fieldGroups(l).join('+') || '-',
    item(l, 'profile')?.span ?? '-',
].join(' ');

describe('rowsFor', () => {
    test('n rows take n × 72 − 8 px', () => {
        expect(rowsFor(64)).toBe(1);
        expect(rowsFor(135)).toBe(1);
        expect(rowsFor(136)).toBe(2);
        expect(rowsFor(0)).toBe(0);
    });

    test('rows of the mockup screens', () => {
        expect(rowsFor(box(400, 880).height)).toBe(10);
        expect(rowsFor(box(400, 800).height)).toBe(9);
        expect(rowsFor(box(800, 700).height)).toBe(8);
        expect(rowsFor(box(1440, 900).height)).toBe(10);
    });
});

describe('rideLayout matches the v3 mockup', () => {
    test.each([
        [400, 880, few,  'l6 s1 1'],
        [400, 880, many, 'm4 s2 2'],
        [400, 800, few,  'm4 s1 2'],
        [400, 800, many, 'm4 s2 1'],
        [800, 700, few,  'l6 m2+s2 3'],
        [800, 700, many, 'l6 s4 3'],
        [1440, 900, few,  'xl8 m4 3'],
        [1440, 900, many, 'xl8 m6 3'],
    ])('%i × %i, %j', (w, h, primary, expected) => {
        expect(summary(layout(w, h, primary))).toBe(expected);
    });

    test('narrow: interval with next line, then pacing, fields, profile in one column', () => {
        const l = layout(400, 880, many);
        expect(l.wide).toBe(false);
        expect(l.items.map(i => [i.key, i.col, i.row, i.span])).toEqual([
            ['interval', 1, 1, 2],
            ['pacing', 1, 3, 4],
            ['fields', 1, 7, 2],
            ['profile', 1, 9, 2],
        ]);
        expect(item(l, 'interval').next).toBe(true);
        expect(item(l, 'fields')).toMatchObject({size: 's', cols: 3, fields: many});
        expect(l.spare).toBe(0);
    });

    test('narrow never shows ride totals', () => {
        const l = layout(400, 880, few);
        expect(item(l, 'fields').fields).toEqual(few);
        expect(item(l, 'fields').cols).toBe(2);
    });

    test('wide: up next, medium sensor fields, small totals, profile on the right', () => {
        const l = layout(800, 700, few);
        expect(l.wide).toBe(true);
        expect(l.items.map(i => [i.key, i.col, i.row, i.span])).toEqual([
            ['interval', 1, 1, 2],
            ['pacing', 1, 3, 6],
            ['next', 2, 1, 1],
            ['fields', 2, 2, 2],
            ['fields', 2, 4, 2],
            ['profile', 2, 6, 3],
        ]);
        const [prim, sec] = l.items.filter(i => i.key === 'fields');
        expect(prim).toMatchObject({size: 'm', cols: 2, fields: few});
        expect(sec).toMatchObject({size: 's', cols: 3, fields: totals});
        expect(item(l, 'interval').next).toBe(false);
    });

    test('1440 with few sensors leaves the right column two rows short', () => {
        const l = layout(1440, 900, few);
        expect(item(l, 'fields')).toMatchObject({size: 'm', cols: 4, fields: [...few, ...totals]});
        expect(l.spare).toBe(0);
        const right = l.items.filter(i => i.col === 2);
        expect(Math.max(...right.map(i => i.row + i.span - 1))).toBe(8);
    });
});

describe('rideLayout edge cases', () => {
    test('no sensor fields: the pacing box takes the room', () => {
        const l = layout(400, 880, []);
        expect(summary(l)).toBe('l6 - 2');
    });

    test('free ride: elapsed instead of interval, no up next and no profile', () => {
        const n = layout(400, 880, few, 'free');
        expect(n.items.map(i => i.key)).toEqual(['elapsed', 'pacing', 'fields']);
        expect(item(n, 'pacing').step).toBe('l');

        const w = layout(1440, 900, few, 'free');
        expect(w.items.map(i => i.key)).toEqual(['elapsed', 'pacing', 'fields']);
        expect(item(w, 'fields').row).toBe(1);
    });

    test('fields are dropped by rows before the pacing box goes below S', () => {
        const l = layout(400, 640, many);
        expect(summary(l)).toBe('s3 s1 1');
        expect(item(l, 'fields').fields).toEqual(many.slice(0, 3));
    });

    test.each([400, 560, 700, 800, 1024, 1440, 1920])('nothing runs past the last row at %i px wide', (w) => {
        for(let h = 700; h <= 1400; h += 10) {
            for(const primary of [[], few, many]) {
                const l = layout(w, h, primary);
                const bottom = Math.max(...l.items.map(i => i.row + i.span - 1));
                expect(bottom).toBeLessThanOrEqual(l.rows);
                expect(l.spare).toBe(l.rows - bottom);
            }
        }
    });
});
