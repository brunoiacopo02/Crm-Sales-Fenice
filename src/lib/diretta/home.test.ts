import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_TARGETS } from './config'
import {
    articoloNumero, durataTesto, fraseRitmo, fraseSquadra, traguardo, statoFinestra, testoTurno,
    statoPausa, pauseDelGiorno, etichettaGiorno, fraseCronaca, ultimiPerLead, leadDistinti,
    binarioPresenze, chiaveSettimana, sommaPerSettimana, distintiPerSettimana, migliorSettimana,
    giornoLavorativoPrecedente, mostraInizioTurno, conPavimento, tipoMomento, oraBreve,
    oraParlata, euro, etichettaSettimana, giornoSettimanaRoma,
} from './home'

// Lunedì 26/10/2026 è il primo giorno di ora solare: Roma = UTC+1.
const LUN = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00+01:00`)

test('articolo davanti ai numeri', () => {
    assert.equal(articoloNumero(8), "l'")
    assert.equal(articoloNumero(11), "l'")
    assert.equal(articoloNumero(1), "l'")
    assert.equal(articoloNumero(80), "l'")
    assert.equal(articoloNumero(10), 'il ')
    assert.equal(articoloNumero(18), 'il ')
    assert.equal(articoloNumero(55), 'il ')
})

test('durate in italiano', () => {
    assert.equal(durataTesto(0), 'meno di un minuto')
    assert.equal(durataTesto(0.2), '1 min')
    assert.equal(durataTesto(45), '45 min')
    assert.equal(durataTesto(60), '1 ora')
    assert.equal(durataTesto(72), '1 ora e 12 min')
    assert.equal(durataTesto(165), '2 ore e 45 min')
    assert.equal(durataTesto(120), '2 ore')
})

test('frase di ritmo sui due scalini', () => {
    assert.equal(fraseRitmo(0, [8, 10]), "Ti mancano 8 per l'8.")
    assert.equal(fraseRitmo(7, [8, 10]), "Ti manca 1 per l'8.")
    assert.equal(fraseRitmo(8, [8, 10]), 'Primo obiettivo preso. Ti mancano 2 per il 10.')
    assert.equal(fraseRitmo(9, [8, 10]), 'Primo obiettivo preso. Ti manca 1 per il 10.')
    assert.equal(fraseRitmo(10, [8, 10]), 'Obiettivo pieno raggiunto.')
    assert.equal(fraseRitmo(12, [8, 10]), 'Obiettivo pieno raggiunto.')
    assert.equal(traguardo(3, [8, 10]), 8)
    assert.equal(traguardo(8, [8, 10]), 10)
})

test('frase di squadra', () => {
    assert.equal(fraseSquadra(37, [55, 65]), 'Ne mancano 18 per il 55.')
    assert.equal(fraseSquadra(54, [55, 65]), 'Ne manca 1 per il 55.')
    assert.equal(fraseSquadra(58, [55, 65]), 'Primo obiettivo di squadra preso. Ne mancano 7 per il 65.')
    assert.equal(fraseSquadra(70, [55, 65]), 'Obiettivo pieno di squadra raggiunto.')
})

test('finestre: prima, durante, dopo', () => {
    const w = { start: LUN('18:00'), end: LUN('19:00') }
    const prima = statoFinestra(LUN('16:48'), w)!
    assert.equal(prima.fase, 'prima')
    assert.equal(Math.round(prima.minuti), 72)
    const durante = statoFinestra(LUN('18:37'), w)!
    assert.equal(durante.fase, 'durante')
    assert.equal(Math.round(durante.minuti), 23)
    assert.equal(statoFinestra(LUN('19:00'), w)!.fase, 'dopo')
    assert.equal(statoFinestra(LUN('19:00'), null), null)
})

test('turno in alto: prima, durante, dopo, domenica niente', () => {
    assert.equal(testoTurno(LUN('12:00'), DEFAULT_TARGETS), 'il turno inizia alle 13:30')
    assert.equal(testoTurno(LUN('17:15'), DEFAULT_TARGETS), 'mancano 2 ore e 45 min')
    assert.equal(testoTurno(LUN('20:05'), DEFAULT_TARGETS), 'turno finito')
    assert.equal(testoTurno(new Date('2026-11-01T15:00:00+01:00'), DEFAULT_TARGETS), null)
})

test('pause del giorno: prossima e in corso, sabato senza pause', () => {
    assert.equal(pauseDelGiorno(LUN('14:00'), DEFAULT_TARGETS).length, 2)
    const p1 = statoPausa(LUN('14:00'), DEFAULT_TARGETS)!
    assert.equal(p1.fase, 'prossima')
    assert.equal(oraBreve(p1.start), '15:30')
    const p2 = statoPausa(LUN('15:40'), DEFAULT_TARGETS)!
    assert.equal(p2.fase, 'durante')
    assert.equal(Math.round(p2.minuti), 5)
    const p3 = statoPausa(LUN('16:00'), DEFAULT_TARGETS)!
    assert.equal(oraBreve(p3.start), '17:45')
    assert.equal(statoPausa(LUN('18:30'), DEFAULT_TARGETS), null)
    assert.equal(statoPausa(new Date('2026-10-31T11:00:00+01:00'), DEFAULT_TARGETS), null)
})

test('etichette del giorno dell\'appuntamento', () => {
    const now = LUN('17:00')
    assert.equal(etichettaGiorno(LUN('19:00'), now), 'oggi')
    assert.equal(etichettaGiorno(new Date('2026-10-27T10:00:00+01:00'), now), 'domani')
    assert.equal(etichettaGiorno(new Date('2026-10-29T10:00:00+01:00'), now), 'giovedì')
    assert.equal(etichettaGiorno(new Date('2026-11-01T10:00:00+01:00'), now), 'domenica')
    assert.equal(etichettaGiorno(new Date('2026-11-08T10:00:00+01:00'), now), "l'8 novembre")
    assert.equal(etichettaGiorno(new Date('2026-11-12T10:00:00+01:00'), now), 'il 12 novembre')
    // a mezzanotte di Roma il giorno cambia anche se in UTC è ancora ieri
    assert.equal(etichettaGiorno(new Date('2026-10-26T23:30:00Z'), now), 'domani')
})

test('frasi della cronaca', () => {
    assert.equal(fraseCronaca('Zora', false, 'martedì'), 'Zora fissa per martedì')
    assert.equal(fraseCronaca('Zora', true, 'domani'), 'Tu fissi per domani')
    assert.equal(fraseCronaca('Zora', false, null), 'Zora fissa un appuntamento')
})

test('cronaca: un lead una volta sola, al massimo N', () => {
    const righe = [
        { id: 'c4', leadId: 'a' }, { id: 'c3', leadId: 'b' }, { id: 'c2', leadId: 'a' }, { id: 'c1', leadId: 'c' },
    ]
    assert.deepEqual(ultimiPerLead(righe, 8).map(r => r.id), ['c4', 'c3', 'c1'])
    assert.deepEqual(ultimiPerLead(righe, 2).map(r => r.id), ['c4', 'c3'])
})

test('lead distinti nella finestra (ora di punta)', () => {
    const righe = [
        { leadId: 'a', at: LUN('17:59') },
        { leadId: 'b', at: LUN('18:00') },
        { leadId: 'b', at: LUN('18:30') },
        { leadId: 'c', at: LUN('18:59') },
        { leadId: 'd', at: LUN('19:00') },
    ]
    assert.equal(leadDistinti(righe), 4)
    assert.equal(leadDistinti(righe, LUN('18:00'), LUN('19:00')), 2)
})

test('binario presenze: 7 caselle, euro dalla quinta, si allunga oltre', () => {
    const b = binarioPresenze(3, DEFAULT_TARGETS)
    assert.equal(b.length, 7)
    assert.deepEqual(b.map(c => c.euro), [false, false, false, false, true, true, true])
    assert.deepEqual(b.map(c => c.piena), [true, true, true, false, false, false, false])
    assert.equal(binarioPresenze(9, DEFAULT_TARGETS).length, 9)
})

test('settimane: chiave al lunedì, somme e distinti', () => {
    assert.equal(chiaveSettimana(new Date('2026-10-25T21:00:00Z')), '2026-10-19') // domenica sera
    assert.equal(chiaveSettimana(new Date('2026-10-25T23:30:00Z')), '2026-10-26') // già lunedì a Roma
    const somme = sommaPerSettimana([
        { at: new Date('2026-10-13T10:00:00Z'), n: 1 },
        { at: new Date('2026-10-14T10:00:00Z'), n: 2 },
        { at: new Date('2026-10-21T10:00:00Z'), n: 1 },
    ])
    assert.equal(somme.get('2026-10-12'), 3)
    assert.equal(somme.get('2026-10-19'), 1)
    const distinti = distintiPerSettimana([
        { at: new Date('2026-10-26T15:00:00Z'), leadId: 'a' },
        { at: new Date('2026-10-27T15:00:00Z'), leadId: 'a' },
        { at: new Date('2026-10-27T16:00:00Z'), leadId: 'b' },
    ])
    assert.equal(distinti.get('2026-10-26'), 2)
})

test('miglior settimana: massimo, a parità la più recente', () => {
    assert.deepEqual(migliorSettimana(new Map()), { settimana: null, valore: 0 })
    assert.deepEqual(migliorSettimana(new Map([['2026-10-05', 4], ['2026-10-12', 6], ['2026-10-19', 6]])), { settimana: '2026-10-19', valore: 6 })
})

test('giorno lavorativo precedente: lunedì guarda il sabato', () => {
    const lun = giornoLavorativoPrecedente(LUN('13:40'))
    assert.equal(lun.etichetta, 'sabato')
    assert.equal(lun.start.toISOString(), '2026-10-23T22:00:00.000Z') // sabato 24, ancora ora legale
    assert.equal(lun.end.toISOString(), '2026-10-24T22:00:00.000Z')
    const mar = giornoLavorativoPrecedente(new Date('2026-10-27T14:00:00+01:00'))
    assert.equal(mar.etichetta, 'ieri')
    assert.equal(mar.start.toISOString(), '2026-10-25T23:00:00.000Z')
})

test('inizio turno: una volta al giorno, solo durante il turno', () => {
    assert.equal(mostraInizioTurno(LUN('13:00'), DEFAULT_TARGETS, null), false)
    assert.equal(mostraInizioTurno(LUN('13:30'), DEFAULT_TARGETS, null), true)
    assert.equal(mostraInizioTurno(LUN('15:00'), DEFAULT_TARGETS, '2026-10-25'), true)
    assert.equal(mostraInizioTurno(LUN('15:00'), DEFAULT_TARGETS, '2026-10-26'), false)
    assert.equal(mostraInizioTurno(LUN('20:00'), DEFAULT_TARGETS, null), false)
    // sabato il turno parte alle 10
    assert.equal(mostraInizioTurno(new Date('2026-10-31T10:05:00+01:00'), DEFAULT_TARGETS, null), true)
    assert.equal(mostraInizioTurno(new Date('2026-11-01T15:00:00+01:00'), DEFAULT_TARGETS, null), false)
})

test('pavimento ottimistico: tiene finché vale, poi comanda il server', () => {
    assert.equal(conPavimento(37, { valore: 38, fino: 1000 }, 500), 38)
    assert.equal(conPavimento(40, { valore: 38, fino: 1000 }, 500), 40)
    assert.equal(conPavimento(37, { valore: 38, fino: 1000 }, 1000), 37)
    assert.equal(conPavimento(37, null, 0), 37)
})

test('momento appuntamento: più ricco al 1°, all\'8° e al 10°', () => {
    assert.equal(tipoMomento(1, [8, 10]), 'scalino')
    assert.equal(tipoMomento(8, [8, 10]), 'scalino')
    assert.equal(tipoMomento(10, [8, 10]), 'pieno')
    assert.equal(tipoMomento(5, [8, 10]), 'semplice')
})

test('formati: ora, ora parlata, euro, settimana', () => {
    assert.equal(oraBreve(LUN('18:05')), '18:05')
    assert.equal(oraParlata(LUN('18:00')), '18')
    assert.equal(oraParlata(LUN('17:45')), '17:45')
    assert.equal(euro(24).replace(/\s/g, ' '), '24 €')
    assert.equal(etichettaSettimana('2026-10-12'), 'settimana del 12 ottobre')
    assert.equal(etichettaSettimana('2026-06-08'), "settimana dell'8 giugno")
    assert.equal(giornoSettimanaRoma(LUN('10:00')), 1)
})
