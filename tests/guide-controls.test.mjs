// How-to-play controls table from the game's default bindings (site/js/guide-controls.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {controlRows,keyLabel} from '../site/js/guide-controls.mjs';
import * as kb from '../browser/key-bindings.mjs';

test('key names read like keys', () => {
 assert.equal(keyLabel('Mouse0'),'Left mouse');assert.equal(keyLabel('Mouse1'),'Right mouse');assert.equal(keyLabel('Alpha3'),'3');
 assert.equal(keyLabel('LeftControl'),'Ctrl');assert.equal(keyLabel('LeftShift'),'Shift');assert.equal(keyLabel('Return'),'Enter');assert.equal(keyLabel('W'),'W');
});

test('controls come from the original defaults', () => {
 const rows=Object.fromEntries(controlRows(kb).map(r=>[r.action,r.keys]));
 assert.deepEqual(rows['Move'],['W','A','S','D']);
 assert.deepEqual(rows['Sprint'],['Shift']);assert.deepEqual(rows['Jump'],['Space']);assert.deepEqual(rows['Crouch'],['Ctrl']);
 assert.deepEqual(rows['Use'],['E','Middle mouse']);assert.deepEqual(rows['Inventory'],['Tab']);assert.deepEqual(rows['Belt'],['1–6']);
 assert.deepEqual(rows['Fire'],['Left mouse']);assert.deepEqual(rows['Aim'],['Right mouse']);assert.deepEqual(rows['Reload'],['R']);
 assert.deepEqual(rows['Chat'],['Enter','T']);assert.deepEqual(rows['Voice'],['V']);assert.deepEqual(rows['Console'],['F1']);
});
