import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentMoveStamp, confermeBoardColumn, contaPrimeChiamate, fasciaPrimaChiamata, DOMANI_ORE_MATTINA, DOMANI_ORE_POMERIGGIO, nextWorkDayRome, previousWorkDayRome, primaChiamataIlGiornoPrima, OGGI_ORE, DOMANI_ORE, type BoardLeadInput } from './boardWindow';

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
    assert.deepEqual([...DOMANI_ORE], [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
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

// PO 07/11/2026: il pomeriggio come la mattina.
test('pomeriggio di domani fissato con anticipo: 1ª chiamata oggi', () => {
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-27T15:00:00+01:00') }), LUN_11), 'domani');
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-27T21:00:00+01:00') }), LUN_11), 'domani');
});

test('pomeriggio di domani fissato oggi: tutte e 3 domani', () => {
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-10-27T16:00:00+01:00'),
        appointmentCreatedAt: roma('2026-10-26T10:30:00+01:00'),
    }), LUN_11), null);
});

test('domani alle 22 non sta in nessuna colonna', () => {
    assert.equal(confermeBoardColumn(lead({ appointmentDate: roma('2026-10-27T22:00:00+01:00') }), LUN_11), null);
});

test('esempio PO: preso lunedì per mercoledì 16, martedì 1ª chiamata, mercoledì le altre', () => {
    const MAR_15 = new Date('2026-11-10T14:00:00Z'); // martedì 10/11 15:00 Roma
    const MER_14 = new Date('2026-11-11T13:00:00Z'); // mercoledì 11/11 14:00 Roma
    const l = lead({
        appointmentDate: roma('2026-11-11T16:00:00+01:00'),
        appointmentCreatedAt: roma('2026-11-09T18:00:00+01:00'), // lunedì
    });
    assert.equal(confermeBoardColumn(l, MAR_15), 'domani');
    // 1ª chiamata fatta martedì: sparisce da Domani...
    const dopoCall1 = { ...l, confCall1At: roma('2026-11-10T15:10:00+01:00') };
    assert.equal(confermeBoardColumn(dopoCall1, MAR_15), null);
    // ...e torna mercoledì in Oggi per la 2ª e la 3ª.
    assert.equal(confermeBoardColumn(dopoCall1, MER_14), 'oggi');
});

test('esempio PO: preso martedì per mercoledì 16, tutte e 3 mercoledì', () => {
    const MAR_15 = new Date('2026-11-10T14:00:00Z');
    const l = lead({
        appointmentDate: roma('2026-11-11T16:00:00+01:00'),
        appointmentCreatedAt: roma('2026-11-10T11:00:00+01:00'), // martedì = giorno prima
    });
    assert.equal(confermeBoardColumn(l, MAR_15), null);
    assert.equal(primaChiamataIlGiornoPrima(l.appointmentDate!, [l.appointmentCreatedAt]), false);
});

test('preso lo stesso giorno della call: niente giorno prima', () => {
    assert.equal(primaChiamataIlGiornoPrima(roma('2026-11-11T17:00:00+01:00'), [roma('2026-11-11T09:30:00+01:00')]), false);
});

test('sabato 07/11: lunedì pomeriggio preso entro venerdì si chiama oggi, preso sabato no', () => {
    const SAB_07 = new Date('2026-11-07T13:00:00Z'); // sabato 14:00 Roma
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-11-09T16:00:00+01:00'),
        appointmentCreatedAt: roma('2026-11-06T19:00:00+01:00'), // venerdì sera
    }), SAB_07), 'domani');
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-11-09T16:00:00+01:00'),
        appointmentCreatedAt: roma('2026-11-07T10:00:00+01:00'), // sabato
    }), SAB_07), null);
});

