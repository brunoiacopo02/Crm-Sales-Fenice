import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    parseLeaderboardMode, ordinaClassifica, primiTre, mancaPerSalire,
    feniciDellaSettimana, blocchiSquadra, fasePunta, fraseScalini, buildSquadraView,
    type MembroSquadra, type SquadraSnapshot,
} from './squadra'

const m = (id: string, nome: string, presenze: number, fissati = 0): MembroSquadra =>
    ({ id, nome, presenze, fissati, immagine: null, cornice: false, titolo: null })

test('modalità classifica: top3 di default, valori sconosciuti tornano al default', () => {
    assert.equal(parseLeaderboardMode(null), 'top3')
    assert.equal(parseLeaderboardMode(''), 'top3')
    assert.equal(parseLeaderboardMode('completa'), 'completa')
    assert.equal(parseLeaderboardMode(' nessuna '), 'nessuna')
    assert.equal(parseLeaderboardMode('tutti'), 'top3')
})

test('ordine: presenze, poi il nome; i fissati non spareggiano', () => {
    const o = ordinaClassifica([m('1', 'Zora', 3, 30), m('2', 'Anthony', 5, 1), m('3', 'Beatrice', 3, 12), m('4', 'Alessandro', 3, 2)])
    assert.deepEqual(o.map(x => x.nome), ['Anthony', 'Alessandro', 'Beatrice', 'Zora'])
})

test('primi tre: solo chi ha almeno una presenza', () => {
    const o = ordinaClassifica([m('1', 'A', 2), m('2', 'B', 0), m('3', 'C', 1)])
    assert.deepEqual(primiTre(o).map(x => x.id), ['1', '3'])
    assert.deepEqual(primiTre(ordinaClassifica([m('1', 'A', 0)])), [])
})

test('distanza: quante presenze per raggiungere chi sta subito sopra (a pari merito si sale)', () => {
    const o = ordinaClassifica([m('a', 'A', 6), m('b', 'B', 5), m('c', 'C', 5), m('d', 'D', 3), m('e', 'E', 1), m('f', 'F', 0)])
    assert.equal(mancaPerSalire(o, 'd'), 2)      // è 4°: con 2 in più pareggia B e C e sale al 2° pari merito
    assert.equal(mancaPerSalire(o, 'e'), 2)      // D ne ha 3: con 2 in più lo pareggia
    assert.equal(mancaPerSalire(o, 'f'), 1)
    assert.equal(mancaPerSalire(o, 'b'), null)   // è sul podio
    assert.equal(mancaPerSalire(o, 'x'), null)   // non è in squadra
    // tutti a pari merito: tutti sul podio, nessuna distanza
    const p = ordinaClassifica([m('a', 'A', 4), m('b', 'B', 4), m('c', 'C', 4), m('d', 'D', 4, 0)])
    assert.equal(mancaPerSalire(p, 'd'), null)
    // nessuno ha presenze: niente podio, niente distanza
    assert.equal(mancaPerSalire(ordinaClassifica([m('a', 'A', 0), m('b', 'B', 0), m('c', 'C', 0), m('d', 'D', 0)]), 'd'), null)
})

test('Fenici della settimana: oltre la soglia, in ordine alfabetico', () => {
    const f = feniciDellaSettimana([m('1', 'Zora', 5), m('2', 'anthony', 7), m('3', 'Riccardo', 4)], 4)
    assert.deepEqual(f.map(x => x.nome), ['anthony', 'Zora'])
})

test('blocchi della squadra: da 5 sopra i 20, da 1 sotto', () => {
    const b = blocchiSquadra(47, [55, 65])
    assert.equal(b.blocchi.length, 13)
    assert.deepEqual(b.blocchi.slice(0, 11), [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.4, 0])
    assert.equal(b.primoScalinoIndex, 10)
    assert.equal(b.unita, 5)
    assert.ok(blocchiSquadra(70, [55, 65]).blocchi.every(x => x === 1))
    assert.ok(blocchiSquadra(0, [55, 65]).blocchi.every(x => x === 0))
    const p = blocchiSquadra(9, [14, 20])
    assert.equal(p.blocchi.length, 20)
    assert.equal(p.unita, 1)
    assert.equal(p.blocchi.filter(x => x === 1).length, 9)
    assert.equal(p.primoScalinoIndex, 13)
})

test('frase degli scalini', () => {
    assert.equal(fraseScalini(47, [55, 65]), 'Mancano 8 al primo scalino.')
    assert.equal(fraseScalini(54, [55, 65]), 'Manca 1 al primo scalino.')
    assert.equal(fraseScalini(55, [55, 65]), 'Primo scalino raggiunto, mancano 10 al secondo.')
    assert.equal(fraseScalini(64, [55, 65]), 'Primo scalino raggiunto, manca 1 al secondo.')
    assert.equal(fraseScalini(66, [55, 65]), 'Secondo scalino raggiunto.')
})

test('fase dell ora di punta', () => {
    const s = new Date('2026-10-26T17:00:00Z')
    const e = new Date('2026-10-26T18:00:00Z')
    assert.equal(fasePunta(new Date('2026-10-26T16:59:59Z'), s, e), 'prima')
    assert.equal(fasePunta(s, s, e), 'durante')
    assert.equal(fasePunta(e, s, e), 'dopo')
})

