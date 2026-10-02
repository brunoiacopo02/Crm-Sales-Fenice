import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_NOTE_CHARS, MAX_RISPOSTA_CHARS, MAX_RISPOSTE, parseInfo, parseNote } from './payload'

// `info` e `note` arrivano da una chat e finiscono su colonne che la pagina
// /lancio e la scheda venditore renderizzano: qui si copre il confine.

test('info assente o senza risposte: niente da scrivere, nessun errore', () => {
    assert.deepEqual(parseInfo(undefined), { ok: true })
    assert.deepEqual(parseInfo(null), { ok: true })
    assert.deepEqual(parseInfo({}), { ok: true })
    assert.deepEqual(parseInfo({ risposte: null, altro: 'ignorato' }), { ok: true })
})

test('risposte vuote: nessuna info, non si cancella quella gia raccolta', () => {
    // `lancioBotInfo` si sovrascrive per intero: scrivere `{ risposte: [] }`
    // sbianchettarebbe le risposte del giro precedente.
    assert.deepEqual(parseInfo({ risposte: [] }), { ok: true })
    assert.deepEqual(parseInfo({ risposte: ['', '   ', '\n'] }), { ok: true })
})

test('info non valida: 400, non si salva a meta', () => {
    assert.equal(parseInfo('ciao').ok, false)
    assert.equal(parseInfo([1, 2]).ok, false)
    assert.equal(parseInfo({ risposte: 'una sola' }).ok, false)
    assert.equal(parseInfo({ risposte: ['ok', 42] }).ok, false)
})

test('le risposte si salvano pulite, tagliate e contate', () => {
    const lunga = 'x'.repeat(MAX_RISPOSTA_CHARS + 50)
    const troppe = Array.from({ length: MAX_RISPOSTE + 3 }, (_, i) => `r${i}`)
    const out = parseInfo({ risposte: ['  spazi  ', '', '   ', lunga, ...troppe] })
    assert.equal(out.ok, true)
    const risposte = (out as { ok: true; info?: { risposte?: string[] } }).info?.risposte ?? []
    assert.equal(risposte.length, MAX_RISPOSTE)
    // Si tengono le ULTIME MAX_RISPOSTE: le prime (anche 'spazi' e la lunga) cadono.
    assert.deepEqual(risposte, ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14'].slice(-MAX_RISPOSTE))
    // Si scrive SOLO `risposte`: le chiavi in piu' non entrano nel jsonb.
    assert.deepEqual(Object.keys((out as { ok: true; info?: object }).info ?? {}), ['risposte'])
})

test('una risposta lunga viene tagliata e le spaziature tolte', () => {
    const lunga = 'x'.repeat(MAX_RISPOSTA_CHARS + 50)
    const out = parseInfo({ risposte: ['  spazi  ', '', '   ', lunga] })
    const risposte = (out as { ok: true; info?: { risposte?: string[] } }).info?.risposte ?? []
    assert.equal(risposte[0], 'spazi')
    assert.equal(risposte[1].length, MAX_RISPOSTA_CHARS)
    assert.equal(risposte.length, 2)
})

test('note: stringa, e non un romanzo', () => {
    assert.deepEqual(parseNote(undefined), { ok: true })
    assert.deepEqual(parseNote('richiamare dopo cena'), { ok: true, note: 'richiamare dopo cena' })
    assert.equal(parseNote(12).ok, false)
    assert.equal(parseNote('x'.repeat(MAX_NOTE_CHARS + 1)).ok, false)
    assert.equal(parseNote('x'.repeat(MAX_NOTE_CHARS)).ok, true)
})

test('accetta fino a 12 risposte, tenendo le ultime', () => {
    const r = parseInfo({ risposte: Array.from({ length: 14 }, (_, i) => `r${i}`) })
    assert.equal(r.ok && r.info?.risposte?.length, 12)
    assert.equal(r.ok && r.info?.risposte?.[0], 'r2')
    assert.equal(r.ok && r.info?.risposte?.[11], 'r13')
})
