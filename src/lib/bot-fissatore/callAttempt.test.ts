import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCallAttempt } from './callAttempt';

const D = new Date('2026-08-29T10:00:00Z');

test('primo NR: nessuna chiamata registrata', () => {
    assert.equal(resolveCallAttempt({ confCall1At: null, confCall2At: null, confCall3At: null }), 1);
});

test('secondo NR: non si notifica, il fornitore accetta solo 1 e 3', () => {
    assert.equal(resolveCallAttempt({ confCall1At: D, confCall2At: null, confCall3At: null }), null);
});

test('terzo NR: e l ultima occasione prima dello scarto', () => {
    assert.equal(resolveCallAttempt({ confCall1At: D, confCall2At: D, confCall3At: null }), 3);
});

test('stato impossibile (3 NR gia scritti): non e un tentativo nuovo, non si notifica', () => {
    assert.equal(resolveCallAttempt({ confCall1At: D, confCall2At: D, confCall3At: D }), null);
});