test('domenica: il giorno prima del lunedì è il sabato, presa di domenica = giorno prima', () => {
    assert.equal(previousWorkDayRome('2026-11-09'), '2026-11-07'); // lunedì → sabato
    assert.equal(previousWorkDayRome('2026-11-10'), '2026-11-09'); // martedì → lunedì
    // Preso domenica per lunedì: il sabato era già passato, tutte e 3 lunedì.
    assert.equal(primaChiamataIlGiornoPrima(roma('2026-11-09T16:00:00+01:00'), [roma('2026-11-08T12:00:00+01:00')]), false);
    // Preso domenica per martedì: 1ª chiamata lunedì.
    assert.equal(primaChiamataIlGiornoPrima(roma('2026-11-10T16:00:00+01:00'), [roma('2026-11-08T12:00:00+01:00')]), true);
    // Preso sabato per lunedì: il sabato è il giorno prima, tutte e 3 lunedì.
    assert.equal(primaChiamataIlGiornoPrima(roma('2026-11-09T16:00:00+01:00'), [roma('2026-11-07T12:00:00+01:00')]), false);
    // Se la board si apre di domenica, "domani" è lunedì e il sabato conta come giorno prima.
    const DOM_08 = new Date('2026-11-08T11:00:00Z');
    assert.equal(confermeBoardColumn(lead({
        appointmentDate: roma('2026-11-09T16:00:00+01:00'),
        appointmentCreatedAt: roma('2026-11-07T12:00:00+01:00'),
    }), DOM_08), null);
});

test('spostamento: conta la più recente fra presa e spostamento', () => {
    const app = roma('2026-11-11T16:00:00+01:00');
    // Preso il 02/11, spostato martedì 10 a mercoledì: misura dallo spostamento.
    assert.equal(primaChiamataIlGiornoPrima(app, [roma('2026-11-02T12:00:00+01:00'), roma('2026-11-10T12:00:00+01:00')]), false);
    // Spostato lunedì 09: anticipo pieno.
    assert.equal(primaChiamataIlGiornoPrima(app, [roma('2026-11-02T12:00:00+01:00'), roma('2026-11-09T12:00:00+01:00')]), true);
});

test('a mezzanotte di Roma la presa conta nel giorno di Roma, non UTC', () => {
    // 23:30 UTC di lunedì 09 = 00:30 di martedì 10 a Roma: è il giorno prima della call di mercoledì.
    assert.equal(primaChiamataIlGiornoPrima(roma('2026-11-11T16:00:00+01:00'), [new Date('2026-11-09T23:30:00Z')]), false);
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

test('Domani · 1ª chiamata: due gruppi, il pomeriggio dalle 15', () => {
    assert.deepEqual([...DOMANI_ORE_MATTINA], [9, 10, 11, 12, 13, 14]);
    assert.deepEqual([...DOMANI_ORE_POMERIGGIO], [15, 16, 17, 18, 19, 20, 21]);
    assert.equal(fasciaPrimaChiamata(roma('2026-11-09T14:59:00+01:00')), 'mattina');
    assert.equal(fasciaPrimaChiamata(roma('2026-11-09T15:00:00+01:00')), 'pomeriggio');
    assert.deepEqual(contaPrimeChiamate([
        roma('2026-11-09T09:00:00+01:00'),
        roma('2026-11-09T11:00:00+01:00'),
        roma('2026-11-09T16:00:00+01:00'),
        null,
    ]), { mattina: 2, pomeriggio: 1 });
});

test('1ª chiamata del giorno prima non fatta: il giorno della call sta in Oggi con 0 chiamate', () => {
    const SAB_14 = new Date('2026-11-07T13:00:00Z'); // sabato 07/11 14:00 Roma
    const LUN_09 = new Date('2026-11-09T08:00:00Z'); // lunedì 09/11 09:00 Roma
    const LUN_20 = new Date('2026-11-09T19:00:00Z'); // lunedì 09/11 20:00 Roma
    for (const ora of ['09', '10', '16', '21']) {
        const l = lead({
            appointmentDate: roma(`2026-11-09T${ora}:00:00+01:00`),
            appointmentCreatedAt: roma('2026-11-05T12:00:00+01:00'), // giovedì
        });
        // Sabato era in "Domani · 1ª chiamata"...
        assert.equal(confermeBoardColumn(l, SAB_14), 'domani', `sabato, call alle ${ora}`);
        // ...nessuno l'ha chiamato: lunedì è in Oggi come gli altri, per tutta la giornata.
        assert.equal(confermeBoardColumn(l, LUN_09), 'oggi', `lunedì 9, call alle ${ora}`);
        assert.equal(confermeBoardColumn(l, LUN_20), 'oggi', `lunedì 20, call alle ${ora}`);
    }
});
