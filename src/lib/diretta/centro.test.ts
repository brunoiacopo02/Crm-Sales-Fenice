import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chiaveInterruttore, DIRETTA_FLAG_KEYS, RUOLI_DIRETTA } from './config'
import {
    causaleTesto, controlloFissati, esitoDopo, esitoTesto, euroTesto, giornoDaSistemare, haRiflessioneApprovata,
    importoConSegno, isStorno, riepilogoCalendario, statoLeadTesto, statoVoce, statoVoceTesto, totaliRegistro,
    type GiornoCalendario, type GruppoRegistro,
} from './centro'

// ── Interruttori ────────────────────────────────────────────────────────

test('interruttori: GDO, Conferme e admin hanno ciascuno la sua chiave', () => {
    assert.equal(chiaveInterruttore('GDO'), 'gdo_ui_diretta')
    assert.equal(chiaveInterruttore('CONFERME'), 'conferme_ui_diretta')
    assert.equal(chiaveInterruttore('ADMIN'), 'admin_ui_diretta')
    assert.deepEqual([...RUOLI_DIRETTA].sort(), ['ADMIN', 'CONFERME', 'GDO'])
    assert.equal(new Set(Object.values(DIRETTA_FLAG_KEYS)).size, 3)
})

test('interruttori: venditori, manager, TL e ruoli scritti male non hanno la Diretta', () => {
    for (const r of ['VENDITORE', 'MANAGER', 'TL', 'admin', '', null, undefined]) {
        assert.equal(chiaveInterruttore(r), null, String(r))
    }
})

// ── Registro ────────────────────────────────────────────────────────────

const g = (currency: string, reason: string, positivi: number, negativi = 0, storno = false): GruppoRegistro =>
    ({ currency, reason, storno, positivi, negativi })

test('registro: premi emessi, spese al netto dei rimborsi, storni a parte', () => {
    const t = totaliRegistro([
        g('S', 'fissato', 120),
        g('S', 'scalino_personale', 80),
        g('S', 'forziere', 45),
        g('S', 'storno fissato: appuntamento tolto con un altro esito', 0, -20, true),
        g('S', 'negozio', 0, -300),
        g('S', 'negozio_rimborso', 100),
        g('P', 'conferma', 3),
        g('P', 'presenza', 6),
        g('P', 'storno presenza', 0, -2, true),
        g('P', 'negozio', 0, -400),
    ])
    assert.deepEqual(t.S, { emesse: 245, spese: 200, stornate: 20 })
    assert.deepEqual(t.P, { emesse: 9, spese: 400, stornate: 2 })
})

test("registro: l'azzeramento del go-live non è né premio né spesa", () => {
    const t = totaliRegistro([g('S', 'azzeramento', 0, -70135), g('S', 'benvenuto', 200), g('P', 'azzeramento', 0, -12)])
    assert.deepEqual(t.S, { emesse: 200, spese: 0, stornate: 0 })
    assert.deepEqual(t.P, { emesse: 0, spese: 0, stornate: 0 })
})

test('registro: valute sconosciute ignorate, correzioni negative contate come tolte', () => {
    const t = totaliRegistro([g('X', 'fissato', 999), g('S', 'correzione_admin', 0, -15)])
    assert.deepEqual(t.S, { emesse: 0, spese: 0, stornate: 15 })
})

test('registro: chiave di storno e causali in parole', () => {
    assert.equal(isStorno('storno:S:fissato:abc'), true)
    assert.equal(isStorno('S:fissato:abc'), false)
    assert.equal(causaleTesto('fissato'), 'Appuntamento fissato')
    assert.equal(causaleTesto('negozio_rimborso'), 'Rimborso del negozio')
    assert.equal(causaleTesto('storno fissato: appuntamento annullato'), 'Storno fissato: appuntamento annullato')
    assert.equal(causaleTesto('premio_settimana'), 'Premio settimana')
    assert.equal(causaleTesto('  '), 'Movimento')
})

// ── Fissati tolti ───────────────────────────────────────────────────────

test('controlli: per persona fissati, validi e tolti; rifissare lo stesso lead conta una volta', () => {
    const { persone, tolti } = controlloFissati([
        { userId: 'zora', leadId: 'a', createdAt: '2026-10-26T15:00:00Z', stato: 'APPOINTMENT' },
        { userId: 'zora', leadId: 'b', createdAt: '2026-10-26T15:10:00Z', stato: 'IN_PROGRESS' },
        { userId: 'zora', leadId: 'b', createdAt: '2026-10-26T15:20:00Z', stato: 'IN_PROGRESS' },
        { userId: 'anthony', leadId: 'c', createdAt: '2026-10-26T16:00:00Z', stato: 'APPOINTMENT' },
        { userId: 'anthony', leadId: 'd', createdAt: '2026-10-26T16:05:00Z', stato: 'APPOINTMENT' },
        { userId: null, leadId: 'e', createdAt: '2026-10-26T16:05:00Z', stato: 'REJECTED' },
    ])
    assert.deepEqual(persone, [
        { userId: 'zora', fissati: 2, validi: 1, tolti: 1 },
        { userId: 'anthony', fissati: 2, validi: 2, tolti: 0 },
    ])
    assert.equal(tolti.length, 1)
    assert.equal(tolti[0].leadId, 'b')
    // vale l'ultimo appuntamento della persona su quel lead
    assert.equal(tolti[0].fissatoAlle, '2026-10-26T15:20:00.000Z')
    assert.equal(tolti[0].stato, 'IN_PROGRESS')
})

