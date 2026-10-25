import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    settimanaLunSab, settimanaDaLunedi, settimanaPrima, settimanaChiusa,
    ordinaPerPresenze, calcolaPremiSettimana, euroPerPersona, parsePremiSettimana,
    type NumeriSettimana,
} from './premiSettimana'
import { DEFAULT_ECONOMY_RULES } from './rules'
import { DEFAULT_TARGETS } from '@/lib/diretta/config'
import { DEFAULT_CONFERME_BONUS } from '@/lib/conferme/bonus'

test('settimana lun-sab: da lunedì 00:00 a domenica 00:00 di Roma, anche nella settimana del cambio d\'ora', () => {
    // Lunedì 26/10/2026 è il primo giorno di ora solare (UTC+1).
    const s = settimanaLunSab(new Date('2026-10-28T15:00:00Z'))
    assert.equal(s.start.toISOString(), '2026-10-25T23:00:00.000Z')
    assert.equal(s.end.toISOString(), '2026-10-31T23:00:00.000Z')
    assert.equal(s.lunedi, '2026-10-26')
    assert.equal(s.sabato, '2026-10-31')
    // Sabato sera è dentro, domenica no: di domenica si vede la settimana appena chiusa.
    assert.equal(settimanaLunSab(new Date('2026-10-31T19:30:00Z')).lunedi, '2026-10-26')
    const domenica = settimanaLunSab(new Date('2026-11-01T10:00:00Z'))
    assert.equal(domenica.lunedi, '2026-10-26')
    assert.equal(settimanaChiusa(domenica, new Date('2026-11-01T10:00:00Z')), true)
    // Lunedì si riparte da zero.
    assert.equal(settimanaLunSab(new Date('2026-11-01T23:00:00Z')).lunedi, '2026-11-02')
})

test('settimana lun-sab in primavera (29/03/2027 dopo il cambio all\'ora legale)', () => {
    const s = settimanaLunSab(new Date('2027-03-31T12:00:00Z'))
    assert.equal(s.lunedi, '2027-03-29')
    assert.equal(s.start.toISOString(), '2027-03-28T22:00:00.000Z')
    assert.equal(s.end.toISOString(), '2027-04-03T22:00:00.000Z')
})

test('settimana dal lunedì, la precedente e quando è chiusa', () => {
    assert.equal(settimanaDaLunedi('2026-10-26')?.sabato, '2026-10-31')
    assert.equal(settimanaDaLunedi('2026-10-27'), null)          // martedì: non è una chiave valida
    assert.equal(settimanaDaLunedi('26/10/2026'), null)
    const s = settimanaDaLunedi('2026-11-02')!
    assert.equal(settimanaPrima(s).lunedi, '2026-10-26')
    assert.equal(settimanaChiusa(s, new Date('2026-11-07T22:59:00Z')), false)   // sabato 23:59 di Roma
    assert.equal(settimanaChiusa(s, new Date('2026-11-07T23:00:00Z')), true)    // domenica 00:00
})

test('ordine: presenze, poi fissati validi, poi il nome', () => {
    const o = ordinaPerPresenze([
        { nome: 'Zora', presenze: 5, fissati: 40 },
        { nome: 'anthony', presenze: 5, fissati: 40 },
        { nome: 'Riccardo', presenze: 5, fissati: 44 },
        { nome: 'Noemi', presenze: 6, fissati: 10 },
    ])
    assert.deepEqual(o.map(x => x.nome), ['Noemi', 'Riccardo', 'anthony', 'Zora'])
})

const numeri = (p: Partial<NumeriSettimana> = {}): NumeriSettimana => ({
    lunedi: '2026-10-26',
    gdo: [
        { userId: 'a', nome: 'Anthony', presenze: 7, fissati: 44 },
        { userId: 'z', nome: 'Zora', presenze: 5, fissati: 47 },
        { userId: 'r', nome: 'Riccardo', presenze: 5, fissati: 48 },
        { userId: 'c', nome: 'Christian', presenze: 3, fissati: 50 },
        { userId: 'l', nome: 'Lorenzo', presenze: 0, fissati: 12 },
    ],
    conferme: { chiusure: 19, presenze: 40, persone: [{ userId: 'al', nome: 'Alberto' }, { userId: 'an', nome: 'Andrea' }] },
    ...p,
})
const REGOLE = {
    economia: DEFAULT_ECONOMY_RULES,
    obiettivi: DEFAULT_TARGETS,
    conferme: { ...DEFAULT_CONFERME_BONUS, unita: 'chiusure' as const, periodo: 'settimana' as const, soglia: 16, euroPerUnita: 12 },
}

test('premi della settimana: classifica 50/25/10, presenze dalla 5ª a 12 euro, Conferme oltre 16 a 12 euro a testa', () => {
    const p = calcolaPremiSettimana(numeri(), REGOLE)
    assert.deepEqual(p.classifica.map(r => [r.posizione, r.nome, r.euro]), [[1, 'Anthony', 50], [2, 'Riccardo', 25], [3, 'Zora', 10]])
    assert.deepEqual(p.presenzeGdo.map(r => [r.nome, r.pagate, r.euro]), [['Anthony', 3, 36], ['Riccardo', 1, 12], ['Zora', 1, 12]])
    assert.ok(p.conferme)
    assert.equal(p.conferme!.oltre, 3)
    assert.equal(p.conferme!.euroATesta, 36)
    assert.deepEqual(p.conferme!.persone.map(x => [x.nome, x.euro]), [['Alberto', 36], ['Andrea', 36]])
    // 85 di classifica + 60 di presenze + 72 delle Conferme
    assert.equal(p.totaleEuro, 217)
    assert.deepEqual(euroPerPersona(p).map(x => [x.nome, x.euro]), [
        ['Anthony', 86], ['Riccardo', 37], ['Alberto', 36], ['Andrea', 36], ['Zora', 22],
    ])
})

test('premi della settimana: sotto le soglie non si paga niente, e il podio vuole almeno una presenza', () => {
    const p = calcolaPremiSettimana(numeri({
        gdo: [{ userId: 'a', nome: 'Anthony', presenze: 4, fissati: 30 }, { userId: 'l', nome: 'Lorenzo', presenze: 0, fissati: 50 }],
        conferme: { chiusure: 16, presenze: 30, persone: [{ userId: 'al', nome: 'Alberto' }] },
    }), REGOLE)
    assert.deepEqual(p.classifica.map(r => [r.nome, r.euro]), [['Anthony', 50]])
    assert.deepEqual(p.presenzeGdo, [])
    assert.equal(p.conferme!.oltre, 0)
    assert.deepEqual(p.conferme!.persone, [])
    assert.equal(p.totaleEuro, 50)
})

test('bonus Conferme a mese: la settimana non lo chiude', () => {
    const p = calcolaPremiSettimana(numeri(), { ...REGOLE, conferme: { ...REGOLE.conferme, periodo: 'mese' } })
    assert.equal(p.conferme, null)
    assert.equal(p.totaleEuro, 145)
})

test('snapshot salvato: si rilegge, e una forma rotta torna null', () => {
    const p = calcolaPremiSettimana(numeri(), REGOLE)
    assert.deepEqual(parsePremiSettimana(JSON.parse(JSON.stringify(p))), p)
    assert.equal(parsePremiSettimana(null), null)
    assert.equal(parsePremiSettimana({ lunedi: '2026-10-26' }), null)
    assert.equal(parsePremiSettimana({ ...p, conferme: 'rotto' }), null)
})
