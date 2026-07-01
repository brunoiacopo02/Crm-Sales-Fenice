import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    reasonDistribution, topReason, followUpFunnel,
    closingStats, attemptsToClose, monthlyTrend, type AttemptInput,
} from './aggregate.ts';

const d = (s: string) => new Date(s);
const start = d('2026-06-01T00:00:00Z');
const end = d('2026-07-01T00:00:00Z');

// lead A: 3 tentativi → Non chiuso(0), Non chiuso(1), Chiuso(2)
// lead B: Non chiuso(0) e basta (follow-up aperto)
// lead C: Perso(0)
const attempts: AttemptInput[] = [
    { leadId: 'A', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-06-10T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-05T10:00:00Z') },
    { leadId: 'A', attemptNumber: 1, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-06-20T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-12T10:00:00Z') },
    { leadId: 'A', attemptNumber: 2, outcome: 'Chiuso', notClosedReason: null, nextFollowUpDate: null, closeProduct: 'gold', closeAmountEur: 2000, outcomeAt: d('2026-06-22T10:00:00Z') },
    { leadId: 'B', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Deve parlare con terzi', nextFollowUpDate: d('2026-06-25T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-15T10:00:00Z') },
    { leadId: 'C', attemptNumber: 0, outcome: 'Perso', notClosedReason: 'Non ha urgenza reale', nextFollowUpDate: null, closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-18T10:00:00Z') },
];

test('reasonDistribution conta motivi Non chiuso+Perso e calcola pct', () => {
    const dist = reasonDistribution(attempts, start, end);
    // 'Non ha soldi' x2, 'Deve parlare con terzi' x1, 'Non ha urgenza reale' x1 => tot 4
    assert.equal(dist[0].reason, 'Non ha soldi');
    assert.equal(dist[0].count, 2);
    assert.equal(dist[0].pct, 50);
    assert.equal(dist.reduce((s, r) => s + r.count, 0), 4);
});

test('topReason ritorna il motivo più frequente', () => {
    assert.deepEqual(topReason(reasonDistribution(attempts, start, end)), { reason: 'Non ha soldi', pct: 50 });
});

test('followUpFunnel: 2 lead entrati (A,B), 1 chiuso (A)', () => {
    const f = followUpFunnel(attempts, start, end);
    assert.equal(f.enteredFollowUp, 2);
    assert.equal(f.closed, 1);
    assert.equal(f.conversionPct, 50);
});

test('closingStats: A→Chiuso, B→Non chiuso (aperto), C→Perso (conteggio per esito più recente)', () => {
    const s = closingStats(attempts, start, end);
    assert.equal(s.chiusi, 1);
    assert.equal(s.nonChiusi, 1);
    assert.equal(s.perso, 1);
    assert.equal(s.sparito, 0);
    assert.equal(s.totalEsitati, 3);
    assert.equal(s.closingPct, 33);
    assert.equal(s.fatturato, 2000);
    assert.equal(s.topProduct, 'gold');
});

test('attemptsToClose: A chiuso al 3° tentativo (attemptNumber 2)', () => {
    const a = attemptsToClose(attempts, start, end);
    assert.equal(a.avgAttempts, 3);   // attemptNumber 2 + 1
    assert.equal(a.firstShotPct, 0);
});

test('monthlyTrend produce una riga per mese richiesto', () => {
    const t = monthlyTrend(attempts, ['2026-06']);
    assert.equal(t.length, 1);
    assert.equal(t[0].yearMonth, '2026-06');
    assert.equal(t[0].closingPct, 33);
});

test('reasonDistribution vuoto → array vuoto, topReason null', () => {
    assert.deepEqual(reasonDistribution([], start, end), []);
    assert.equal(topReason([]), null);
});
