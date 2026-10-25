import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lemmas, jaccard, tooSimilar } from './similarity'

const sorted = (s: Set<string>) => [...s].sort()

test('lemmi: minuscole, accenti, apostrofi e parole vuote via', () => {
    assert.deepEqual(sorted(lemmas("L'amicizia è più forte del tempo.")), ['amicizi', 'fort', 'temp'])
    assert.deepEqual(sorted(lemmas('Perché? Perché sì!')), [])
})

test('lemmi: plurali e femminili collassano sulla stessa radice', () => {
    assert.deepEqual(sorted(lemmas('amico amici amica amiche')), ['amic'])
    assert.deepEqual(sorted(lemmas('lungo lunghi lunghe')), ['lung'])
    assert.equal(lemmas('Città CITTÀ citta').size, 1)
})

test('jaccard: identici 1, disgiunti 0, vuoti 0', () => {
    assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1)
    assert.equal(jaccard(new Set(['a', 'b']), new Set(['c'])), 0)
    assert.equal(jaccard(new Set(), new Set()), 0)
    assert.equal(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5)
})

test('troppo simili: la stessa frase in due versioni sì, frasi diverse sullo stesso tema no', () => {
    const a = 'La felicità della tua vita dipende dalla qualità dei tuoi pensieri.'
    const b = 'La felicità della vita dipende dalla qualità dei pensieri che hai.'
    const c = 'Non è perché le cose sono difficili che non osiamo, è perché non osiamo che sono difficili.'
    const d = 'La vita è breve, l’arte è lunga.'
    assert.equal(tooSimilar(lemmas(a), lemmas(b)), true)
    assert.equal(tooSimilar(lemmas(a), lemmas(c)), false)
    // una sola parola in comune ("vita") non basta
    assert.equal(tooSimilar(lemmas(a), lemmas(d)), false)
})

test('troppo simili: stessa struttura a pochi giorni (coppia vera delle bozze)', () => {
    const a = 'Il signore è calmo e sciolto; il volgo è sempre inquieto.'
    const b = 'Il signore cerca in se stesso. Il volgo cerca negli altri.'
    assert.equal(tooSimilar(lemmas(a), lemmas(b)), true)
    // due parole in comune su frasi lunghe e diverse restano accettabili
    const c = 'Il tempo che dedichi agli amici e alla famiglia non è mai tempo perso, anzi ritorna.'
    const d = 'Gli amici veri si vedono nel momento del bisogno, e la famiglia resta un porto sicuro.'
    assert.equal(tooSimilar(lemmas(c), lemmas(d)), false)
})
