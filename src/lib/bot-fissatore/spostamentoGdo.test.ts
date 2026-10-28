import test from 'node:test';
import assert from 'node:assert/strict';
import {
    checkDataSpostamento, checkLeadSpostabile, giorniSpostamento, notaSpostamento, type SpostamentoLead,
} from './spostamentoGdo';

// mer 28/10/2026 15:00 Roma (CET dal 25/10, UTC+1)
const MER_15 = new Date('2026-10-28T14:00:00Z');
const CALL_GIO_18 = new Date('2026-10-29T17:00:00Z');

const lead = (p: Partial<SpostamentoLead> = {}): SpostamentoLead => ({
    status: 'APPOINTMENT',
    assigneeIsBot: false,
    appointmentDate: CALL_GIO_18,
    confirmationsOutcome: null,
    confNeedsReschedule: false,
    salespersonUserId: null,
    salespersonAssigned: null,
    salespersonOutcome: null,
    presentedAt: null,
    ...p,
});

test('giorni: i prossimi 3 lavorativi, la domenica salta', () => {
    assert.deepEqual(giorniSpostamento(MER_15), ['2026-10-29', '2026-10-30', '2026-10-31']);
    const ven = new Date('2026-10-30T10:00:00Z');
    assert.deepEqual(giorniSpostamento(ven), ['2026-10-31', '2026-11-02', '2026-11-03']);
});

test('lead GDO appuntato e non lavorato: si sposta', () => {
    assert.deepEqual(checkLeadSpostabile(lead(), false, MER_15), { ok: true });
});

test('lead: tutti i rifiuti', () => {
    const casi: [Partial<SpostamentoLead>, boolean, string][] = [
        [{ assigneeIsBot: true }, false, 'lead_del_bot'],
        [{ status: 'IN_PROGRESS' }, false, 'senza_appuntamento'],
        [{ appointmentDate: null }, false, 'senza_appuntamento'],
        [{ appointmentDate: new Date('2026-10-28T10:00:00Z') }, false, 'call_passata'],
        [{ presentedAt: new Date() }, false, 'gia_presentato'],
        [{ salespersonOutcome: 'Chiuso' }, false, 'gia_presentato'],
        [{ confirmationsOutcome: 'confermato' }, false, 'confermato'],
        [{ salespersonUserId: 'u1' }, false, 'confermato'],
        [{ confirmationsOutcome: 'scartato' }, false, 'scartato'],
        [{ confirmationsOutcome: 'autofissato' }, false, 'esito_conferme'],
        [{ confNeedsReschedule: true }, false, 'parcheggiato'],
        [{}, true, 'gia_spostato'],
    ];
    for (const [p, gia, motivo] of casi) {
        assert.deepEqual(checkLeadSpostabile(lead(p), gia, MER_15), { ok: false, motivo }, motivo);
    }
});

test('data: dentro finestra e fascia', () => {
    assert.deepEqual(checkDataSpostamento(new Date('2026-10-30T17:00:00+01:00'), CALL_GIO_18, MER_15), { ok: true });
    assert.deepEqual(checkDataSpostamento(new Date('2026-10-31T10:00:00+01:00'), CALL_GIO_18, MER_15), { ok: true });
    // le 9 e le 21 in punto passano (le 9 sono l'emergenza, la decide il bot)
    assert.deepEqual(checkDataSpostamento(new Date('2026-10-29T09:00:00+01:00'), CALL_GIO_18, MER_15), { ok: true });
    assert.deepEqual(checkDataSpostamento(new Date('2026-10-29T21:00:00+01:00'), CALL_GIO_18, MER_15), { ok: true });
});

test('data: rifiuti', () => {
    const casi: [string, string][] = [
        ['2026-10-28T13:00:00+01:00', 'data_passata'],
        ['2026-10-29T18:00:00+01:00', 'stessa_data'],
        ['2026-11-01T11:00:00+01:00', 'domenica'],
        ['2026-11-02T11:00:00+01:00', 'fuori_finestra'],
        ['2026-10-28T19:00:00+01:00', 'fuori_finestra'], // oggi
        ['2026-10-29T08:30:00+01:00', 'fuori_fascia'],
        ['2026-10-29T21:30:00+01:00', 'fuori_fascia'],
    ];
    for (const [iso, motivo] of casi) {
        assert.deepEqual(checkDataSpostamento(new Date(iso), CALL_GIO_18, MER_15), { ok: false, motivo }, iso);
    }
});

test('data: si legge in ora di Roma, non UTC', () => {
    // 20:30 UTC = 21:30 Roma: fuori fascia anche se in UTC sarebbe dentro
    assert.deepEqual(checkDataSpostamento(new Date('2026-10-29T20:30:00Z'), CALL_GIO_18, MER_15), { ok: false, motivo: 'fuori_fascia' });
});

test('nota: da e a in ora di Roma', () => {
    const n = notaSpostamento(CALL_GIO_18, new Date('2026-10-30T17:00:00+01:00'));
    assert.match(n, /^Spostato dal bot: da gio 29\/10 alle 18:00 a ven 30\/10 alle 17:00\./);
});
