import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shownCitazione, shownVendita, buildTodayQuotes, countLines, type DisplayRow } from './display'

const ALL = ['GDO', 'CONFERME', 'VENDITORE', 'ADMIN', 'MANAGER']

function row(over: Partial<DisplayRow> = {}): DisplayRow {
    return {
        kind: 'citazione', text: 'Non abbiamo poco tempo, ma ne abbiamo perduto molto.', author: 'Seneca',
        work: 'La brevità della vita', technique: null, roles: ALL, isActive: true,
        approved: false, reflection: null, ...over,
    }
}

test('citazione: senza approvazione solo testo e autore', () => {
    assert.deepEqual(shownCitazione(row({ reflection: 'bozza già scritta' }), 'GDO'), {
        text: 'Non abbiamo poco tempo, ma ne abbiamo perduto molto.', author: 'Seneca', deepen: null,
    })
})

test('citazione: approvata con riflessione, l’approfondimento porta opera e riflessione', () => {
    const shown = shownCitazione(row({ approved: true, reflection: '  Ogni chiamata è tempo che non torna.  ' }), 'CONFERME')
    assert.deepEqual(shown?.deepen, { work: 'La brevità della vita', text: 'Ogni chiamata è tempo che non torna.' })
})

test('citazione: approvata ma senza riflessione, niente approfondimento', () => {
    assert.equal(shownCitazione(row({ approved: true, reflection: '   ' }), 'GDO')?.deepen, null)
})

test('citazione: disattivata o ruolo escluso non si vede; l’admin vede sempre', () => {
    assert.equal(shownCitazione(row({ isActive: false }), 'GDO'), null)
    assert.equal(shownCitazione(row({ roles: ['VENDITORE'] }), 'GDO'), null)
    assert.equal(shownCitazione(row({ roles: ['VENDITORE'] }), null), null)
    assert.notEqual(shownCitazione(row({ roles: ['VENDITORE'] }), 'ADMIN'), null)
})

const vendita = (over: Partial<DisplayRow> = {}) => row({
    kind: 'vendita', text: 'Alla gente piace avere delle ragioni per quello che fa.', author: 'Robert Cialdini',
    work: 'Le armi della persuasione', technique: 'Il potere del perché', roles: ['GDO', 'CONFERME', 'ADMIN'], ...over,
})

test('vendita: senza approvazione solo la frase; senza frase niente consiglio', () => {
    assert.deepEqual(shownVendita(vendita({ reflection: 'consiglio in bozza' }), 'GDO'), {
        text: 'Alla gente piace avere delle ragioni per quello che fa.', author: 'Robert Cialdini', deepen: null,
    })
    assert.equal(shownVendita(vendita({ text: '' }), 'GDO'), null)
})

test('vendita: approvata, il consiglio sta nell’approfondimento; senza frase il titolo è la tecnica', () => {
    const conFrase = shownVendita(vendita({ approved: true, reflection: 'Dai sempre il perché vero.' }), 'CONFERME')
    assert.equal(conFrase?.text, 'Alla gente piace avere delle ragioni per quello che fa.')
    assert.deepEqual(conFrase?.deepen, { work: 'Le armi della persuasione', text: 'Dai sempre il perché vero.' })
    const senzaFrase = shownVendita(vendita({ text: ' ', approved: true, reflection: 'Dai sempre il perché vero.' }), 'GDO')
    assert.equal(senzaFrase?.text, 'Il potere del perché')
    assert.equal(senzaFrase?.author, 'Robert Cialdini')
})

test('vendita: approvata ma vuota e senza frase, niente; ruolo escluso, niente', () => {
    assert.equal(shownVendita(vendita({ text: '', approved: true, reflection: '' }), 'GDO'), null)
    assert.equal(shownVendita(vendita(), 'VENDITORE'), null)
})

test('giornata: una citazione e un consiglio per tipo, il resto si ignora', () => {
    const today = buildTodayQuotes('2026-10-26', [row(), vendita(), row({ kind: 'altro' })], 'GDO')
    assert.equal(today.day, '2026-10-26')
    assert.equal(today.citazione?.author, 'Seneca')
    assert.equal(today.vendita?.author, 'Robert Cialdini')
    assert.deepEqual(buildTodayQuotes('2026-10-26', [], 'GDO'), { day: '2026-10-26', citazione: null, vendita: null })
})

test('righe: a capo per parola a 90 caratteri, righe vuote contate', () => {
    const word = 'abcdefghi'                      // 9 lettere: 9 parole = 89 caratteri
    assert.equal(countLines(''), 0)
    assert.equal(countLines('ciao'), 1)
    assert.equal(countLines(Array(9).fill(word).join(' ')), 1)
    assert.equal(countLines(Array(10).fill(word).join(' ')), 2)
    assert.equal(countLines(Array(19).fill(word).join(' ')), 3)
    assert.equal(countLines('uno\n\ndue'), 3)
    assert.equal(countLines('x'.repeat(200)), 3)
})

test('spiegazione spenta dall’admin: citazione e consiglio restano, senza approfondimento', () => {
    const citazione = shownCitazione(row({ approved: true, reflection: 'Riflessione', showReflection: false }), 'GDO')
    assert.equal(citazione?.text, 'Non abbiamo poco tempo, ma ne abbiamo perduto molto.')
    assert.equal(citazione?.deepen, null)
    const vendita = shownVendita(row({ kind: 'vendita', text: 'Chi fa domande guida.', approved: true, reflection: 'Consiglio', showReflection: false }), 'GDO')
    assert.deepEqual(vendita, { text: 'Chi fa domande guida.', author: 'Seneca', deepen: null })
    // senza frase e con il consiglio spento, quel giorno non c'è consiglio
    assert.equal(shownVendita(row({ kind: 'vendita', text: '', technique: 'Tecnica', approved: true, reflection: 'Consiglio', showReflection: false }), 'GDO'), null)
})
