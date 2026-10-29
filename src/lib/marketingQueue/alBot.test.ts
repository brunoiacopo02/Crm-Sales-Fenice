import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    leggiConfigCodaAlBot, spostabileAlBot, pianificaCodaAlBot, funnelPerIlBot,
    SCAGLIONE_DEFAULT, TETTO_FINESTRA_DEFAULT, finestraCodaAlBot, type CandidatoCoda,
} from './alBot'

function c(id: string, p: Partial<CandidatoCoda> = {}): CandidatoCoda {
    return {
        id, toccatoDalBot: false, status: 'NEW', callCount: 0, assignedToId: null,
        appointmentDate: null, phoneSuspicious: false, ...p,
    }
}

test('config: acceso di default, spento con MKT_CODA_BOT=off', () => {
    assert.equal(leggiConfigCodaAlBot({}).attivo, true)
    assert.equal(leggiConfigCodaAlBot({ MKT_CODA_BOT: 'off' }).attivo, false)
    assert.equal(leggiConfigCodaAlBot({}).scaglione, SCAGLIONE_DEFAULT)
    assert.equal(leggiConfigCodaAlBot({}).tettoFinestra, TETTO_FINESTRA_DEFAULT)
})

test('config: un valore illeggibile vale il ripiego, mai mille lead in un colpo', () => {
    assert.equal(leggiConfigCodaAlBot({ MKT_CODA_BOT_FINESTRA: '9999' }).tettoFinestra, TETTO_FINESTRA_DEFAULT)
    assert.equal(leggiConfigCodaAlBot({ MKT_CODA_BOT_BATCH: 'abc' }).scaglione, SCAGLIONE_DEFAULT)
    assert.equal(leggiConfigCodaAlBot({ MKT_CODA_BOT_FINESTRA: '40' }).tettoFinestra, 40)
})

test('spostabile: solo mai toccati, di nessuno, telefono buono, mai scritti dal bot', () => {
    assert.equal(spostabileAlBot(c('a')), true)
    assert.equal(spostabileAlBot(c('a', { toccatoDalBot: true })), false)
    assert.equal(spostabileAlBot(c('a', { assignedToId: 'gdo' })), false)
    assert.equal(spostabileAlBot(c('a', { callCount: 1 })), false)
    assert.equal(spostabileAlBot(c('a', { status: 'REJECTED' })), false)
    assert.equal(spostabileAlBot(c('a', { phoneSuspicious: true })), false)
    assert.equal(spostabileAlBot(c('a', { appointmentDate: new Date() })), false)
})

test('piano: scaglione e tetto della finestra, il più stretto vince', () => {
    const cfg = { attivo: true, scaglione: 5, tettoFinestra: 30 }
    const tanti = Array.from({ length: 20 }, (_, i) => c(`l${i}`))
    assert.deepEqual(pianificaCodaAlBot({ candidati: tanti, config: cfg, giaNellaFinestra: 0 }).daSpostare, ['l0', 'l1', 'l2', 'l3', 'l4'])
    assert.equal(pianificaCodaAlBot({ candidati: tanti, config: cfg, giaNellaFinestra: 28 }).daSpostare.length, 2)
    const pieno = pianificaCodaAlBot({ candidati: tanti, config: cfg, giaNellaFinestra: 30 })
    assert.equal(pieno.motivo, 'tetto_raggiunto')
    assert.equal(pieno.daSpostare.length, 0)
})

test('piano: spento non sposta niente, i non spostabili non contano', () => {
    assert.equal(pianificaCodaAlBot({ candidati: [c('a')], config: { attivo: false, scaglione: 5, tettoFinestra: 30 }, giaNellaFinestra: 0 }).motivo, 'spento')
    const p = pianificaCodaAlBot({ candidati: [c('a', { toccatoDalBot: true }), c('b')], config: { attivo: true, scaglione: 5, tettoFinestra: 30 }, giaNellaFinestra: 0 })
    assert.deepEqual(p.daSpostare, ['b'])
})

test('funnel: i nomi del marketing diventano quelli di ActiveCampaign', () => {
    assert.equal(funnelPerIlBot('corso10ore'), 'CORSO 10 ORE')
    assert.equal(funnelPerIlBot('jobsimulator'), 'JOB SIMULATOR')
    assert.equal(funnelPerIlBot('telegram'), 'TELEGRAM')
    assert.equal(funnelPerIlBot('sconosciuto'), 'sconosciuto')
    assert.equal(funnelPerIlBot(null), null)
})

test('default: 10 per giro, 30 per finestra (10 a numero sui 3 numeri del giro)', () => {
    assert.equal(SCAGLIONE_DEFAULT, 10)
    assert.equal(TETTO_FINESTRA_DEFAULT, 30)
})

test('finestre: mattina 09-13 e pomeriggio 15-19 di Roma, fuori = null', () => {
    // 30/10/2026: ora solare, Roma = UTC+1
    assert.equal(finestraCodaAlBot(new Date('2026-10-30T07:40:00Z')), null) // 08:40
    assert.equal(finestraCodaAlBot(new Date('2026-10-30T08:40:00Z'))?.nome, 'mattina') // 09:40
    assert.equal(finestraCodaAlBot(new Date('2026-10-30T11:40:00Z'))?.nome, 'mattina') // 12:40
    assert.equal(finestraCodaAlBot(new Date('2026-10-30T12:40:00Z')), null) // 13:40
    assert.equal(finestraCodaAlBot(new Date('2026-10-30T14:40:00Z'))?.nome, 'pomeriggio') // 15:40
    assert.equal(finestraCodaAlBot(new Date('2026-10-30T17:40:00Z'))?.nome, 'pomeriggio') // 18:40
    assert.equal(finestraCodaAlBot(new Date('2026-10-30T18:40:00Z')), null) // 19:40
    // ora legale: 09:40 di Roma = 07:40 UTC
    assert.equal(finestraCodaAlBot(new Date('2026-06-10T07:40:00Z'))?.nome, 'mattina')
})
