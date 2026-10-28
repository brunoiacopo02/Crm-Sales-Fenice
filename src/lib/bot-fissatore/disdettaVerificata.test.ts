import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CALL_PASSATA_MAX_MS,
    DISDETTA_VERIFICATA_REASON,
    buildDisdettaVerificataNote,
    valutaScartoDisdetta,
    type LeadPerScarto,
} from './disdettaVerificata';
import { SELF_BOOKED_OUTCOME } from '@/lib/salesPipeline/sentinel';

const now = new Date('2026-10-28T12:00:00Z');
const base: LeadPerScarto = {
    status: 'APPOINTMENT',
    appointmentDate: new Date('2026-10-29T15:00:00Z'),
    confirmationsOutcome: null,
    confirmationsDiscardReason: null,
    salespersonUserId: null,
    salespersonOutcome: null,
    presentedAt: null,
};

test('lead appuntato, non lavorato, call futura: si scarta', () => {
    assert.deepEqual(valutaScartoDisdetta(base, now), { ok: true });
});

test('call passata da meno di 24h: si scarta ancora', () => {
    const l = { ...base, appointmentDate: new Date(now.getTime() - CALL_PASSATA_MAX_MS + 60_000) };
    assert.deepEqual(valutaScartoDisdetta(l, now), { ok: true });
});

test('ogni guardia blocca lo scarto', () => {
    const casi: [Partial<LeadPerScarto>, string][] = [
        [{ status: 'IN_PROGRESS' }, 'non_appuntato'],
        [{ confirmationsOutcome: SELF_BOOKED_OUTCOME }, 'autofissato'],
        [{ confirmationsOutcome: 'scartato', confirmationsDiscardReason: DISDETTA_VERIFICATA_REASON }, 'gia_scartato_disdetta'],
        [{ confirmationsOutcome: 'scartato', confirmationsDiscardReason: '3 NR consecutivi' }, 'gia_scartato'],
        [{ confirmationsOutcome: 'confermato' }, 'gia_confermato'],
        [{ salespersonUserId: 'u1' }, 'venditore_assegnato'],
        [{ salespersonOutcome: 'Non chiuso' }, 'esito_venditore'],
        [{ presentedAt: new Date() }, 'presentato'],
        [{ appointmentDate: null }, 'senza_data'],
        [{ appointmentDate: new Date(now.getTime() - CALL_PASSATA_MAX_MS - 60_000) }, 'call_passata'],
    ];
    for (const [patch, motivo] of casi) {
        assert.deepEqual(valutaScartoDisdetta({ ...base, ...patch }, now), { ok: false, motivo }, motivo);
    }
});

test('la nota porta categoria, parole del lead e come recuperarlo', () => {
    const n = buildDisdettaVerificataNote({ citazione: 'non mi interessa   più', categoria: 'ripensamento' });
    assert.ok(n.startsWith('DISDETTA VERIFICATA'));
    assert.ok(n.includes('ripensamento'));
    assert.ok(n.includes('"non mi interessa più"'));
    assert.ok(n.includes('Annulla scarto'));
});
