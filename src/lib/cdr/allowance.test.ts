import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    workAllowanceSec,
    ALLOWANCE_NO_VALUE_SEC,
    ALLOWANCE_RICHIAMO_SEC,
    ALLOWANCE_APPUNTAMENTO_SEC,
} from './allowance'

// L'abbuono dipende da COSA c'era da scrivere dopo la telefonata, non dalla
// durata del buco. Valori fissati dal committente il 2026-08-26.

test('nessuno ha risposto: 9 secondi, non c e nulla da annotare', () => {
    assert.equal(workAllowanceSec(0, null), ALLOWANCE_NO_VALUE_SEC)
    assert.equal(workAllowanceSec(0, 'NON_RISPOSTO'), 9)
})

test('nessuno ha risposto: 9 secondi anche se il CRM registra un esito pesante', () => {
    // Non c e stata conversazione: qualunque cosa sia finita nel CRM, non c era
    // niente da trascrivere. Serve a non premiare l esito registrato a vuoto.
    assert.equal(workAllowanceSec(0, 'APPUNTAMENTO'), 9)
    assert.equal(workAllowanceSec(0, 'RICHIAMO'), 9)
})

test('appuntamento preso: 80 secondi, e l unico esito che richiede tempo vero', () => {
    assert.equal(workAllowanceSec(120, 'APPUNTAMENTO'), ALLOWANCE_APPUNTAMENTO_SEC)
    assert.equal(workAllowanceSec(120, 'APPUNTAMENTO'), 80)
})

test('richiamo fissato: 30 secondi', () => {
    assert.equal(workAllowanceSec(45, 'RICHIAMO'), ALLOWANCE_RICHIAMO_SEC)
})

test('ha risposto ma non se ne fa nulla: 9 secondi', () => {
    assert.equal(workAllowanceSec(45, 'DA_SCARTARE'), 9)
    assert.equal(workAllowanceSec(45, 'NON_RISPOSTO'), 9)
})

test('esito non ritrovato: si usa l abbuono minimo, mai il piu generoso', () => {
    assert.equal(workAllowanceSec(45, null), 9)
    assert.equal(workAllowanceSec(45, 'ESITO_CHE_NON_ESISTE'), 9)
})

test('billsec negativo (dato sporco) vale come nessuna risposta', () => {
    assert.equal(workAllowanceSec(-1, 'APPUNTAMENTO'), 9)
})
