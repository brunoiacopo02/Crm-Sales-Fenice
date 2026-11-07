import test from 'node:test';
import assert from 'node:assert/strict';
import {
    inCoorteVerifica,
    istanteVerifica,
    statoVerifica,
    verificaBlocca,
    motivoDaChiamare,
    type VerificaLead,
} from './verificaBot';

// Lunedì 09/11/2026, ora solare (+01:00).
const CALL = new Date('2026-11-09T16:00:00+01:00');
const d = (iso: string) => new Date(iso);

const lead = (over: Partial<VerificaLead> = {}): VerificaLead => ({
    confirmationsOutcome: 'confermato',
    confirmationsTimestamp: d('2026-11-07T15:00:00+01:00'),
    appointmentDate: CALL,
    botVerificaApptAt: null,
    botVerificaSentAt: null,
    botVerificaEsito: null,
    botVerificaEsitoAt: null,
    botVerificaGestitaAt: null,
    botVerificaSparitoAt: null,
    ...over,
});

const inviata = (over: Partial<VerificaLead> = {}) => lead({
    botVerificaApptAt: CALL,
    botVerificaSentAt: d('2026-11-09T15:00:00+01:00'),
    botVerificaEsito: 'in_attesa',
    ...over,
});

test('coorte: confermato sabato per lunedì sì, lunedì mattina no', () => {
    assert.equal(inCoorteVerifica(lead()), true);
    assert.equal(inCoorteVerifica(lead({ confirmationsTimestamp: d('2026-11-09T09:30:00+01:00') })), false);
});

test('coorte: giorno di Roma, non UTC', () => {
    // 23:30 UTC di domenica = 00:30 di lunedì a Roma: stesso giorno della call.
    assert.equal(inCoorteVerifica(lead({ confirmationsTimestamp: d('2026-11-08T23:30:00Z') })), false);
    assert.equal(inCoorteVerifica(lead({ confirmationsTimestamp: d('2026-11-08T22:30:00Z') })), true);
});

test('coorte: scartato o senza date fuori', () => {
    assert.equal(inCoorteVerifica(lead({ confirmationsOutcome: 'scartato' })), false);
    assert.equal(inCoorteVerifica(lead({ confirmationsTimestamp: null })), false);
});

test('istante: T-60, mai prima delle 8:30, mai dopo T-45', () => {
    assert.deepEqual(istanteVerifica(CALL), d('2026-11-09T15:00:00+01:00'));
    assert.deepEqual(istanteVerifica(d('2026-11-09T09:30:00+01:00')), d('2026-11-09T08:30:00+01:00'));
    assert.deepEqual(istanteVerifica(d('2026-11-09T09:15:00+01:00')), d('2026-11-09T08:30:00+01:00'));
    assert.equal(istanteVerifica(d('2026-11-09T09:00:00+01:00')), null);
    // Ora legale.
    assert.deepEqual(istanteVerifica(d('2026-10-20T16:00:00+02:00')), d('2026-10-20T15:00:00+02:00'));
});

test('stato: prima del messaggio, attesa_messaggio con l\'ora di invio', () => {
    const s = statoVerifica(lead(), d('2026-11-09T12:00:00+01:00'));
    assert.equal(s.stato, 'attesa_messaggio');
    assert.deepEqual(s.dueAt, d('2026-11-09T15:00:00+01:00'));
});

test('stato: call alle 9:00 esclusa', () => {
    assert.equal(statoVerifica(lead({ appointmentDate: d('2026-11-09T09:00:00+01:00') }), d('2026-11-09T08:00:00+01:00')).stato, 'esclusa');
});

test('stato: passato T-45 (+5) senza messaggio = non raggiunto', () => {
    assert.equal(statoVerifica(lead(), d('2026-11-09T15:21:00+01:00')).stato, 'non_raggiunto');
});

