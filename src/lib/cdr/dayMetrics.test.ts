import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeDayMetrics, median } from './dayMetrics'

/** Accetta 'HH:MM' oppure 'HH:MM:SS' — i test sulle fasce hanno bisogno dei secondi. */
const at = (hms: string) => new Date(`2026-08-22T${hms.length === 5 ? hms + ':00' : hms}Z`)

test('lista vuota non produce metriche', () => {
    assert.equal(computeDayMetrics([]), null)
})

test('calcola finestra, tempo al telefono e tempo non telefonico', () => {
    // 13:00 dura 60s (30 di conversazione), 13:10 dura 120s (100 di conversazione)
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('13:10'), duration: 120, billsec: 100, disposition: 'ANSWERED' },
    ])!
    assert.equal(m.calls, 2)
    assert.equal(m.talkSeconds, 130)
    assert.equal(m.occupiedSeconds, 180)
    assert.equal(m.windowSeconds, 720)      // 13:00:00 -> 13:12:00
    assert.equal(m.offPhoneSeconds, 540)    // 720 - 180
})

test('il gap si misura dalla FINE della chiamata precedente', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('13:10'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
    ])!
    assert.deepEqual(m.gaps, [540])  // fine 13:01, inizio 13:10
})

test('scarta i gap negativi delle chiamate sovrapposte', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 600, billsec: 500, disposition: 'ANSWERED' },
        { calldate: at('13:05'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
    ])!
    assert.deepEqual(m.gaps, [])
})

test('ordina le chiamate anche se arrivano disordinate', () => {
    const m = computeDayMetrics([
        { calldate: at('14:00'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
        { calldate: at('13:00'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
    ])!
    assert.equal(m.firstAt.getTime(), at('13:00').getTime())
    assert.equal(m.windowSeconds, 3630)
})

test('conta le sole chiamate con risposta', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 30, billsec: 0, disposition: 'NO ANSWER' },
        { calldate: at('13:05'), duration: 60, billsec: 40, disposition: 'ANSWERED' },
        { calldate: at('13:10'), duration: 10, billsec: 0, disposition: 'BUSY' },
    ])!
    assert.equal(m.answered, 1)
})

test('la mediana funziona su liste pari e dispari', () => {
    assert.equal(median([10, 20, 30]), 20)
    assert.equal(median([10, 20, 30, 40]), 25)
    assert.equal(median([]), 0)
})

test('distribuisce i buchi nelle cinque fasce, per secondi totali', () => {
    // Chiamate di durata zero, così ogni buco è esattamente la distanza fra due orari.
    const m = computeDayMetrics([
        { calldate: at('13:00:00'), duration: 0, billsec: 0, disposition: 'NO ANSWER' },
        { calldate: at('13:00:30'), duration: 0, billsec: 0, disposition: 'NO ANSWER' }, // buco 30s
        { calldate: at('13:02:00'), duration: 0, billsec: 0, disposition: 'NO ANSWER' }, // buco 90s
        { calldate: at('13:12:00'), duration: 0, billsec: 0, disposition: 'NO ANSWER' }, // buco 600s
    ])!
    assert.equal(m.buckets.under1m, 30)
    assert.equal(m.buckets.m1to3, 90)
    assert.equal(m.buckets.m3to10, 0)
    assert.equal(m.buckets.m10to30, 600)   // 600 è il confine: appartiene alla fascia superiore
    assert.equal(m.buckets.over30m, 0)
})

test('la somma delle fasce corrisponde alla somma dei gap', () => {
    const m = computeDayMetrics([
        { calldate: at('13:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('13:05'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
        { calldate: at('14:00'), duration: 60, billsec: 30, disposition: 'ANSWERED' },
    ])!
    const sommaFasce = m.buckets.under1m + m.buckets.m1to3 + m.buckets.m3to10 + m.buckets.m10to30 + m.buckets.over30m
    assert.equal(sommaFasce, m.gaps.reduce((a, b) => a + b, 0))
})
