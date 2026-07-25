import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutcomeTransition, countCycleNonClosed, findLastCycleNonClosed, resolveAttemptWrite } from './guard.ts';

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

// --- resolveAttemptWrite: insert (nuovo tentativo) vs update (correzione) ---

const NC = (n: number, at: string) => ({ id: `nc${n}`, outcome: 'Non chiuso', outcomeAt: new Date(at), attemptNumber: n });
const CH = (n: number, at: string) => ({ id: `ch${n}`, outcome: 'Chiuso', outcomeAt: new Date(at), attemptNumber: n });

test('resolveAttemptWrite: primo esito del lead → insert #0', () => {
    const r = resolveAttemptWrite({ attempts: [], outcome: 'Chiuso', cycleStartAt: null, leadHasOutcome: false, occasion: 'new' });
    assert.deepEqual(r, { mode: 'insert', attemptNumber: 0 });
});

test('resolveAttemptWrite: seconda chiusura sullo stesso ciclo → update, MAI un secondo Chiuso', () => {
    // Caso reale Rigolone/Sainato: chiusura registrata, poi ri-registrata per
    // correggerla → prima nasceva un attempt gemello e il fatturato raddoppiava.
    const r = resolveAttemptWrite({
        attempts: [CH(0, '2026-07-23T12:00:00Z')],
        outcome: 'Chiuso', cycleStartAt: null, leadHasOutcome: true, occasion: 'new',
    });
    assert.deepEqual(r, { mode: 'update', id: 'ch0' });
});

test('resolveAttemptWrite: la chiusura del ciclo precedente non blocca quella del nuovo ciclo', () => {
    const r = resolveAttemptWrite({
        attempts: [CH(0, '2026-06-10T12:00:00Z')],
        outcome: 'Chiuso', cycleStartAt: new Date('2026-07-15T00:00:00Z'), leadHasOutcome: true, occasion: 'new',
    });
    assert.deepEqual(r, { mode: 'insert', attemptNumber: 1 });
});

test('resolveAttemptWrite: esito di un follow-up (occasione nuova) → tentativo in più', () => {
    const r = resolveAttemptWrite({
        attempts: [NC(0, '2026-07-10T12:00:00Z')],
        outcome: 'Non chiuso', cycleStartAt: null, leadHasOutcome: true, occasion: 'new',
    });
    assert.deepEqual(r, { mode: 'insert', attemptNumber: 1 });
});

test('resolveAttemptWrite: chiusura diretta dallo Storico dopo un Non chiuso → tentativo in più', () => {
    // Il "Non chiuso" precedente deve restare: sono due tentativi, una chiusura.
    const r = resolveAttemptWrite({
        attempts: [NC(0, '2026-07-10T12:00:00Z')],
        outcome: 'Chiuso', cycleStartAt: null, leadHasOutcome: true, occasion: 'new',
    });
    assert.deepEqual(r, { mode: 'insert', attemptNumber: 1 });
});

test('resolveAttemptWrite: correzione dell esito corrente → update dell ultimo tentativo', () => {
    const r = resolveAttemptWrite({
        attempts: [NC(0, '2026-07-10T12:00:00Z'), NC(1, '2026-07-18T12:00:00Z')],
        outcome: 'Non chiuso', cycleStartAt: null, leadHasOutcome: true, occasion: 'current',
    });
    assert.deepEqual(r, { mode: 'update', id: 'nc1' });
});

test('resolveAttemptWrite: ciclo riaperto e non ancora esitato → insert', () => {
    // reopenNegotiation azzera salespersonOutcome: non c e nulla da correggere.
    const r = resolveAttemptWrite({
        attempts: [NC(0, '2026-07-20T12:00:00Z')],
        outcome: 'Non chiuso', cycleStartAt: new Date('2026-07-15T00:00:00Z'), leadHasOutcome: false, occasion: 'current',
    });
    assert.deepEqual(r, { mode: 'insert', attemptNumber: 1 });
});

test('resolveAttemptWrite: la correzione ignora i tentativi fuori ciclo', () => {
    const r = resolveAttemptWrite({
        attempts: [NC(0, '2026-06-01T12:00:00Z'), NC(1, '2026-07-20T12:00:00Z')],
        outcome: 'Sparito', cycleStartAt: new Date('2026-07-15T00:00:00Z'), leadHasOutcome: true, occasion: 'current',
    });
    assert.deepEqual(r, { mode: 'update', id: 'nc1' });
});
