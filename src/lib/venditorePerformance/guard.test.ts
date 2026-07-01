import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutcomeTransition } from './guard.ts';

test('Non chiuso senza follow-up → errore', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: null, priorNonClosedCount: 0 });
    assert.equal(r.ok, false);
});

test('Non chiuso con follow-up valido → ok', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: new Date('2026-07-10T09:00:00Z'), priorNonClosedCount: 1 });
    assert.equal(r.ok, true);
});

test('Non chiuso al 4° tentativo (tetto 3) → errore', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: new Date('2026-07-10T09:00:00Z'), priorNonClosedCount: 3 });
    assert.equal(r.ok, false);
});

test('Chiuso non richiede follow-up → ok', () => {
    const r = validateOutcomeTransition({ outcome: 'Chiuso', nextFollowUpDate: null, priorNonClosedCount: 3 });
    assert.equal(r.ok, true);
});

test('Perso è un esito terminale valido senza follow-up', () => {
    const r = validateOutcomeTransition({ outcome: 'Perso', nextFollowUpDate: null, priorNonClosedCount: 2 });
    assert.equal(r.ok, true);
});
