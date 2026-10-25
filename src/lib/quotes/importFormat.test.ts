import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseImportItem, collectItems, mapRoles } from './importFormat'

const citazione = {
    testo: 'Non abbiamo poco tempo, ma ne abbiamo perduto molto.',
    autore: 'Seneca',
    fonte: 'La brevità della vita (De brevitate vitae) 1,3',
    tema: 'tempo',
    originale: 'Non exiguum temporis habemus, sed multum perdidimus.',
    traduzione_fonte_url: 'https://it.wikiquote.org/wiki/Lucio_Anneo_Seneca',
    traduttore: 'Alfonso Traina',
    occasioni: ['inizio_anno', 'capodanno_cinese'],
    verified: true,
}

const consiglio = {
    frase: 'alla gente piace avere delle ragioni per quello che fa.',
    autore: 'Robert Cialdini',
    opera: 'Le armi della persuasione',
    riferimento: 'Cap. 1, p. 12',
    frase_fonte_url: 'https://example.org/estratto.pdf',
    traduttore: 'Gabriele Noferi',
    tecnica: 'Il potere del perché',
    consiglio: 'Ogni volta che chiedi qualcosa, dai la ragione vera.',
    ruoli: ['venditori', 'gdo'],
    tema: 'follow_up',
    uso: 'applica',
    fonte_consiglio_url: 'https://example.org/estratto.pdf#p12',
    verified: true,
}

test('citazione verificata: riga completa, occasioni sconosciute scartate con avviso', () => {
    const r = parseImportItem(citazione)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.row.kind, 'citazione')
    assert.equal(r.row.text, 'Non abbiamo poco tempo, ma ne abbiamo perduto molto.')
    assert.equal(r.row.author, 'Seneca')
    assert.equal(r.row.work, 'La brevità della vita (De brevitate vitae) 1,3')
    assert.equal(r.row.translationUrl, 'https://it.wikiquote.org/wiki/Lucio_Anneo_Seneca')
    assert.equal(r.row.translator, 'Alfonso Traina')
    assert.equal(r.row.originalText, 'Non exiguum temporis habemus, sed multum perdidimus.')
    assert.deepEqual(r.row.occasions, ['inizio_anno'])
    assert.deepEqual(r.row.roles, ['GDO', 'CONFERME', 'VENDITORE', 'ADMIN', 'MANAGER'])
    assert.equal(r.row.suggestedReflection, null)
    assert.equal(r.row.verified, true)
    assert.ok(r.warnings.some(w => w.includes('capodanno_cinese')))
})

test('citazione: solo verified === true entra', () => {
    assert.equal(parseImportItem({ ...citazione, verified: false }).ok, false)
    assert.equal(parseImportItem({ ...citazione, verified: 'true' }).ok, false)
    const { verified: _omesso, ...senza } = citazione
    assert.equal(parseImportItem(senza).ok, false)
})

test('citazione: senza URL della traduzione o senza opera si scarta; troppo lunga per 2 righe pure', () => {
    assert.equal(parseImportItem({ ...citazione, traduzione_fonte_url: '' }).ok, false)
    assert.equal(parseImportItem({ ...citazione, traduzione_fonte_url: 'wikiquote' }).ok, false)
    assert.equal(parseImportItem({ ...citazione, fonte: undefined }).ok, false)
    assert.equal(parseImportItem({ ...citazione, fonte: undefined, opera: 'Lettere a Lucilio' }).ok, true)
    assert.equal(parseImportItem({ ...citazione, testo: 'parola '.repeat(40) }).ok, false)
})

