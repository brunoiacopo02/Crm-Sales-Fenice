import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutcomeTransition, countCycleNonClosed, findLastCycleNonClosed } from './guard.ts';

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

test('countCycleNonClosed senza ciclo → conta tutti i Non chiuso', () => {
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-01T10:00:00Z') },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-05T10:00:00Z') },
        { outcome: 'Sparito', outcomeAt: new Date('2026-07-10T10:00:00Z') },
    ], null);
    assert.equal(n, 2);
});

test('countCycleNonClosed con riapertura → conta solo gli attempt del nuovo ciclo', () => {
    const cycleStart = new Date('2026-07-15T00:00:00Z');
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-01T10:00:00Z') },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-05T10:00:00Z') },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-20T10:00:00Z') },
    ], cycleStart);
    assert.equal(n, 1);
});

test('countCycleNonClosed: attempt con outcomeAt esattamente a cycleStart conta nel nuovo ciclo', () => {
    const cycleStart = new Date('2026-07-15T00:00:00Z');
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-15T00:00:00Z') },
    ], cycleStart);
    assert.equal(n, 1);
});

test('countCycleNonClosed: outcomeAt null con ciclo attivo NON conta', () => {
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: null },
    ], new Date('2026-07-15T00:00:00Z'));
    assert.equal(n, 0);
});

test('findLastCycleNonClosed senza ciclo → sceglie attemptNumber massimo tra i Non chiuso', () => {
    const r = findLastCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-01T10:00:00Z'), attemptNumber: 1 },
        { outcome: 'Chiuso', outcomeAt: new Date('2026-07-10T10:00:00Z'), attemptNumber: 3 },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-05T10:00:00Z'), attemptNumber: 2 },
    ], null);
    assert.equal(r?.attemptNumber, 2);
});

test('findLastCycleNonClosed con ciclo → esclude gli attempt precedenti la riapertura', () => {
    const cycleStart = new Date('2026-07-15T00:00:00Z');
    const r = findLastCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-01T10:00:00Z'), attemptNumber: 1 },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-05T10:00:00Z'), attemptNumber: 2 },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-20T10:00:00Z'), attemptNumber: 3 },
    ], cycleStart);
    assert.equal(r?.attemptNumber, 3);
});

test('findLastCycleNonClosed: nessun Non chiuso → null', () => {
    const r = findLastCycleNonClosed([
        { outcome: 'Chiuso', outcomeAt: new Date('2026-07-01T10:00:00Z'), attemptNumber: 1 },
        { outcome: 'Sparito', outcomeAt: new Date('2026-07-05T10:00:00Z'), attemptNumber: 2 },
    ], null);
    assert.equal(r, null);
});

test('findLastCycleNonClosed: outcomeAt null con ciclo attivo escluso', () => {
    const r = findLastCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: null, attemptNumber: 1 },
    ], new Date('2026-07-15T00:00:00Z'));
    assert.equal(r, null);
});