test("controlli: l'esito che ha tolto l'appuntamento è il primo registrato dopo", () => {
    const tolto = { leadId: 'b', fissatoAlle: '2026-10-26T15:20:00.000Z' }
    const chiamate = [
        { leadId: 'b', outcome: 'APPUNTAMENTO', createdAt: '2026-10-26T15:20:00Z', userId: 'zora' },
        { leadId: 'b', outcome: 'NON_RISPOSTO', createdAt: '2026-10-26T17:00:00Z', userId: 'zora' },
        { leadId: 'b', outcome: 'RICHIAMO', createdAt: '2026-10-26T15:31:00Z', userId: 'zora' },
        { leadId: 'x', outcome: 'DA_SCARTARE', createdAt: '2026-10-26T15:21:00Z', userId: 'zora' },
    ]
    assert.equal(esitoDopo(tolto, chiamate)?.outcome, 'RICHIAMO')
    assert.equal(esitoDopo({ leadId: 'z', fissatoAlle: tolto.fissatoAlle }, chiamate), null)
    assert.equal(esitoTesto('RICHIAMO'), 'richiamo')
    assert.equal(esitoTesto('NON_RISPOSTO'), 'non risponde')
    assert.equal(esitoTesto('ALTRO_ESITO'), 'altro esito')
    assert.equal(statoLeadTesto('REJECTED'), 'scartato')
    assert.equal(statoLeadTesto(null), 'stato sconosciuto')
})

// ── Citazioni ───────────────────────────────────────────────────────────

const voce = (quote: boolean, approved: boolean, reflection: string | null) =>
    ({ quote: quote ? { id: 'q' } : null, approved, reflection })

test('citazioni: stato di una voce', () => {
    assert.equal(statoVoce(voce(false, false, null)), 'manca')
    assert.equal(statoVoce(voce(true, false, 'bozza')), 'da_approvare')
    assert.equal(statoVoce(voce(true, true, '  ')), 'approvata_vuota')
    assert.equal(statoVoce(voce(true, true, 'Riflessione')), 'approvata')
    assert.equal(haRiflessioneApprovata(voce(true, true, 'Riflessione')), true)
    assert.equal(haRiflessioneApprovata(voce(true, false, 'Riflessione')), false)
    assert.equal(statoVoceTesto('approvata_vuota', 'citazione'), 'Approvata senza riflessione')
    assert.equal(statoVoceTesto('manca', 'vendita'), 'Nessun consiglio')
})

test('citazioni: giorni senza riflessione approvata e giorni da sistemare', () => {
    const giorni: GiornoCalendario[] = [
        { day: '2026-10-26', citazione: voce(true, true, 'ok'), vendita: voce(true, true, 'ok') },
        { day: '2026-10-27', citazione: voce(true, false, 'bozza'), vendita: voce(true, true, '') },
        { day: '2026-10-28', citazione: voce(false, false, null), vendita: voce(true, false, null) },
        { day: '2026-10-29', citazione: voce(true, true, ''), vendita: voce(true, true, 'ok') },
    ]
    const r = riepilogoCalendario(giorni)
    assert.equal(r.giorni, 4)
    assert.deepEqual(r.citazioni, ['2026-10-27', '2026-10-28', '2026-10-29'])
    assert.deepEqual(r.consigli, ['2026-10-27', '2026-10-28'])
    assert.deepEqual(r.mancanti, ['2026-10-28'])
    assert.deepEqual(r.daApprovare, ['2026-10-27', '2026-10-28'])
    assert.deepEqual(giorni.map(giornoDaSistemare), [false, true, true, false])
})

// ── Testi ───────────────────────────────────────────────────────────────

test('testi: importi col segno ed euro senza centesimi inutili', () => {
    assert.equal(importoConSegno(10), '+10')
    assert.equal(importoConSegno(-2), '-2')
    assert.equal(importoConSegno(12000), '+12.000')
    assert.equal(euroTesto(12).replace(/\s/g, ' '), '12 €')
    assert.equal(euroTesto(12.5).replace(/\s/g, ' '), '12,50 €')
})
