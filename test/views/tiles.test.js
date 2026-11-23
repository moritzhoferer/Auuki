/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import '../../src/views/tiles.js';

const frame = () => new Promise(resolve => window.requestAnimationFrame(resolve));

describe('<metric-tile>', () => {
    test('a tile added later (by <tile-row>) gets its label and value', async () => {
        const $tile = document.createElement('metric-tile');
        $tile.setAttribute('field', 'heartRate');
        document.body.replaceChildren($tile);

        expect($tile.querySelector('.tile--label').textContent).toBe('Heart rate');

        xf.dispatch('db:heartRate', {heartRate: 142});
        await frame();
        expect($tile.querySelector('.tile--number').textContent).toBe('142');
        expect($tile.querySelector('.tile--unit').textContent).toBe('bpm');
    });

    test('an unknown field stays empty', () => {
        const $tile = document.createElement('metric-tile');
        $tile.setAttribute('field', 'nope');
        document.body.replaceChildren($tile);
        expect($tile.innerHTML).toBe('');
    });
});
