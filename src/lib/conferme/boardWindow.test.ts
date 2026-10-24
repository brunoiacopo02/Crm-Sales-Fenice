import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentMoveStamp, confermeBoardColumn, nextWorkDayRome, OGGI_ORE, DOMANI_ORE, type BoardLeadInput } from './boardWindow';

// Lunedì 26/10/2026 alle 11:00 di Roma (ora solare, +01:00).
const LUN_11 = new Date('2026-10-26T10:00:00Z');
const SAB_24 = new Date('2026-10-24T09:00:00Z'); // sabato 24/10 11:00 (ancora +02:00)

const roma = (iso: string) => new Date(iso); // ISO con offset esplicito

function lead(over: Partial<BoardLeadInput>): BoardLeadInput {
    return {
        appointmentDate: null,
        appointmentCreatedAt: roma('2026-10-24T12:00:00+02:00'), // sabato
        appointmentMovedAt: null,
        confCall1At: null,
        confCall2At: null,
        confCall3At: null,
        ...over,
    };
}

test('le ore delle due colonne', () => {
    assert.deepEqual([...OGGI_ORE], [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    assert.deepEqual([...DOMANI_ORE], [9, 10, 11, 12, 13, 14]);
});

test('mattina di domani fissata con anticipo: si chiama oggi', () => {
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-27T10:00:00+01:00') }), LUN_11), 'domani');
});

test('mattina di domani fissata oggi: oggi non si vede', () => {
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-27T10:00:00+01:00'),
        appointmentCreatedAt: roma('2026-10-26T08:00:00+01:00'),
    }), LUN_11), null);
});

test('le 9 di domani si chiamano oggi anche se fissate oggi', () => {
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-27T09:00:00+01:00'),
        appointmentCreatedAt: roma('2026-10-26T08:00:00+01:00'),
    }), LUN_11), 'domani');
});

test('spostata oggi a domani mattina: conta come fissata oggi', () => {
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-27T10:00:00+01:00'),
        appointmentMovedAt: roma('2026-10-26T09:15:00+01:00'),
    }), LUN_11), null);
});

test('NR messo oggi: sparisce da Domani mattina', () => {
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-27T10:00:00+01:00'),
        confCall1At: roma('2026-10-26T09:30:00+01:00'),
    }), LUN_11), null);
});

test('NR di un giorno precedente non lo nasconde', () => {
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-27T10:00:00+01:00'),
        confCall1At: roma('2026-10-23T16:00:00+02:00'),
    }), LUN_11), 'domani');
});

test('lead vecchio senza date di fissaggio: si tratta come fissato con anticipo', () => {
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-27T10:00:00+01:00'),
        appointmentCreatedAt: null,
    }), LUN_11), 'domani');
});

test('il pomeriggio di domani non si chiama il giorno prima', () => {
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-27T15:00:00+01:00') }), LUN_11), null);
});

test('oggi dalle 9 alle 21', () => {
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-26T09:00:00+01:00') }), LUN_11), 'oggi');
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-26T21:00:00+01:00') }), LUN_11), 'oggi');
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-26T22:00:00+01:00') }), LUN_11), null);
});

test('dopodomani mattina non si vede', () => {
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-28T10:00:00+01:00') }), LUN_11), null);
});

test('senza data non sta in nessuna colonna', () => {
    assert.equal(confermeBoardColumn(lead({}), LUN_11), null);
});

test('il sabato "domani" è il lunedì', () => {
    assert.equal(nextWorkDayRome(SAB_24), '2026-10-26');
    assert.equal(nextWorkDayRome(LUN_11), '2026-10-27');
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-26T10:00:00+01:00'),
        appointmentCreatedAt: roma('2026-10-23T17:00:00+02:00'), // venerdì
    }), SAB_24), 'domani');
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-26T10:00:00+01:00'),
        appointmentCreatedAt: roma('2026-10-24T08:00:00+02:00'), // sabato stesso
    }), SAB_24), null);
});

test('a mezzanotte e mezza di Roma oggi è già il giorno nuovo', () => {
    const MAR_0030 = new Date('2026-10-26T23:30:00Z'); // 00:30 di martedì 27 a Roma
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-27T10:00:00+01:00') }), MAR_0030), 'oggi');
});

// Review finale: un lead parcheggiato (data azzerata) che riceve una data nuova è uno
// spostamento, anche se la data vecchia è null.
test('timbro di spostamento: data nuova diversa dalla vecchia, anche da null', () => {
    const ora = new Date('2026-10-26T15:00:00Z');
    const mar10 = new Date('2026-10-27T09:00:00Z');
    assert.deepEqual(appointmentMoveStamp(new Date('2026-10-29T09:00:00Z'), mar10, ora), { appointmentMovedAt: ora });
    assert.deepEqual(appointmentMoveStamp(null, mar10, ora), { appointmentMovedAt: ora });
    assert.deepEqual(appointmentMoveStamp(mar10, new Date(mar10), ora), {});
    assert.deepEqual(appointmentMoveStamp(mar10, null, ora), {});
});