test('timeout 30 minuti: in attesa fino alle 15:30, poi da chiamare', () => {
    assert.equal(statoVerifica(inviata(), d('2026-11-09T15:29:59+01:00')).stato, 'in_attesa');
    const s = statoVerifica(inviata(), d('2026-11-09T15:30:00+01:00'));
    assert.equal(s.stato, 'da_chiamare');
    assert.deepEqual(s.dueAt, d('2026-11-09T15:30:00+01:00'));
});

test('confermato col bot: niente avviso', () => {
    const l = inviata({ botVerificaEsito: 'confermato', botVerificaEsitoAt: d('2026-11-09T15:05:00+01:00') });
    assert.equal(statoVerifica(l, d('2026-11-09T15:40:00+01:00')).stato, 'confermato');
    assert.equal(verificaBlocca(l, d('2026-11-09T15:40:00+01:00')), null);
});

test('risposta senza conferma: da chiamare allo scadere dei 30 minuti', () => {
    const l = inviata({ botVerificaEsito: 'risposta', botVerificaEsitoAt: d('2026-11-09T15:05:00+01:00') });
    assert.equal(statoVerifica(l, d('2026-11-09T15:10:00+01:00')).stato, 'in_attesa');
    assert.equal(statoVerifica(l, d('2026-11-09T15:31:00+01:00')).stato, 'da_chiamare');
});

test('non conferma: da chiamare subito', () => {
    const l = inviata({ botVerificaEsito: 'non_conferma', botVerificaEsitoAt: d('2026-11-09T15:05:00+01:00') });
    const s = statoVerifica(l, d('2026-11-09T15:06:00+01:00'));
    assert.equal(s.stato, 'da_chiamare');
    assert.deepEqual(verificaBlocca(l, d('2026-11-09T15:06:00+01:00')), d('2026-11-09T15:05:00+01:00'));
});

test('gestita dopo la scadenza: spenta; una non conferma dopo la riaccende', () => {
    const g = inviata({ botVerificaGestitaAt: d('2026-11-09T15:35:00+01:00') });
    assert.equal(statoVerifica(g, d('2026-11-09T15:40:00+01:00')).stato, 'gestita');
    const poi = inviata({
        botVerificaGestitaAt: d('2026-11-09T15:35:00+01:00'),
        botVerificaEsito: 'non_conferma',
        botVerificaEsitoAt: d('2026-11-09T15:38:00+01:00'),
    });
    assert.equal(statoVerifica(poi, d('2026-11-09T15:40:00+01:00')).stato, 'da_chiamare');
});

test('una "gestita" vecchia (prima della scadenza) non spegne l\'avviso', () => {
    const l = inviata({ botVerificaGestitaAt: d('2026-11-09T15:10:00+01:00') });
    assert.equal(statoVerifica(l, d('2026-11-09T15:31:00+01:00')).stato, 'da_chiamare');
});

test('sparito vince su tutto', () => {
    const l = inviata({ botVerificaSparitoAt: d('2026-11-09T15:40:00+01:00') });
    assert.equal(statoVerifica(l, d('2026-11-09T15:41:00+01:00')).stato, 'sparito');
    assert.equal(verificaBlocca(l, d('2026-11-09T15:41:00+01:00')), null);
});

test('call spostata: la verifica vecchia non vale più', () => {
    const l = inviata({ appointmentDate: d('2026-11-10T16:00:00+01:00') });
    assert.equal(statoVerifica(l, d('2026-11-09T15:40:00+01:00')).stato, 'attesa_messaggio');
});

test('avviso: si spegne 10 minuti dopo l\'inizio della call', () => {
    assert.ok(verificaBlocca(inviata(), d('2026-11-09T16:09:00+01:00')));
    assert.equal(verificaBlocca(inviata(), d('2026-11-09T16:11:00+01:00')), null);
});

test('motivo leggibile', () => {
    assert.match(motivoDaChiamare(null), /Nessuna risposta/);
    assert.match(motivoDaChiamare('non_conferma'), /non può/);
    assert.match(motivoDaChiamare('risposta'), /senza confermare/);
});
