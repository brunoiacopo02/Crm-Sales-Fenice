import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    isCallNowHandoff, isLeadLancio, lancioBotRisposte, lancioFirst, lancioPriority, lancioSceltaLabel,
    type LancioConfermeFields,
} from './conferme'

const BUCKET = 'LANCIO_WEBDEV_2026'

function lead(over: Partial<LancioConfermeFields> = {}): LancioConfermeFields {
    return {
        launchBucket: BUCKET, status: 'APPOINTMENT', lancioScelta: 'app_pomeriggio',
        lancioCallNowAttempts: 0, salespersonUserId: null, confirmationsOutcome: null,
        ...over,
    }
}

test('isLeadLancio: bucket del lancio e status APPOINTMENT', () => {
    assert.equal(isLeadLancio(lead()), true)
    assert.equal(isLeadLancio(lead({ launchBucket: 'BLACK_SUMMER' })), false)
    assert.equal(isLeadLancio(lead({ launchBucket: null })), false)
    assert.equal(isLeadLancio(lead({ status: 'NEW' })), false)
    assert.equal(isLeadLancio(lead({ launchBucket: 'ALTRO' }), 'ALTRO'), true)
})

test('isCallNowHandoff: chiamata subito, tre tentativi, senza venditore', () => {
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 3, salespersonUserId: null })), true)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 3, salespersonUserId: 'v1' })), false)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 2, salespersonUserId: null })), false)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'app_pomeriggio', lancioCallNowAttempts: 3, salespersonUserId: null })), false)
    assert.equal(isCallNowHandoff(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: null, salespersonUserId: null })), false)
})

test('lancioPriority: pomeriggio, dopodomani e passaggio A1 vanno in cima; mattina, esitati e non-lancio no', () => {
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_pomeriggio' })), 1)
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_dopodomani' })), 1)
    assert.equal(lancioPriority(lead({ lancioScelta: 'chiamata_subito', lancioCallNowAttempts: 3, salespersonUserId: null })), 1)
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_mattina', confirmationsOutcome: 'confermato', salespersonUserId: 'v1' })), 0)
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_pomeriggio', confirmationsOutcome: 'scartato' })), 0)
    assert.equal(lancioPriority(lead({ lancioScelta: 'followup' })), 0)
    assert.equal(lancioPriority(lead({ lancioScelta: null })), 0)
    assert.equal(lancioPriority(lead({ launchBucket: null })), 0)
    assert.equal(lancioPriority(lead({ status: 'NEW' })), 0)
})

test('lancioFirst: i lancio in cima, ordine di arrivo conservato dentro i gruppi, input non mutato', () => {
    const rows = [
        { lead: { ...lead({ launchBucket: null }), id: 'n1' } },
        { lead: { ...lead({ lancioScelta: 'app_dopodomani' }), id: 'l1' } },
        { lead: { ...lead({ launchBucket: null }), id: 'n2' } },
        { lead: { ...lead({ lancioScelta: 'app_pomeriggio' }), id: 'l2' } },
        { lead: { ...lead({ lancioScelta: 'app_mattina', confirmationsOutcome: 'confermato' }), id: 'm1' } },
    ]
    const out = lancioFirst(rows)
    assert.deepEqual(out.map(r => r.lead.id), ['l1', 'l2', 'n1', 'n2', 'm1'])
    assert.deepEqual(rows.map(r => r.lead.id), ['n1', 'l1', 'n2', 'l2', 'm1'])
    assert.deepEqual(lancioFirst([]), [])
})

test('lancioSceltaLabel: una frase per scelta, il passaggio A1 vince sulla scelta', () => {
    assert.match(lancioSceltaLabel('app_pomeriggio'), /pomeriggio/i)
    assert.match(lancioSceltaLabel('app_dopodomani'), /dopodomani/i)
    assert.match(lancioSceltaLabel('app_mattina'), /nessuna chiamata/i)
    assert.match(lancioSceltaLabel('chiamata_subito'), /venditore/i)
    assert.match(lancioSceltaLabel('chiamata_subito', true), /tre chiamate a vuoto/i)
    assert.match(lancioSceltaLabel('followup'), /follow-up/i)
    assert.match(lancioSceltaLabel(null), /lancio/i)
})

test('lancioBotRisposte: solo stringhe non vuote, in ordine, da un jsonb qualunque', () => {
    assert.deepEqual(lancioBotRisposte({ risposte: [' faccio il barista ', '', 'mi ha colpito lo stipendio', 3] }), ['faccio il barista', 'mi ha colpito lo stipendio'])
    assert.deepEqual(lancioBotRisposte({ risposte: 'no' }), [])
    assert.deepEqual(lancioBotRisposte({ altro: true }), [])
    assert.deepEqual(lancioBotRisposte(null), [])
    assert.deepEqual(lancioBotRisposte(undefined), [])
    assert.deepEqual(lancioBotRisposte('testo'), [])
    assert.deepEqual(lancioBotRisposte(['a', 'b']), [])
})