test('citazione: riflessione solo con la sua fonte', () => {
    const conFonte = parseImportItem({ ...citazione, riflessione: 'Il tempo è la sola cosa nostra.', riflessione_fonte_url: 'https://www.youtube.com/watch?v=abc' })
    assert.ok(conFonte.ok && conFonte.row.suggestedReflection === 'Il tempo è la sola cosa nostra.' && conFonte.row.reflectionSource === 'https://www.youtube.com/watch?v=abc')
    const senzaFonte = parseImportItem({ ...citazione, riflessione: 'Il tempo è la sola cosa nostra.' })
    assert.ok(senzaFonte.ok)
    if (!senzaFonte.ok) return
    assert.equal(senzaFonte.row.suggestedReflection, null)
    assert.ok(senzaFonte.warnings.some(w => w.includes('riflessione')))
})

test('id stabile: spazi e maiuscole non contano, autore diverso sì', () => {
    const a = parseImportItem(citazione)
    const b = parseImportItem({ ...citazione, testo: '  non abbiamo poco tempo,  ma ne abbiamo PERDUTO molto ' })
    const c = parseImportItem({ ...citazione, autore: 'Epitteto' })
    assert.ok(a.ok && b.ok && c.ok)
    if (!a.ok || !b.ok || !c.ok) return
    assert.equal(a.row.id, b.row.id)
    assert.notEqual(a.row.id, c.row.id)
})

test('vendita: ruoli mappati sul CRM (più ADMIN), consiglio nella bozza, tecnica e uso salvati', () => {
    const r = parseImportItem(consiglio)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.row.kind, 'vendita')
    assert.deepEqual(r.row.roles, ['GDO', 'VENDITORE', 'ADMIN'])
    assert.equal(r.row.text, 'alla gente piace avere delle ragioni per quello che fa.')
    assert.equal(r.row.translationUrl, 'https://example.org/estratto.pdf')
    assert.equal(r.row.reference, 'Cap. 1, p. 12')
    assert.equal(r.row.suggestedReflection, 'Ogni volta che chiedi qualcosa, dai la ragione vera.')
    assert.equal(r.row.reflectionSource, 'https://example.org/estratto.pdf#p12')
    assert.equal(r.row.technique, 'Il potere del perché')
    assert.equal(r.row.usage, 'applica')
    assert.equal(r.row.theme, 'follow_up')
    assert.deepEqual(r.row.occasions, [])
})

test('vendita: senza frase va bene se c’è la tecnica; senza consiglio, fonte o con ruolo sconosciuto no', () => {
    const senzaFrase = parseImportItem({ ...consiglio, frase: '', frase_fonte_url: '' })
    assert.ok(senzaFrase.ok && senzaFrase.row.text === '' && senzaFrase.row.translationUrl === null)
    assert.equal(parseImportItem({ ...consiglio, frase: '', tecnica: '' }).ok, false)
    assert.equal(parseImportItem({ ...consiglio, consiglio: ' ' }).ok, false)
    assert.equal(parseImportItem({ ...consiglio, fonte_consiglio_url: '' }).ok, false)
    assert.equal(parseImportItem({ ...consiglio, frase_fonte_url: '' }).ok, false)
    assert.equal(parseImportItem({ ...consiglio, ruoli: ['gdo', 'marketing'] }).ok, false)
    assert.equal(parseImportItem({ ...consiglio, ruoli: [] }).ok, false)
})

test('ruoli: tutti e tre i reparti, ordine fisso', () => {
    assert.deepEqual(mapRoles(['conferme', 'venditori', 'gdo']), { ok: true, roles: ['GDO', 'CONFERME', 'VENDITORE', 'ADMIN'] })
    assert.deepEqual(mapRoles(['GDO']), { ok: true, roles: ['GDO', 'ADMIN'] })
    assert.equal(mapRoles(['tutti']).ok, false)
})

test('file: array diretto o dentro un oggetto; il resto non è un elenco', () => {
    assert.equal(collectItems([1, 2]).length, 2)
    assert.equal(collectItems({ citazioni: [1, 2, 3] }).length, 3)
    assert.equal(collectItems({ nome: 'x' }).length, 0)
    assert.equal(collectItems(null).length, 0)
    assert.equal(parseImportItem({ nome: 'x', verified: true }).ok, false)
})
