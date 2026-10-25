import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGO_NEGOZIO, settimaneAlMassimo, MASSIMO_PATTO_SETTIMANA } from './negozioCatalogo'
import { PERSONALIZZAZIONI } from './negozio'
import { DEFAULT_TARGETS } from './config'
import { DEFAULT_ECONOMY_RULES } from '@/lib/economy/rules'
import { guadagnoGdo, guadagnoConferme, SCENARI_CONFERME, SCENARI_GDO, PATTO, CHIUSURA_SCENARI } from '@/lib/economy/scenari'

const concreti = CATALOGO_NEGOZIO.filter(i => i.kind === 'concreto' || i.kind === 'permesso')
const settimane = (id: string) => {
    const i = CATALOGO_NEGOZIO.find(x => x.id === id)!
    return settimaneAlMassimo(i.currency, i.price)
}

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

test('taratura: la settimana al massimo del patto è quella che danno le regole vere', () => {
    const massimo = guadagnoGdo({ nome: 'massimo', ...PATTO.massimo, chiusura: CHIUSURA_SCENARI }, DEFAULT_ECONOMY_RULES, DEFAULT_TARGETS)
    assert.ok(Math.abs(massimo.scintille.totale - MASSIMO_PATTO_SETTIMANA.S) / MASSIMO_PATTO_SETTIMANA.S < 0.03, `Scintille ${massimo.scintille.totale}`)
    assert.ok(Math.abs(massimo.piume.totale - MASSIMO_PATTO_SETTIMANA.P) / MASSIMO_PATTO_SETTIMANA.P < 0.03, `Piume ${massimo.piume.totale}`)
    assert.ok(Math.abs(settimaneAlMassimo('S', 640) - 1) < 1e-9)
    assert.ok(Math.abs(settimaneAlMassimo('P', 13.5) - 1) < 1e-9)
})

test('corso Fenice Academy: circa tre mesi al massimo del patto, regalabile, unico articolo regalabile', () => {
    const corsi = CATALOGO_NEGOZIO.filter(i => i.kind === 'corso')
    assert.equal(corsi.length, 1)
    assert.equal(corsi[0].currency, 'P')
    assert.equal(corsi[0].giftable, true)
    const mesi = settimaneAlMassimo('P', corsi[0].price) / (52 / 12)
    assert.ok(mesi >= 2.8 && mesi <= 3.2, `${mesi.toFixed(2)} mesi`)
    assert.deepEqual(CATALOGO_NEGOZIO.filter(i => i.giftable).map(i => i.id), [corsi[0].id])
})

test('premi concreti e permessi: in Scintille e almeno una settimana al massimo del patto', () => {
    assert.ok(concreti.length >= 5)
    for (const i of concreti) {
        assert.equal(i.currency, 'S', `${i.id}: dal 25/10 le Piume servono solo per il corso`)
        assert.ok(settimaneAlMassimo(i.currency, i.price) >= 1, `${i.id}: ${settimaneAlMassimo(i.currency, i.price).toFixed(2)} settimane`)
    }
})

test('le Piume comprano solo il corso (PO 25/10/2026)', () => {
    for (const i of CATALOGO_NEGOZIO.filter(x => x.currency === 'P')) {
        assert.equal(i.kind, 'corso', i.id)
    }
})

test('immagini profilo: 6-8, due più care (in settimane) del premio concreto più economico', () => {
    const immagini = CATALOGO_NEGOZIO.filter(i => i.kind === 'immagine')
    assert.ok(immagini.length >= 6 && immagini.length <= 8)
    const minConcreto = Math.min(...concreti.map(i => settimaneAlMassimo(i.currency, i.price)))
    const piuCare = immagini.filter(i => settimaneAlMassimo(i.currency, i.price) > minConcreto)
    assert.ok(piuCare.length >= 2, 'servono due immagini preziose sopra il premio concreto più economico')
})

test('testi: niente tetti in euro, pranzo su Glovo in ufficio, cena con Bruno e Federico offerta', () => {
    for (const i of CATALOGO_NEGOZIO) assert.doesNotMatch(`${i.name} ${i.description}`, /euro|€/i, i.id)
    assert.match(CATALOGO_NEGOZIO.find(i => i.id === 'pranzo-offerto')!.description, /Glovo.*in ufficio/)
    const cena = CATALOGO_NEGOZIO.find(i => i.id === 'cena-con-bruno-e-federico')!
    assert.match(`${cena.name} ${cena.description}`, /Bruno e Federico/)
    assert.match(cena.description, /offerta/)
})

test('tempi: un GDO medio arriva al corso in 4-5 mesi, un campione in meno di due', () => {
    const corso = CATALOGO_NEGOZIO.find(i => i.kind === 'corso')!
    const mesi = (piumeSettimana: number) => corso.price / piumeSettimana / (52 / 12)
    const medio = guadagnoGdo(SCENARI_GDO[0], DEFAULT_ECONOMY_RULES, DEFAULT_TARGETS).piume.totale
    const campione = guadagnoGdo(SCENARI_GDO[SCENARI_GDO.length - 1], DEFAULT_ECONOMY_RULES, DEFAULT_TARGETS).piume.totale
    assert.ok(mesi(medio) > 4 && mesi(medio) < 5, `medio ${mesi(medio).toFixed(2)}`)
    assert.ok(mesi(campione) < 2, `campione ${mesi(campione).toFixed(2)}`)
    // Le Conferme: la brava ci mette quanto un GDO al massimo del patto (circa tre mesi).
    const brava = guadagnoConferme(SCENARI_CONFERME[1], DEFAULT_ECONOMY_RULES).piume.totale
    assert.ok(mesi(brava) >= 2.8 && mesi(brava) <= 3.3, `Conferma brava ${mesi(brava).toFixed(2)}`)
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

test('settimane al massimo dei premi principali', () => {
    assert.ok(settimane('caffe-cornetto') >= 1 && settimane('caffe-cornetto') < 1.2)
    assert.ok(settimane('cena-con-bruno-e-federico') >= 7)
    assert.ok(settimane('sabato-libero') >= 9)
})
