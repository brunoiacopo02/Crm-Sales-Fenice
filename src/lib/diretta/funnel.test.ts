import { test } from 'node:test'
import assert from 'node:assert/strict'
import { funnelLeggibile } from './funnel'

test('funnel noti: nomi in chiaro, qualunque grafia arrivi dal DB', () => {
    assert.equal(funnelLeggibile('CORSO 10 ORE'), 'Corso 10 ore')
    assert.equal(funnelLeggibile('corso10ore'), 'Corso 10 ore')
    assert.equal(funnelLeggibile('Corso 10h'), 'Corso 10 ore')
    assert.equal(funnelLeggibile('CORSO10ORE-TK'), 'Corso 10 ore TK')
    assert.equal(funnelLeggibile('JOB SIMULATOR'), 'Job Simulator')
    assert.equal(funnelLeggibile('jobsimulator'), 'Job Simulator')
    assert.equal(funnelLeggibile('TELEGRAM'), 'Telegram')
    assert.equal(funnelLeggibile('telegram'), 'Telegram')
    assert.equal(funnelLeggibile('TELEGRAM-TK'), 'Telegram TK')
    assert.equal(funnelLeggibile('GOOGLE'), 'Google')
    assert.equal(funnelLeggibile('Database'), 'Database')
    assert.equal(funnelLeggibile('Black Summer'), 'Black Summer')
})

test('funnel sconosciuti: caso frase, sigle corte in maiuscolo, mai tutto maiuscolo', () => {
    assert.equal(funnelLeggibile('LEAD BF 2024'), 'Lead BF 2024')
    assert.equal(funnelLeggibile('SMM'), 'SMM')
    assert.equal(funnelLeggibile('NUOVO FUNNEL AUTUNNO'), 'Nuovo funnel autunno')
    assert.equal(funnelLeggibile('TELEGRAM 02/06/2025'), 'Telegram 02/06/2025')
    assert.equal(funnelLeggibile(null), null)
    assert.equal(funnelLeggibile('   '), null)
})
