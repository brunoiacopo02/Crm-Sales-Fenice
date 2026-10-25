import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    ACCOUNT_PROVA, SALDO_PROVA, TOTALE_LEAD_PROVA, orariAppuntamenti, pianoLeadDiProva, ricaricaPerSaldo,
    type LeadProva, type TipoLeadProva,
} from './piano'
import { confermeBoardColumn } from '@/lib/conferme/boardWindow'
import { eVergineDelGiorno } from '@/lib/diretta/arrivo'
import { eLeadDelLancio } from '@/lib/diretta/instradamento'
import { dayBoundsRome } from '@/lib/dateUtils'

// Lunedì 26/10/2026 alle 14:00 di Roma (ora solare, +1): un pomeriggio di turno.
const LUNEDI = new Date('2026-10-26T13:00:00Z')
// Domenica 25/10/2026 alle 21:30 di Roma: troppo tardi per un appuntamento in giornata.
const DOMENICA_SERA = new Date('2026-10-25T20:30:00Z')
// Sabato 31/10/2026 alle 08:00 di Roma.
const SABATO_MATTINA = new Date('2026-10-31T07:00:00Z')

const conta = (piano: LeadProva[], tipo: TipoLeadProva) => piano.filter(l => l.tipo === tipo).length

test('account: un GDO col codice 990 e una Conferma, email @fenice.local', () => {
    const gdo = ACCOUNT_PROVA.find(a => a.chiave === 'gdo')!
    const conf = ACCOUNT_PROVA.find(a => a.chiave === 'conferme')!
    assert.deepEqual([gdo.email, gdo.role, gdo.gdoCode, gdo.firstName], ['prova.gdo@fenice.local', 'GDO', 990, 'Prova GDO'])
    assert.deepEqual([conf.email, conf.role, conf.gdoCode, conf.firstName], ['prova.conferme@fenice.local', 'CONFERME', null, 'Prova Conferme'])
})

test('saldo di prova: si ricarica fino al minimo, mai un addebito', () => {
    assert.equal(ricaricaPerSaldo(0, SALDO_PROVA.piume), SALDO_PROVA.piume)
    assert.equal(ricaricaPerSaldo(150, 600), 450)
    assert.equal(ricaricaPerSaldo(600, 600), 0)
    assert.equal(ricaricaPerSaldo(9000, 600), 0)
    assert.equal(ricaricaPerSaldo(-50, 600), 600)
    assert.ok(SALDO_PROVA.piume >= 400, 'deve bastare per il corso a 400 Piume')
})

test('25 lead: 3 vergini, 1ª, 2ª e 3ª chiamata, richiami e 2 appuntamenti', () => {
    const piano = pianoLeadDiProva(LUNEDI)
    assert.equal(piano.length, 25)
    assert.equal(TOTALE_LEAD_PROVA, 25)
    assert.equal(conta(piano, 'vergine'), 3)
    assert.equal(conta(piano, 'prima'), 5)
    assert.equal(conta(piano, 'seconda'), 5)
    assert.equal(conta(piano, 'terza'), 4)
    assert.equal(conta(piano, 'richiamo_scaduto'), 3)
    assert.equal(conta(piano, 'richiamo'), 3)
    assert.equal(conta(piano, 'appuntamento'), 2)
})

test('dati chiaramente finti e unici: nomi "Prova ...", telefoni +39 000 000 00xx, email @example.com', () => {
    const piano = pianoLeadDiProva(LUNEDI)
    assert.equal(piano[0].nome, 'Prova Uno')
    assert.equal(piano[24].nome, 'Prova Venticinque')
    assert.equal(piano[0].telefono, '+39 000 000 0001')
    assert.equal(piano[24].telefono, '+39 000 000 0025')
    for (const l of piano) {
        assert.match(l.nome, /^Prova [A-Z]/)
        assert.match(l.telefono, /^\+39 000 000 00\d{2}$/)
        assert.match(l.email, /^prova\d{2}@example\.com$/)
    }
    assert.equal(new Set(piano.map(l => l.nome)).size, 25)
    assert.equal(new Set(piano.map(l => l.telefono)).size, 25)
    assert.equal(new Set(piano.map(l => l.email)).size, 25)
})

