import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutcomeTransition } from './guard.ts';

test('Non chiuso senza follow-up → ok (follow-up facoltativo)', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: null, priorNonClosedCount: 0 });
    assert.equal(r.ok, true);
});

test('Non chiuso con follow-up valido → ok', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: new Date('2026-07-10T09:00:00Z'), priorNonClosedCount: 1 });
    assert.equal(r.ok, true);
});

test('Nuovo follow-up oltre il tetto 3 → errore', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: new Date('2026-07-10T09:00:00Z'), priorNonClosedCount: 3 });
    assert.equal(r.ok, false);
});

test('Non chiuso oltre il tetto ma SENZA nuovo follow-up → ok', () => {
    const r = validateOutcomeTransition({ outcome: 'Non chiuso', nextFollowUpDate: null, priorNonClosedCount: 3 });
    assert.equal(r.ok, true);
});

test('Chiuso non richiede follow-up → ok', () => {
    const r = validateOutcomeTransition({ outcome: 'Chiuso', nextFollowUpDate: null, priorNonClosedCount: 3 });
    assert.equal(r.ok, true);
});

test('Perso non è più un esito valido', () => {
    const r = validateOutcomeTransition({ outcome: 'Perso', nextFollowUpDate: null, priorNonClosedCount: 2 });
    assert.equal(r.ok, false);
});
