import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    leggiConfigCodaAlBot, spostabileAlBot, pianificaCodaAlBot, funnelPerIlBot,
    SCAGLIONE_DEFAULT, TETTO_GIORNALIERO_DEFAULT, type CandidatoCoda,
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
    assert.equal(leggiConfigCodaAlBot({}).tettoGiornaliero, TETTO_GIORNALIERO_DEFAULT)
})

test('config: un valore illeggibile vale il ripiego, mai mille lead in un colpo', () => {
    assert.equal(leggiConfigCodaAlBot({ MKT_CODA_BOT_DAILY: '9999' }).tettoGiornaliero, TETTO_GIORNALIERO_DEFAULT)
    assert.equal(leggiConfigCodaAlBot({ MKT_CODA_BOT_BATCH: 'abc' }).scaglione, SCAGLIONE_DEFAULT)
    assert.equal(leggiConfigCodaAlBot({ MKT_CODA_BOT_DAILY: '40' }).tettoGiornaliero, 40)
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

test('piano: scaglione e tetto del giorno, il più stretto vince', () => {
    const cfg = { attivo: true, scaglione: 5, tettoGiornaliero: 30 }
    const tanti = Array.from({ length: 20 }, (_, i) => c(`l${i}`))
    assert.deepEqual(pianificaCodaAlBot({ candidati: tanti, config: cfg, giaOggi: 0 }).daSpostare, ['l0', 'l1', 'l2', 'l3', 'l4'])
    assert.equal(pianificaCodaAlBot({ candidati: tanti, config: cfg, giaOggi: 28 }).daSpostare.length, 2)
    const pieno = pianificaCodaAlBot({ candidati: tanti, config: cfg, giaOggi: 30 })
    assert.equal(pieno.motivo, 'tetto_raggiunto')
    assert.equal(pieno.daSpostare.length, 0)
})

test('piano: spento non sposta niente, i non spostabili non contano', () => {
    assert.equal(pianificaCodaAlBot({ candidati: [c('a')], config: { attivo: false, scaglione: 5, tettoGiornaliero: 30 }, giaOggi: 0 }).motivo, 'spento')
    const p = pianificaCodaAlBot({ candidati: [c('a', { toccatoDalBot: true }), c('b')], config: { attivo: true, scaglione: 5, tettoGiornaliero: 30 }, giaOggi: 0 })
    assert.deepEqual(p.daSpostare, ['b'])
})

test('funnel: i nomi del marketing diventano quelli di ActiveCampaign', () => {
    assert.equal(funnelPerIlBot('corso10ore'), 'CORSO 10 ORE')
    assert.equal(funnelPerIlBot('jobsimulator'), 'JOB SIMULATOR')
    assert.equal(funnelPerIlBot('telegram'), 'TELEGRAM')
    assert.equal(funnelPerIlBot('sconosciuto'), 'sconosciuto')
    assert.equal(funnelPerIlBot(null), null)
})