test('funnel misti, mai Database né lancio (che toglierebbero i lead dalla board del GDO)', () => {
    const piano = pianoLeadDiProva(LUNEDI)
    assert.ok(new Set(piano.map(l => l.funnel)).size >= 4)
    for (const l of piano) {
        assert.notEqual(l.funnel.toLowerCase(), 'database')
        assert.equal(eLeadDelLancio({ launchBucket: null, funnel: l.funnel, lancioPool: null, humanTestCohort: null }), false)
    }
})

test('storia coerente: callCount uguale ai callLog, stati giusti per tipo', () => {
    for (const now of [LUNEDI, DOMENICA_SERA, SABATO_MATTINA]) {
        for (const l of pianoLeadDiProva(now)) {
            assert.equal(l.chiamate.length, l.callCount, l.nome)
            for (const c of l.chiamate) assert.ok(c.at.getTime() <= now.getTime(), `${l.nome}: chiamata nel futuro`)
            assert.ok(l.createdAt.getTime() <= now.getTime(), `${l.nome}: nato nel futuro`)
            if (l.tipo === 'vergine' || l.tipo === 'prima') assert.deepEqual([l.status, l.callCount], ['NEW', 0])
            if (l.tipo === 'seconda') assert.deepEqual([l.status, l.callCount], ['IN_PROGRESS', 1])
            if (l.tipo === 'terza') assert.deepEqual([l.status, l.callCount], ['IN_PROGRESS', 2])
            if (l.tipo === 'richiamo_scaduto') assert.ok(l.recallDate!.getTime() < now.getTime(), l.nome)
            if (l.tipo === 'richiamo') assert.ok(l.recallDate!.getTime() > now.getTime(), l.nome)
            if (l.tipo !== 'richiamo' && l.tipo !== 'richiamo_scaduto') assert.equal(l.recallDate, null, l.nome)
        }
    }
})

test('vergini del giorno: solo i 3 nati oggi, come li vede la board del GDO', () => {
    for (const now of [LUNEDI, SABATO_MATTINA]) {
        const inizio = dayBoundsRome(now).start
        for (const l of pianoLeadDiProva(now)) {
            const vergine = eVergineDelGiorno({
                status: l.status, callCount: l.callCount, source: l.source, launchBucket: null,
                createdAt: l.createdAt, ridatoDalBot: false, passatoDalBot: false, tiHaCercato: false,
            }, inizio)
            assert.equal(vergine, l.tipo === 'vergine', l.nome)
        }
    }
})

test('appuntamenti: fissati ieri, da confermare, visibili oggi sulla board delle Conferme', () => {
    for (const now of [LUNEDI, DOMENICA_SERA, SABATO_MATTINA]) {
        const inizio = dayBoundsRome(now).start
        const app = pianoLeadDiProva(now).filter(l => l.tipo === 'appuntamento')
        assert.equal(app.length, 2)
        for (const l of app) {
            assert.equal(l.status, 'APPOINTMENT')
            assert.ok(l.appointmentCreatedAt!.getTime() < inizio.getTime(), 'fissato prima di oggi')
            assert.ok(l.appointmentDate!.getTime() > now.getTime(), 'appuntamento nel futuro')
            const colonna = confermeBoardColumn({
                appointmentDate: l.appointmentDate, appointmentCreatedAt: l.appointmentCreatedAt, appointmentMovedAt: null,
                confCall1At: null, confCall2At: null, confCall3At: null,
            }, now)
            assert.notEqual(colonna, null, `${l.nome} non compare sulla board alle ${now.toISOString()}`)
        }
    }
})

test('orari degli appuntamenti: oggi se c\'è tempo, altrimenti la mattina dopo', () => {
    // Lunedì 14:00 → il primo alle 16:00 di oggi (15:00 UTC), il secondo martedì alle 11:00.
    const lun = orariAppuntamenti(LUNEDI)
    assert.equal(lun.primo.toISOString(), '2026-10-26T15:00:00.000Z')
    assert.equal(lun.secondo.toISOString(), '2026-10-27T10:00:00.000Z')
    // Domenica 21:30 → entrambi lunedì mattina.
    const dom = orariAppuntamenti(DOMENICA_SERA)
    assert.equal(dom.primo.toISOString(), '2026-10-26T09:00:00.000Z')
    assert.equal(dom.secondo.toISOString(), '2026-10-26T10:00:00.000Z')
})
