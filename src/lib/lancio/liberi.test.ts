import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLancioLiberoLead } from './liberi'
import { LANCIO_WEBDEV } from './config'

const B = LANCIO_WEBDEV.bucket

test('chiamata subito e mattina del lancio sono liberi', () => {
    assert.equal(isLancioLiberoLead({ launchBucket: B, lancioScelta: 'chiamata_subito' }), true)
    assert.equal(isLancioLiberoLead({ launchBucket: B, lancioScelta: 'app_mattina' }), true)
})

test('pomeriggio, dopodomani e follow-up passano dalle Conferme: regole di sempre', () => {
    for (const s of ['app_pomeriggio', 'app_dopodomani', 'followup', null]) {
        assert.equal(isLancioLiberoLead({ launchBucket: B, lancioScelta: s }), false, String(s))
    }
})

test('fuori dal bucket del lancio niente eccezioni', () => {
    assert.equal(isLancioLiberoLead({ launchBucket: null, lancioScelta: 'chiamata_subito' }), false)
    assert.equal(isLancioLiberoLead({ launchBucket: 'ALTRO', lancioScelta: 'app_mattina' }), false)
})
