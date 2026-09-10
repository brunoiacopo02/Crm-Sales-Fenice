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
// `presentedAt` è un campo del LEAD: stesso valore su tutte le righe dello stesso leadId.
const attempts: AttemptInput[] = [
    { leadId: 'A', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-06-10T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-05T10:00:00Z'), presentedAt: d('2026-06-05T09:00:00Z') },
    { leadId: 'A', attemptNumber: 1, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-06-20T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-12T10:00:00Z'), presentedAt: d('2026-06-05T09:00:00Z') },
    { leadId: 'A', attemptNumber: 2, outcome: 'Chiuso', notClosedReason: null, nextFollowUpDate: null, closeProduct: 'gold', closeAmountEur: 2000, outcomeAt: d('2026-06-22T10:00:00Z'), presentedAt: d('2026-06-05T09:00:00Z') },
    { leadId: 'B', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Deve parlare con terzi', nextFollowUpDate: d('2026-06-25T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-15T10:00:00Z'), presentedAt: d('2026-06-15T09:00:00Z') },
    { leadId: 'C', attemptNumber: 0, outcome: 'Perso', notClosedReason: 'Non ha urgenza reale', nextFollowUpDate: null, closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-06-18T10:00:00Z'), presentedAt: d('2026-06-18T09:00:00Z') },
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

test('closingStats: coorte di 3 presenze di giugno → A Chiuso, B Non chiuso, C Perso', () => {
    const s = closingStats(attempts, start, end);
    assert.equal(s.chiusi, 1);
    assert.equal(s.nonChiusi, 1);
    assert.equal(s.perso, 1);
    assert.equal(s.sparito, 0);
    assert.equal(s.presenze, 3);
    assert.equal(s.inLavorazione, 0);
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

// ── Closing rate di coorte: i tre casi che facevano sballare settembre 2026 ──
//
// Coorte agosto/settembre con un lead per ogni caso limite:
//  AGO_FU          presenza di agosto richiamata tre volte a settembre;
//  AGO_CHIUSO_SET  presenza di agosto firmata a settembre;
//  SET_CHIUSO      presenza di settembre chiusa subito;
//  SET_APERTO      presenza di fine settembre esitata solo a ottobre.
const AGO_START = d('2026-08-01T00:00:00Z');
const AGO_END = d('2026-09-01T00:00:00Z');
const SET_START = d('2026-09-01T00:00:00Z');
const SET_END = d('2026-10-01T00:00:00Z');

const coorte: AttemptInput[] = [
    { leadId: 'AGO_FU', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-09-02T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-08-20T10:00:00Z'), presentedAt: d('2026-08-20T09:00:00Z') },
    { leadId: 'AGO_FU', attemptNumber: 1, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-09-05T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-09-02T10:00:00Z'), presentedAt: d('2026-08-20T09:00:00Z') },
    { leadId: 'AGO_FU', attemptNumber: 2, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: d('2026-09-10T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-09-05T10:00:00Z'), presentedAt: d('2026-08-20T09:00:00Z') },
    { leadId: 'AGO_FU', attemptNumber: 3, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: null, closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-09-10T10:00:00Z'), presentedAt: d('2026-08-20T09:00:00Z') },
    { leadId: 'AGO_CHIUSO_SET', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Deve parlare con terzi', nextFollowUpDate: d('2026-09-15T09:00:00Z'), closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-08-12T10:00:00Z'), presentedAt: d('2026-08-12T09:00:00Z') },
    { leadId: 'AGO_CHIUSO_SET', attemptNumber: 1, outcome: 'Chiuso', notClosedReason: null, nextFollowUpDate: null, closeProduct: 'gold', closeAmountEur: 5000, outcomeAt: d('2026-09-15T10:00:00Z'), presentedAt: d('2026-08-12T09:00:00Z') },
    { leadId: 'SET_CHIUSO', attemptNumber: 0, outcome: 'Chiuso', notClosedReason: null, nextFollowUpDate: null, closeProduct: 'gold', closeAmountEur: 3000, outcomeAt: d('2026-09-03T10:00:00Z'), presentedAt: d('2026-09-03T09:00:00Z') },
    { leadId: 'SET_APERTO', attemptNumber: 0, outcome: 'Non chiuso', notClosedReason: 'Non ha soldi', nextFollowUpDate: null, closeProduct: null, closeAmountEur: null, outcomeAt: d('2026-10-02T10:00:00Z'), presentedAt: d('2026-09-28T09:00:00Z') },
];

test('closingStats: i tre follow-up di settembre su una presenza di agosto non entrano nel denominatore di settembre', () => {
    // Il bug vecchio bucketizzava sull'esito più recente: AGO_FU aveva
    // outcomeAt a settembre e finiva nel denominatore del mese sbagliato.
    const set = closingStats(coorte, SET_START, SET_END);
    assert.equal(set.presenze, 2);          // solo SET_CHIUSO e SET_APERTO
    assert.equal(set.chiusi, 1);
    assert.equal(set.closingPct, 50);

    const ago = closingStats(coorte, AGO_START, AGO_END);
    assert.equal(ago.presenze, 2);          // AGO_FU e AGO_CHIUSO_SET
    assert.equal(ago.nonChiusi, 1);         // AGO_FU è ancora "Non chiuso"
});

test('closingStats: la presenza di fine settembre esitata solo a ottobre resta nel denominatore di settembre', () => {
    // Prima spariva dal denominatore (nessun esito dentro il mese) e il rate
    // sembrava più alto del vero: 1/1 invece di 1/2.
    const set = closingStats(coorte, SET_START, SET_END);
    assert.equal(set.presenze, 2);
    assert.equal(set.chiusi, 1);
    assert.equal(set.closingPct, 50);

    // Una presenza senza alcun esito corrente pesa nel denominatore come "in
    // lavorazione": va mostrata accanto al rate, non nascosta.
    const soloAperta = closingStats(
        [{ ...coorte[7], outcome: '' }],
        SET_START, SET_END,
    );
    assert.equal(soloAperta.presenze, 1);
    assert.equal(soloAperta.inLavorazione, 1);
    assert.equal(soloAperta.closingPct, 0);
});

test('closingStats: la firma di settembre su una presenza di agosto sta nel fatturato di settembre, non nel denominatore', () => {
    // Volutamente asimmetrico: i soldi seguono il mese della firma (target,
    // bonus, riconciliazione), il closing rate segue il mese della presenza.
    const set = closingStats(coorte, SET_START, SET_END);
    assert.equal(set.fatturato, 8000);      // 5000 (AGO_CHIUSO_SET) + 3000 (SET_CHIUSO)
    assert.equal(set.ticketMedio, 4000);
    assert.equal(set.topProduct, 'gold');
    assert.equal(set.presenze, 2);          // AGO_CHIUSO_SET NON è del mese

    const ago = closingStats(coorte, AGO_START, AGO_END);
    assert.equal(ago.fatturato, 0);         // ad agosto non è stato firmato nulla
    assert.equal(ago.chiusi, 1);            // ma la presenza di agosto risulta chiusa
    assert.equal(ago.closingPct, 50);
});

test('monthlyTrend eredita la coorte: settembre 50%, agosto 50%', () => {
    const t = monthlyTrend(coorte, ['2026-08', '2026-09']);
    assert.equal(t[0].closingPct, 50);
    assert.equal(t[1].closingPct, 50);
});