const snap = (mode: 'top3' | 'completa' | 'nessuna'): SquadraSnapshot => ({
    day: '2026-10-26',
    squadraOggi: 30,
    scaliniSquadra: [55, 65],
    punta: null,
    sogliaFenici: 4,
    mode,
    membri: [m('a', 'Anthony', 6, 20), m('z', 'Zora', 5, 18), m('r', 'Riccardo', 2, 9), m('n', 'Noemi', 1, 4), m('l', 'Lorenzo', 0, 0)],
    premiEuro: [50, 25, 10],
    minPresenze: 1,
    settimana: { lunedi: '2026-10-26', sabato: '2026-10-31' },
})

test('vista top3: podio, distanza di chi guarda, nessun numero degli altri', () => {
    const v = buildSquadraView(snap('top3'), 'n')
    assert.deepEqual(v.primiTre.map(x => [x.posizione, x.nome, x.presenze, x.premio]), [[1, 'Anthony', 6, 50], [2, 'Zora', 5, 25], [3, 'Riccardo', 2, 10]])
    assert.deepEqual(v.settimana, { lunedi: '2026-10-26', sabato: '2026-10-31' })
    assert.equal(v.mancaPerSalire, 1)   // Riccardo ne ha 2: con una in più lo pareggia
    assert.deepEqual(v.classifica, [])
    assert.deepEqual(v.fenici.map(x => x.nome), ['Anthony', 'Zora'])
    assert.ok(!('presenze' in v.fenici[0]))
    assert.equal(v.sonoInSquadra, true)
    // chi è sul podio si vede marcato e non riceve la distanza
    const a = buildSquadraView(snap('top3'), 'a')
    assert.equal(a.mancaPerSalire, null)
    assert.equal(a.primiTre[0].tu, true)
})

test('vista completa e nessuna', () => {
    const c = buildSquadraView(snap('completa'), 'l')
    assert.deepEqual(c.classifica.map(x => x.nome), ['Anthony', 'Zora', 'Riccardo', 'Noemi', 'Lorenzo'])
    assert.equal(c.classifica[4].tu, true)
    assert.deepEqual(c.primiTre, [])
    assert.equal(c.mancaPerSalire, null)
    const n = buildSquadraView(snap('nessuna'), 'l')
    assert.deepEqual(n.primiTre, [])
    assert.deepEqual(n.classifica, [])
    assert.equal(n.mancaPerSalire, null)
    assert.deepEqual(n.fenici.map(x => x.nome), ['Anthony', 'Zora'])
    // chi non è in squadra (Conferme) vede tutto tranne la sua distanza
    assert.equal(buildSquadraView(snap('top3'), 'conferme-1').sonoInSquadra, false)
})

test('podio: a pari presenze stessa posizione e premi sommati e divisi', () => {
    const s = snap('top3')
    s.membri = [m('a', 'Zora', 4, 10), m('b', 'Anthony', 4, 2), m('c', 'Riccardo', 4, 12), m('d', 'Noemi', 0, 30)]
    const v = buildSquadraView(s, 'd')
    assert.deepEqual(v.primiTre.map(x => [x.posizione, x.nome, x.premio]), [[1, 'Anthony', 28.33], [1, 'Riccardo', 28.33], [1, 'Zora', 28.33]])
    // due primi a pari merito: (50 + 25) / 2 a testa, chi viene dopo è terzo
    s.membri = [m('a', 'Zora', 6, 3), m('b', 'Anthony', 6, 20), m('c', 'Riccardo', 4), m('e', 'Lorenzo', 3)]
    assert.deepEqual(buildSquadraView(s, 'e').primiTre.map(x => [x.posizione, x.nome, x.premio]), [[1, 'Anthony', 37.5], [1, 'Zora', 37.5], [3, 'Riccardo', 10]])
    // pari merito al terzo posto: si dividono il terzo premio, e sono tutti sul podio
    s.membri = [m('a', 'Zora', 6), m('b', 'Anthony', 5), m('c', 'Riccardo', 4), m('e', 'Lorenzo', 4)]
    assert.deepEqual(buildSquadraView(s, 'e').primiTre.map(x => [x.posizione, x.nome, x.premio]), [[1, 'Zora', 50], [2, 'Anthony', 25], [3, 'Lorenzo', 5], [3, 'Riccardo', 5]])
    s.membri = [m('a', 'Zora', 4, 10), m('b', 'Anthony', 4, 10), m('c', 'Riccardo', 4, 12), m('d', 'Noemi', 0, 30)]
    // chi non ha presenze non sale sul podio, anche con tanti fissati
    assert.equal(v.primiTre.some(x => x.nome === 'Noemi'), false)
    // con la soglia del podio a 5 presenze resta vuoto
    assert.deepEqual(buildSquadraView({ ...s, minPresenze: 5 }, 'd').primiTre, [])
})

test('podio con meno di tre persone con presenze: solo loro, premi dal primo', () => {
    const s = snap('top3')
    s.membri = [m('a', 'Anthony', 2, 3), m('b', 'Zora', 0, 9)]
    assert.deepEqual(buildSquadraView(s, 'b').primiTre.map(x => [x.nome, x.premio]), [['Anthony', 50]])
})
