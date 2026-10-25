import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diProva, erroreMondoDiverso, senzaMarcatore, stessoMondo } from './regole'
import { contaNeiKpi } from '@/lib/intakeBatch'
import { isRealGdo, isStatsGdo } from '@/lib/kpi/canon'

test('diProva: solo isTest === true', () => {
    assert.equal(diProva({ isTest: true }), true)
    assert.equal(diProva({ isTest: false }), false)
    assert.equal(diProva({ isTest: null }), false)
    assert.equal(diProva({}), false)
    assert.equal(diProva(null), false)
    assert.equal(diProva(undefined), false)
})

test('stessoMondo: prova con prova, vero con vero, mai incrociati', () => {
    assert.equal(stessoMondo({ isTest: true }, { isTest: true }), true)
    assert.equal(stessoMondo({ isTest: false }, { isTest: false }), true)
    assert.equal(stessoMondo({ isTest: true }, { isTest: false }), false)   // un vero non tocca la prova
    assert.equal(stessoMondo({ isTest: false }, { isTest: true }), false)   // la prova non tocca un vero
    // Senza marcatore si è veri: un account senza riga resta fuori dalla prova.
    assert.equal(stessoMondo({ isTest: false }, {}), true)
    assert.equal(stessoMondo({ isTest: true }, {}), false)
})

test('erroreMondoDiverso: il messaggio dice da che parte sta chi agisce', () => {
    assert.match(erroreMondoDiverso({ isTest: true }), /account di prova si lavorano solo i lead di prova/)
    assert.match(erroreMondoDiverso({ isTest: false }), /lead di prova/)
})

test('senzaMarcatore: la pulizia trova ogni riga senza isTest', () => {
    const righe = [{ id: 'a', isTest: true }, { id: 'b', isTest: false }, { id: 'c', isTest: null }, { id: 'd' }]
    assert.deepEqual(senzaMarcatore(righe).map(r => r.id), ['b', 'c', 'd'])
    assert.deepEqual(senzaMarcatore([{ id: 'a', isTest: true }]), [])
})

test('KPI: un lead di prova non conta mai, nemmeno col funnel Database', () => {
    assert.equal(contaNeiKpi({ isTest: true, intakeBatch: null, funnel: 'CORSO 10 ORE' }), false)
    assert.equal(contaNeiKpi({ isTest: true, intakeBatch: 'DB_LISTA133_20260915', funnel: 'Database' }), false)
    assert.equal(contaNeiKpi({ isTest: false, intakeBatch: null, funnel: 'CORSO 10 ORE' }), true)
    // La regola delle infornate resta quella di prima.
    assert.equal(contaNeiKpi({ isTest: false, intakeBatch: 'DB_LISTA133_20260915', funnel: 'CORSO 10 ORE' }), false)
    assert.equal(contaNeiKpi({ isTest: false, intakeBatch: 'DB_LISTA133_20260915', funnel: 'Database' }), true)
})

test('rose dei KPI: l\'account di prova non è un GDO vero', () => {
    const gdo = { role: 'GDO', isActive: true, isBot: false, isTest: false, statsActive: true }
    assert.equal(isRealGdo(gdo), true)
    assert.equal(isStatsGdo(gdo), true)
    assert.equal(isRealGdo({ ...gdo, isTest: true }), false)
    assert.equal(isStatsGdo({ ...gdo, isTest: true }), false)
})
