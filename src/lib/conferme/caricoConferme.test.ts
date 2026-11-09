import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BF_FUNNEL, NESSUNA_CONFERME, SENZA_FUNNEL, calcolaCarico, caricoDelGiorno, chiaveFunnel, fasciaDi, finestraDaLeggere,
    prossimiGiorniLavorativi, vociDelGiorno, type LeadCarico,
} from './caricoConferme';

const roma = (iso: string) => new Date(iso); // ISO con offset esplicito
// Lunedì 9/11/2026 alle 16:00 di Roma (ora solare, +01:00).
const LUN_9 = roma('2026-11-09T16:00:00+01:00');

let n = 0;
function lead(over: Partial<LeadCarico>): LeadCarico {
    return {
        id: `l${++n}`,
        funnel: 'Telegram',
        appointmentDate: null,
        appointmentCreatedAt: roma('2026-11-07T12:00:00+01:00'),
        appointmentMovedAt: null,
        confirmationsOutcome: null,
        confNeedsReschedule: false,
        recallDate: null,
        confSnoozeAt: null,
        venditore: null,
        conferme: null,
        ...over,
    };
}

test('giorni lavorativi: domani e dopodomani, la domenica si salta', () => {
    assert.deepEqual(prossimiGiorniLavorativi(LUN_9), ['2026-11-10', '2026-11-11']);
    // venerdì 13 → sabato 14 e lunedì 16
    assert.deepEqual(prossimiGiorniLavorativi(roma('2026-11-13T18:00:00+01:00')), ['2026-11-14', '2026-11-16']);
    // sabato 14 → lunedì 16 e martedì 17
    assert.deepEqual(prossimiGiorniLavorativi(roma('2026-11-14T18:00:00+01:00')), ['2026-11-16', '2026-11-17']);
    // da leggere: dal giorno dopo a quello dopo l'ultimo mostrato (per la 1ª chiamata)
    assert.deepEqual(finestraDaLeggere(LUN_9), { dal: '2026-11-10', al: '2026-11-12' });
});

test('mattina prima delle 15, pomeriggio dalle 15', () => {
    assert.equal(fasciaDi(roma('2026-11-10T14:59:00+01:00')), 'mattina');
    assert.equal(fasciaDi(roma('2026-11-10T15:00:00+01:00')), 'pomeriggio');
    assert.equal(fasciaDi(roma('2026-11-10T09:00:00+01:00')), 'mattina');
});

test('le call del giorno: per fascia e per esito', () => {
    const rows = [
        lead({ appointmentDate: roma('2026-11-10T10:00:00+01:00') }),
        lead({ appointmentDate: roma('2026-11-10T11:00:00+01:00'), confirmationsOutcome: 'confermato', conferme: 'Lavinia', venditore: 'Bruno' }),
        lead({ appointmentDate: roma('2026-11-10T16:00:00+01:00'), confirmationsOutcome: 'scartato', conferme: 'Noemi' }),
        lead({ appointmentDate: roma('2026-11-10T17:00:00+01:00') }),
        lead({ appointmentDate: roma('2026-11-10T22:00:00+01:00') }), // fuori dalla board
    ];
    const g = caricoDelGiorno(rows, '2026-11-10');
    assert.deepEqual(
        { t: g.call.totale, m: g.call.mattina, p: g.call.pomeriggio, c: g.call.confermati, s: g.call.scartati, f: g.call.daFare },
        { t: 5, m: 2, p: 3, c: 1, s: 1, f: 3 },
    );
    assert.equal(g.callFuoriBoard, 1);
    // nel lavoro del giorno stesso la call delle 22 non c'è: la board va dalle 9 alle 21
    assert.equal(g.lavoro.giorno_stesso.totale, 4);
    assert.equal(g.lavoro.giorno_stesso.daFare, 2);
    assert.equal(g.lavoro.giorno_stesso.daFareMattina, 1);
    assert.equal(g.lavoro.giorno_stesso.daFarePomeriggio, 1);
    const perConf = Object.fromEntries(g.perConferme.map(r => [r.nome, r.totale]));
    assert.deepEqual(perConf, { [NESSUNA_CONFERME]: 2, Lavinia: 1, Noemi: 1 });
    assert.equal(g.perVenditore.find(r => r.nome === 'Bruno')?.confermati, 1);
});

