import test from 'node:test';
import assert from 'node:assert/strict';
import {
    selectBlockingAlert,
    CLAIM_TTL_MS,
    SNOOZE_MS,
    STALE_CUTOFF_DAYS,
    type AlertCandidate,
} from './blockingAlert';

const NOW = new Date('2026-08-31T10:00:00Z');
const ME = 'user-me';
const ALTRA = 'user-altra';

const minutiFa = (m: number) => new Date(NOW.getTime() - m * 60_000);
const minutiTra = (m: number) => new Date(NOW.getTime() + m * 60_000);

function candidate(over: Partial<AlertCandidate> & { id: string }): AlertCandidate {
    return {
        name: 'Mario Rossi',
        phone: '3331112222',
        companyId: 'fenice',
        kind: 'snooze',
        dueAt: minutiFa(5),
        notes: null,
        alertSnoozedUntil: null,
        claimedById: null,
        claimedAt: null,
        handledAt: null,
        ...over,
    };
}

const select = (rows: AlertCandidate[], userId = ME) =>
    selectBlockingAlert(rows, { now: NOW, userId });

test('nessun candidato → nessun avviso', () => {
    const res = select([]);
    assert.equal(res.alert, null);
    assert.equal(res.queueTotal, 0);
    assert.equal(res.nextWakeAt, null);
});

test('due richiami scaduti → vince il più vecchio, la coda ne conta due', () => {
    const res = select([
        candidate({ id: 'recente', dueAt: minutiFa(2) }),
        candidate({ id: 'vecchio', dueAt: minutiFa(40) }),
    ]);
    assert.equal(res.alert?.id, 'vecchio');
    assert.equal(res.queueTotal, 2);
});

test('richiamo già gestito (scheda aperta) → escluso per tutti', () => {
    const res = select([candidate({ id: 'gestito', handledAt: minutiFa(1) })]);
    assert.equal(res.alert, null);
    assert.equal(res.queueTotal, 0);
});

test('richiamo parcheggiato scaduto (badge blu) → avvisa come lo snooze', () => {
    const res = select([candidate({ id: 'parcheggiato', kind: 'parcheggiato', dueAt: minutiFa(3) })]);
    assert.equal(res.alert?.id, 'parcheggiato');
    assert.equal(res.alert?.kind, 'parcheggiato');
});

test('scheda aperta PRIMA della scadenza → il richiamo suona lo stesso', () => {
    // Il caso dei parcheggiati: la scheda viene aperta il giorno in cui si
    // programma il richiamo, giorni prima che scada.
    const res = select([candidate({
        id: 'aperto-ieri',
        kind: 'parcheggiato',
        dueAt: minutiFa(2),
        handledAt: minutiFa(600),
    })]);
    assert.equal(res.alert?.id, 'aperto-ieri');
});

test(`richiamo scaduto da più di ${STALE_CUTOFF_DAYS} giorni → archeologia, escluso`, () => {
    const vecchissimo = new Date(NOW.getTime() - (STALE_CUTOFF_DAYS + 1) * 86_400_000);
    const res = select([candidate({ id: 'aprile', dueAt: vecchissimo })]);
    assert.equal(res.alert, null);
});

test('snooze globale in corso → nessun avviso, e la sveglia è a fine snooze', () => {
    const fineSnooze = minutiTra(1);
    const res = select([candidate({ id: 'snoozato', alertSnoozedUntil: fineSnooze })]);
    assert.equal(res.alert, null);
    assert.equal(res.nextWakeAt?.getTime(), fineSnooze.getTime());
});

test('snooze scaduto → il richiamo torna a tutti', () => {
    const res = select([candidate({ id: 'tornato', alertSnoozedUntil: minutiFa(1) })]);
    assert.equal(res.alert?.id, 'tornato');
});

test('claim di un altro operatore ancora valido → io non lo vedo', () => {
    const rows = [candidate({ id: 'suo', claimedById: ALTRA, claimedAt: minutiFa(3) })];
    assert.equal(select(rows).alert, null);
});

test('claim di un altro operatore ancora valido → lui invece lo vede', () => {
    const rows = [candidate({ id: 'suo', claimedById: ALTRA, claimedAt: minutiFa(3) })];
    assert.equal(select(rows, ALTRA).alert?.id, 'suo');
});

test('claim scaduto dopo 10 minuti → il richiamo torna a tutti', () => {
    const scaduto = new Date(NOW.getTime() - CLAIM_TTL_MS - 1_000);
    const rows = [candidate({ id: 'abbandonato', claimedById: ALTRA, claimedAt: scaduto })];
    assert.equal(select(rows).alert?.id, 'abbandonato');
});

test('claim mio → lo vedo io e resta nella mia coda', () => {
    const rows = [candidate({ id: 'mio', claimedById: ME, claimedAt: minutiFa(2) })];
    const res = select(rows);
    assert.equal(res.alert?.id, 'mio');
    assert.equal(res.queueTotal, 1);
});

test('la sveglia è il primo istante utile tra fine snooze e scadenza claim', () => {
    const fineSnooze = minutiTra(9);
    const claimAt = minutiFa(6); // scade tra 4 minuti
    const res = select([
        candidate({ id: 'a', dueAt: minutiFa(30), alertSnoozedUntil: fineSnooze }),
        candidate({ id: 'b', dueAt: minutiFa(20), claimedById: ALTRA, claimedAt: claimAt }),
    ]);
    assert.equal(res.alert, null);
    assert.equal(res.nextWakeAt?.getTime(), claimAt.getTime() + CLAIM_TTL_MS);
});

test('un avviso già visibile non ha bisogno di sveglie future', () => {
    const res = select([candidate({ id: 'visibile' })]);
    assert.equal(res.alert?.id, 'visibile');
    assert.equal(res.nextWakeAt, null);
});

test('lo snooze dura due minuti', () => {
    assert.equal(SNOOZE_MS, 2 * 60_000);
});
