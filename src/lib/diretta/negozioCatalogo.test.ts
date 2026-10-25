import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGO_NEGOZIO, settimaneAlMassimo, MASSIMO_PATTO_MESE } from './negozioCatalogo'
import { PERSONALIZZAZIONI } from './negozio'

test('catalogo: 12-16 articoli con id unici e prezzi interi positivi', () => {
    assert.ok(CATALOGO_NEGOZIO.length >= 12 && CATALOGO_NEGOZIO.length <= 16, `articoli: ${CATALOGO_NEGOZIO.length}`)
    const ids = new Set(CATALOGO_NEGOZIO.map(i => i.id))
    assert.equal(ids.size, CATALOGO_NEGOZIO.length)
    for (const i of CATALOGO_NEGOZIO) {
        assert.match(i.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, i.id)
        assert.ok(Number.isInteger(i.price) && i.price > 0, i.id)
        assert.ok(i.currency === 'S' || i.currency === 'P', i.id)
        assert.ok(i.name.trim().length > 0 && i.description.trim().length > 0, i.id)
    }
    assert.equal(new Set(CATALOGO_NEGOZIO.map(i => i.sortOrder)).size, CATALOGO_NEGOZIO.length)
})

test('calibrazione: al massimo del patto 2.700 Scintille e 100 Piume al mese', () => {
    assert.deepEqual(MASSIMO_PATTO_MESE, { S: 2700, P: 100 })
    // una settimana piena al massimo del patto
    assert.ok(Math.abs(settimaneAlMassimo('S', 623) - 1) < 0.01)
    assert.ok(Math.abs(settimaneAlMassimo('P', 23) - 1) < 0.01)
})

test('corso Fenice Academy: 400 Piume, regalabile, unico articolo regalabile', () => {
    const corsi = CATALOGO_NEGOZIO.filter(i => i.kind === 'corso')
    assert.equal(corsi.length, 1)
    assert.equal(corsi[0].price, 400)
    assert.equal(corsi[0].currency, 'P')
    assert.equal(corsi[0].giftable, true)
    assert.deepEqual(CATALOGO_NEGOZIO.filter(i => i.giftable).map(i => i.id), [corsi[0].id])
})

test('premi concreti e permessi: almeno una settimana al massimo del patto', () => {
    const concreti = CATALOGO_NEGOZIO.filter(i => i.kind === 'concreto' || i.kind === 'permesso')
    assert.ok(concreti.length >= 5)
    for (const i of concreti) {
        assert.ok(settimaneAlMassimo(i.currency, i.price) >= 1, `${i.id}: ${settimaneAlMassimo(i.currency, i.price).toFixed(2)} settimane`)
    }
})

test('immagini profilo: 6-8, almeno una più cara di un premio concreto', () => {
    const immagini = CATALOGO_NEGOZIO.filter(i => i.kind === 'immagine')
    assert.ok(immagini.length >= 6 && immagini.length <= 8)
    const minConcretoS = Math.min(...CATALOGO_NEGOZIO.filter(i => i.kind === 'concreto' && i.currency === 'S').map(i => i.price))
    const piuCare = immagini.filter(i => i.currency === 'S' && i.price > minConcretoS)
    assert.ok(piuCare.length >= 2, 'servono due immagini preziose sopra il premio concreto più economico')
})

test('immagini profilo: il file esiste in public/diretta/premi', () => {
    for (const i of CATALOGO_NEGOZIO.filter(x => x.kind === 'immagine')) {
        assert.ok(i.imageUrl, i.id)
        assert.match(i.imageUrl!, /^\/diretta\/premi\/[a-z0-9-]+\.webp$/)
        assert.ok(existsSync(join(process.cwd(), 'public', i.imageUrl!)), `manca ${i.imageUrl}`)
    }
})

test('personalizzazioni del catalogo e registro coincidono', () => {
    const pers = CATALOGO_NEGOZIO.filter(i => i.kind === 'personalizzazione').map(i => i.id).sort()
    assert.deepEqual(pers, Object.keys(PERSONALIZZAZIONI).sort())
})

test('ruoli: tutto il catalogo è per GDO e Conferme', () => {
    for (const i of CATALOGO_NEGOZIO) assert.deepEqual([...i.roles].sort(), ['CONFERME', 'GDO'], i.id)
})
