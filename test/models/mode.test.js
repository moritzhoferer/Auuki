/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import { models } from '../../src/models/models.js';
import { db } from '../../src/db.js';

describe('Mode is the user choice', () => {

    beforeEach(() => {
        window.localStorage.clear();
    });

    test('mode defaults to erg', () => {
        expect(models.mode.restore()).toBe('erg');
    });

    test('mode is saved and restored', () => {
        models.mode.backup(models.mode.set('sim'));

        expect(window.localStorage.getItem('mode')).toBe('sim');
        expect(models.mode.restore()).toBe('sim');
    });

    test('invalid stored mode falls back to erg', () => {
        window.localStorage.setItem('mode', 'turbo');

        expect(models.mode.set(models.mode.restore())).toBe('erg');
    });

    test('ui:mode-set stores the choice', () => {
        xf.dispatch('ui:mode-set', 'resistance');

        expect(db.mode).toBe('resistance');
        expect(window.localStorage.getItem('mode')).toBe('resistance');

        xf.dispatch('ui:mode-set', 'sim');

        expect(db.mode).toBe('sim');
        expect(window.localStorage.getItem('mode')).toBe('sim');
    });

    test('there is no mode lock', () => {
        expect(db).not.toHaveProperty('lock');
    });
});
