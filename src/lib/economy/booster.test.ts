import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    boostIdemKey, boosterAttivo, boosterComprati, DEFAULT_BOOSTER, parseBooster, puoComprareBooster, raddoppia,
    type RigaBooster,
} from './booster'

const t = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00+01:00`)
const acquisto = (hhmm: string, id = 'p1', minuti = 60): RigaBooster => ({
    reason: 'negozio', amount: -15, createdAt: t(hhmm), metadata: { purchaseId: id, itemId: 'booster-fissati', booster: true, minuti },
})
const doppio = (id = 'p1'): RigaBooster => ({ reason: 'booster', amount: 10, createdAt: t('17:10'), metadata: { purchaseId: id } })
const turno = { start: t('13:30'), end: t('20:00') }

test('booster: attivo per la sua durata, dall\'acquisto (fine esclusa)', () => {
    const righe = [acquisto('17:00')]
    assert.equal(boosterAttivo(righe, t('16:59')), null)
    assert.equal(boosterAttivo(righe, t('17:00'))?.purchaseId, 'p1')
    assert.equal(boosterAttivo(righe, t('17:59'))?.fino.toISOString(), t('18:00').toISOString())
    assert.equal(boosterAttivo(righe, t('18:00')), null)
})

test('booster: un acquisto normale del negozio non è un booster', () => {
    const caffe: RigaBooster = { reason: 'negozio', amount: -650, createdAt: t('17:00'), metadata: { purchaseId: 'c', itemId: 'caffe-cornetto' } }
    assert.equal(boosterAttivo([caffe], t('17:10')), null)
    assert.equal(boosterComprati([caffe]), 0)
})

test('booster: raddoppia fino a maxFissati, poi basta', () => {
    const righe = [acquisto('17:00'), doppio(), doppio()]
    const attivo = boosterAttivo(righe, t('17:30'))
    assert.equal(attivo?.usati, 2)
    assert.equal(raddoppia(attivo, DEFAULT_BOOSTER), true)
    const pieno = boosterAttivo([...righe, doppio()], t('17:40'))
    assert.equal(raddoppia(pieno, DEFAULT_BOOSTER), false)
    assert.equal(raddoppia(null, DEFAULT_BOOSTER), false)
})

test('booster: si compra solo in turno, non sopra un altro, uno al giorno', () => {
    const r = DEFAULT_BOOSTER
    assert.deepEqual(puoComprareBooster({ righeOggi: [], now: t('13:00'), turno, rules: r }), { ok: false, error: 'booster_turno' })
    assert.deepEqual(puoComprareBooster({ righeOggi: [], now: t('20:00'), turno, rules: r }), { ok: false, error: 'booster_turno' })
    assert.deepEqual(puoComprareBooster({ righeOggi: [], now: t('15:00'), turno: null, rules: r }), { ok: false, error: 'booster_turno' })
    assert.deepEqual(puoComprareBooster({ righeOggi: [], now: t('15:00'), turno, rules: r }), { ok: true })
    assert.deepEqual(puoComprareBooster({ righeOggi: [acquisto('14:30')], now: t('15:00'), turno, rules: r }), { ok: false, error: 'booster_attivo' })
    assert.deepEqual(puoComprareBooster({ righeOggi: [acquisto('14:00')], now: t('16:00'), turno, rules: r }), { ok: false, error: 'booster_oggi' })
    assert.deepEqual(puoComprareBooster({ righeOggi: [acquisto('14:00')], now: t('16:00'), turno, rules: { ...r, perGiorno: 2 } }), { ok: true })
})

test('booster: chiave del raddoppio e regole lette dal JSON', () => {
    assert.equal(boostIdemKey('F:lead1:20389'), 'boost:F:lead1:20389')
    assert.deepEqual(parseBooster(undefined), DEFAULT_BOOSTER)
    assert.deepEqual(parseBooster({ minuti: 45, maxFissati: 2, perGiorno: 'x' }), { minuti: 45, maxFissati: 2, perGiorno: 1 })
    assert.deepEqual(parseBooster({ minuti: 0 }), DEFAULT_BOOSTER)
})
