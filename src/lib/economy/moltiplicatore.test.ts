import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    acquistoMoltiplicatore, DEFAULT_MOLTIPLICATORE, fissatoValido, moltIdemKey, moltiplicatoreCopre, moltiplicatoriComprati,
    parseMoltiplicatore, pianoMoltiplicatore, premiPerAcquisto, puoComprareMoltiplicatore,
    type RigaLead, type RigaNegozio,
} from './moltiplicatore'

const t = (hhmm: string, giorno = '2026-10-26') => new Date(`${giorno}T${hhmm}:00+01:00`)
const acquisto = (hhmm: string, id = 'm1'): RigaNegozio => ({
    reason: 'negozio', amount: -20, createdAt: t(hhmm), metadata: { purchaseId: id, itemId: 'moltiplicatore-presenza', moltiplicatore: true },
})
const turno = { start: t('13:30'), end: t('20:00') }
const FK = 'S:fissato:L1:681'
const fissato = (hhmm: string, k = FK, userId = 'g1'): RigaLead => ({ idemKey: k, amount: 10, createdAt: t(hhmm), userId })

test('moltiplicatore: riconosce l\'acquisto e copre i fissati dopo, lo stesso giorno', () => {
    assert.equal(acquistoMoltiplicatore(acquisto('15:00')), 'm1')
    assert.equal(acquistoMoltiplicatore({ ...acquisto('15:00'), metadata: { purchaseId: 'x', booster: true } }), null)
    assert.equal(moltiplicatoreCopre([acquisto('15:00')], t('14:59')), null)
    assert.equal(moltiplicatoreCopre([acquisto('15:00')], t('15:30')), 'm1')
    assert.equal(moltiplicatoriComprati([acquisto('15:00'), acquisto('16:00', 'm2')]), 2)
})

test('moltiplicatore: solo in turno, uno al giorno', () => {
    const r = DEFAULT_MOLTIPLICATORE
    assert.deepEqual(puoComprareMoltiplicatore({ righeOggi: [], now: t('12:00'), turno, rules: r }), { ok: false, error: 'moltiplicatore_turno' })
    assert.deepEqual(puoComprareMoltiplicatore({ righeOggi: [], now: t('15:00'), turno: null, rules: r }), { ok: false, error: 'moltiplicatore_turno' })
    assert.deepEqual(puoComprareMoltiplicatore({ righeOggi: [], now: t('15:00'), turno, rules: r }), { ok: true })
    assert.deepEqual(puoComprareMoltiplicatore({ righeOggi: [acquisto('14:00')], now: t('15:00'), turno, rules: r }), { ok: false, error: 'moltiplicatore_oggi' })
})

test('moltiplicatore: il fissato valido è il più recente non stornato', () => {
    const righe: RigaLead[] = [fissato('15:00', 'S:fissato:L1:680'), { idemKey: 'storno:S:fissato:L1:680', amount: -10 }, fissato('16:00')]
    assert.equal(fissatoValido(righe, 'L1')?.idemKey, FK)
    assert.equal(fissatoValido([fissato('15:00'), { idemKey: `storno:${FK}`, amount: -10 }], 'L1'), null)
})

const base = {
    leadId: 'L1', presenzaValida: true, presenzaPagabile: true, destinatarioId: 'g1',
    copertura: { purchaseId: 'm1', usati: 0 }, rules: DEFAULT_MOLTIPLICATORE,
}

test('moltiplicatore: presenza verificata = un premio legato al fissato', () => {
    const p = pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00')] })
    assert.deepEqual(p, { accredita: { idemKey: moltIdemKey(FK), purchaseId: 'm1', fissatoIdemKey: FK }, storna: [] })
    // Già pagato: niente.
    const pagato = pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00'), { idemKey: moltIdemKey(FK), amount: 25 }] })
    assert.deepEqual(pagato, { accredita: null, storna: [] })
})

test('moltiplicatore: tetto di presenze, fissato di un altro, presenza non pagabile', () => {
    assert.equal(pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00')], copertura: { purchaseId: 'm1', usati: 4 } }).accredita, null)
    assert.equal(pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00', FK, 'g2')] }).accredita, null)
    assert.equal(pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00')], presenzaPagabile: false }).accredita, null)
    assert.equal(pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00')], copertura: null }).accredita, null)
})

test('moltiplicatore: la presenza sparisce = storno; torna = chiave nuova', () => {
    const pagato: RigaLead = { idemKey: moltIdemKey(FK), amount: 25 }
    assert.deepEqual(pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00'), pagato], presenzaValida: false }), { accredita: null, storna: [pagato.idemKey] })
    const stornato: RigaLead = { idemKey: `storno:${pagato.idemKey}`, amount: -25 }
    assert.equal(pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00'), pagato, stornato] }).accredita?.idemKey, `molt:${FK}:g2`)
    // Fissato stornato (appuntamento tolto): via anche il premio.
    assert.deepEqual(
        pianoMoltiplicatore({ ...base, righeLead: [fissato('16:00'), { idemKey: `storno:${FK}`, amount: -10 }, pagato] }).storna,
        [pagato.idemKey],
    )
})

test('moltiplicatore: premi pagati per acquisto, stornati esclusi', () => {
    const r = (k: string, id: string, amount = 25) => ({ idemKey: k, reason: 'moltiplicatore', amount, createdAt: t('19:00'), metadata: { purchaseId: id } })
    const righe = [r('molt:a', 'm1'), r('molt:b', 'm1'), r('molt:c', 'm2'), { ...r('storno:molt:b', 'm1', -25), reason: 'storno' }]
    assert.equal(premiPerAcquisto(righe, 'm1'), 1)
    assert.equal(premiPerAcquisto(righe, 'm2'), 1)
})

test('moltiplicatore: regole dal JSON', () => {
    assert.deepEqual(parseMoltiplicatore(undefined), DEFAULT_MOLTIPLICATORE)
    assert.deepEqual(parseMoltiplicatore({ bonus: 30, maxPresenze: 'x' }), { bonus: 30, maxPresenze: 4, perGiorno: 1 })
})
