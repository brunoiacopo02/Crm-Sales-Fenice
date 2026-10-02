import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSlots as computeSlotsDb, cercaProssimi } from './botGuard'
import { LANCIO_WEBDEV } from './config'

// Nessun lead gia' prenotato: il tetto si prova senza DB.
const VUOTO = async () => new Map<number, number>()
const computeSlots = (d: string, now: Date, occ: (date: string) => Promise<Map<number, number>> = VUOTO) =>
    computeSlotsDb(d, now, LANCIO_WEBDEV, { occupatiDel: occ })

const SERA = new Date('2026-10-05T21:30:00+02:00')

// Il ramo `dopodomani` e quello della data fuori regole non leggono il DB:
// sono decisioni pure sulla data, e la loro forma e' il contratto che il bot
// legge (B4). La mattina del 6/10 passa dal DB ed e' coperta dai test di
// mattinaSlots (slots.test.ts).

test('il 7/10 e la mattina delle Conferme: nessuna ora, nessun pomeriggio', async () => {
    const r = await computeSlots('2026-10-07', SERA)
    assert.deepEqual(r, {
        date: '2026-10-07',
        mattina: 'conferme',
        pomeriggio: { aperto: false, ore: [] },
        mattinaEsaurita: false,
        oreAmmesse: [9, 10, 11, 12, 13, 14],
    })
})

test('una data qualsiasi esce null: il chiamante risponde 422', async () => {
    assert.equal(await computeSlots('2026-10-09', SERA), null)
    assert.equal(await computeSlots('2026-10-05', SERA), null)
    assert.equal(await computeSlots('non-una-data', SERA), null)
})

test('anche il 7/10 non offre ore gia passate o entro l ora', async () => {
    // Mezzogiorno del 7/10: 9-12 sono passate o troppo vicine, restano 13 e 14.
    const r = await computeSlots('2026-10-07', new Date('2026-10-07T12:00:00+02:00'))
    assert.deepEqual(r?.oreAmmesse, [13, 14])
    // A giornata finita non resta niente da proporre.
    const tardi = await computeSlots('2026-10-07', new Date('2026-10-07T18:00:00+02:00'))
    assert.deepEqual(tardi?.oreAmmesse, [])
})

test('oreAmmesse del 7/10 e una copia: modificarla non tocca la config', async () => {
    const r = await computeSlots('2026-10-07', SERA)
    assert.ok(r)
    r.oreAmmesse.push(99)
    const r2 = await computeSlots('2026-10-07', SERA)
    assert.deepEqual(r2?.oreAmmesse, [9, 10, 11, 12, 13, 14])
})

test('il tetto di 25 toglie dal 7/10 le ore piene', async () => {
    const r = await computeSlots('2026-10-07', SERA, async () => new Map([[9, 25], [10, 24]]))
    assert.deepEqual(r?.oreAmmesse, [10, 11, 12, 13, 14])
})

// cercaProssimi: la camminata dei giorni, con occupati e mattina iniettati.
const piene = (...ore: number[]) => new Map(ore.map(h => [h, 25] as [number, number]))
const tutteLeOre = piene(9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20)
const SENZA_MATTINA = async () => null

test('cercaProssimi: la domenica si salta e non va fra i saltati', async () => {
    // Il 10/10 e' sabato (pieno), l'11 domenica, il 12 lunedi libero.
    const r = await cercaProssimi('2026-10-10', SERA, LANCIO_WEBDEV, {
        mattinaDel: SENZA_MATTINA,
        occupatiDel: async d => (d === '2026-10-10' ? tutteLeOre : new Map()),
    })
    assert.deepEqual(r.saltati, ['2026-10-10'])
    assert.equal(r.conferme?.date, '2026-10-12')
})

test('cercaProssimi: un giorno pieno finisce in saltati e torna il successivo', async () => {
    const r = await cercaProssimi('2026-10-07', SERA, LANCIO_WEBDEV, {
        mattinaDel: SENZA_MATTINA,
        occupatiDel: async d => (d === '2026-10-07' ? tutteLeOre : piene(9)),
    })
    assert.deepEqual(r.saltati, ['2026-10-07'])
    assert.equal(r.conferme?.date, '2026-10-08')
    assert.deepEqual(r.conferme?.ore.map(o => o.hour), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
})

test('cercaProssimi: un giorno gia passato per anticipo non e pieno', async () => {
    // Il 6/10 alle 20:30 nessuna ora e' piu' prenotabile: non e' "pieno", non va detto al lead.
    const r = await cercaProssimi('2026-10-06', new Date('2026-10-06T20:30:00+02:00'), LANCIO_WEBDEV, {
        mattinaDel: SENZA_MATTINA, occupatiDel: VUOTO,
    })
    assert.deepEqual(r.saltati, [])
    assert.equal(r.conferme?.date, '2026-10-07')
})

test('cercaProssimi: from prima del 6/10 parte dal 6 e porta la mattina', async () => {
    const mattina = { date: '2026-10-06', ore: [{ hour: 9, liberi: 2 }] }
    const r = await cercaProssimi('2026-10-01', SERA, LANCIO_WEBDEV, { mattinaDel: async () => mattina, occupatiDel: VUOTO })
    assert.deepEqual(r.mattina, mattina)
    assert.equal(r.conferme?.date, '2026-10-06')
    assert.deepEqual(r.conferme?.ore.map(o => o.hour), [15, 16, 17, 18, 19, 20])
})

test('cercaProssimi: from dopo il 6 non legge la mattina', async () => {
    const r = await cercaProssimi('2026-10-08', SERA, LANCIO_WEBDEV, {
        mattinaDel: async () => { throw new Error('non va letta') }, occupatiDel: VUOTO,
    })
    assert.equal(r.mattina, null)
})

test('cercaProssimi: orizzonte esaurito, conferme null e domeniche mai fra i saltati', async () => {
    const r = await cercaProssimi('2026-10-07', SERA, LANCIO_WEBDEV, { mattinaDel: SENZA_MATTINA, occupatiDel: async () => tutteLeOre })
    assert.equal(r.conferme, null)
    assert.ok(r.saltati.length > 20)
    assert.ok(!r.saltati.includes('2026-10-11'))
})