test('1ª chiamata il giorno prima: le call del giorno lavorativo dopo, fissate prima', () => {
    const rows = [
        // mercoledì 11 mattina e pomeriggio, fissate sabato 7: 1ª chiamata martedì 10
        lead({ appointmentDate: roma('2026-11-11T10:00:00+01:00') }),
        lead({ appointmentDate: roma('2026-11-11T16:00:00+01:00') }),
        // mercoledì 11 fissata martedì 10 stesso (giorno prima): niente 1ª chiamata martedì
        lead({ appointmentDate: roma('2026-11-11T16:00:00+01:00'), appointmentCreatedAt: roma('2026-11-10T09:00:00+01:00') }),
        // ...salvo le 9, sempre il giorno prima
        lead({ appointmentDate: roma('2026-11-11T09:00:00+01:00'), appointmentCreatedAt: roma('2026-11-10T09:00:00+01:00') }),
        // giovedì 12: non è il giorno dopo martedì
        lead({ appointmentDate: roma('2026-11-12T10:00:00+01:00') }),
    ];
    const g = caricoDelGiorno(rows, '2026-11-10');
    assert.equal(g.lavoro.prima_chiamata.totale, 3);
    assert.equal(g.lavoro.prima_chiamata.mattina, 2);
    assert.equal(g.lavoro.prima_chiamata.pomeriggio, 1);
    assert.equal(g.call.totale, 0);
    // le stesse call sono anche il lavoro del giorno stesso di mercoledì
    assert.equal(caricoDelGiorno(rows, '2026-11-11').lavoro.giorno_stesso.totale, 4);
});

test('il lunedì: le call prendono la 1ª chiamata il sabato, la domenica non si lavora', () => {
    const rows = [
        lead({ appointmentDate: roma('2026-11-16T11:00:00+01:00'), appointmentCreatedAt: roma('2026-11-12T12:00:00+01:00') }),
        lead({ appointmentDate: roma('2026-11-15T11:00:00+01:00') }), // domenica
    ];
    const venerdi = roma('2026-11-13T18:00:00+01:00');
    const c = calcolaCarico(rows, venerdi);
    assert.deepEqual(c.giorni.map(g => g.giorno), ['2026-11-14', '2026-11-16']);
    const sabato = c.giorni[0];
    assert.equal(sabato.giornoDopo, '2026-11-16');
    assert.equal(sabato.lavoro.prima_chiamata.totale, 1);
    assert.equal(c.giorni[1].lavoro.giorno_stesso.totale, 1);
    // la call di domenica non è in nessuna giornata delle Conferme, ma si vede
    assert.equal(c.callDomenica, 1);
    assert.equal(c.giorni.reduce((s, g) => s + g.totaleLavoro.totale, 0), 2);
});

test('richiami: parcheggiati per recallDate, a orario per confSnoozeAt, senza doppioni', () => {
    const giaInLista = lead({ appointmentDate: roma('2026-11-10T16:00:00+01:00'), confSnoozeAt: roma('2026-11-10T18:00:00+01:00') });
    const rows = [
        lead({ confNeedsReschedule: true, recallDate: roma('2026-11-10T16:30:00+01:00') }),
        lead({ confNeedsReschedule: true, recallDate: roma('2026-11-11T10:00:00+01:00') }),
        lead({ appointmentDate: roma('2026-11-13T16:00:00+01:00'), confSnoozeAt: roma('2026-11-10T11:00:00+01:00') }),
        giaInLista,
        // già esitato: niente richiamo
        lead({ appointmentDate: roma('2026-11-13T16:00:00+01:00'), confSnoozeAt: roma('2026-11-10T12:00:00+01:00'), confirmationsOutcome: 'confermato' }),
    ];
    const g = caricoDelGiorno(rows, '2026-11-10');
    assert.equal(g.lavoro.richiamo.totale, 2);
    assert.equal(g.lavoro.richiamo.mattina, 1);
    assert.equal(g.lavoro.richiamo.pomeriggio, 1);
    assert.equal(g.lavoro.giorno_stesso.totale, 1);
    assert.equal(vociDelGiorno(rows, '2026-11-10').filter(v => v.lead.id === giaInLista.id).length, 1);
    // un parcheggiato non ha data di call: non entra fra le call
    assert.equal(g.call.totale, 1);
});

test('per funnel: maiuscole unite, BF segnato, senza funnel a parte', () => {
    assert.deepEqual(chiaveFunnel('Black Friday'), { id: BF_FUNNEL, nome: 'Black Friday', bf: true });
    assert.equal(chiaveFunnel(null).nome, SENZA_FUNNEL);
    const rows = [
        lead({ funnel: 'BLACK FRIDAY', appointmentDate: roma('2026-11-10T10:00:00+01:00') }),
        lead({ funnel: 'BLACK FRIDAY', appointmentDate: roma('2026-11-10T15:00:00+01:00') }),
        lead({ funnel: 'telegram', appointmentDate: roma('2026-11-10T16:00:00+01:00') }),
    ];
    const g = caricoDelGiorno(rows, '2026-11-10');
    assert.equal(g.perFunnel[0].nome, 'BLACK FRIDAY');
    assert.equal(g.perFunnel[0].bf, true);
    assert.equal(g.perFunnel[0].totale, 2);
    // le righe per funnel tornano sul totale
    assert.equal(g.perFunnel.reduce((s, r) => s + r.totale, 0), g.totaleLavoro.totale);
});
