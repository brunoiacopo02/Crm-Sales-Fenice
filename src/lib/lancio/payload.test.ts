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
    assert.equal(risposte[0], 'spazi')
    assert.equal(risposte[1].length, MAX_RISPOSTA_CHARS)
    // Si scrive SOLO `risposte`: le chiavi in piu' non entrano nel jsonb.
    assert.deepEqual(Object.keys((out as { ok: true; info?: object }).info ?? {}), ['risposte'])
})

test('note: stringa, e non un romanzo', () => {
    assert.deepEqual(parseNote(undefined), { ok: true })
    assert.deepEqual(parseNote('richiamare dopo cena'), { ok: true, note: 'richiamare dopo cena' })
    assert.equal(parseNote(12).ok, false)
    assert.equal(parseNote('x'.repeat(MAX_NOTE_CHARS + 1)).ok, false)
    assert.equal(parseNote('x'.repeat(MAX_NOTE_CHARS)).ok, true)
})
