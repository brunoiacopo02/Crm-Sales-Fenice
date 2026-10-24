import test from 'node:test';
import assert from 'node:assert/strict';
import { serveConfermeOutcome } from './leadStatusRecall';

const R = new Date('2026-10-27T08:00:00Z');

test('parcheggiato: da_rifissare + recallAt', () => {
    assert.deepEqual(serveConfermeOutcome(true, null, R), { confermeOutcome: 'da_rifissare', recallAt: R.toISOString() });
});
test('parcheggiato poi scartato: scartato, niente recallAt', () => {
    assert.deepEqual(serveConfermeOutcome(true, 'scartato', R), { confermeOutcome: 'scartato', recallAt: null });
});
test('non parcheggiato con recallDate: recallAt null', () => {
    assert.deepEqual(serveConfermeOutcome(false, 'confermato', R), { confermeOutcome: 'confermato', recallAt: null });
});
test('parcheggiato + confermato: da_rifissare', () => {
    assert.equal(serveConfermeOutcome(true, 'confermato', R).confermeOutcome, 'da_rifissare');
});
