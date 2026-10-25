import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGO_NEGOZIO, settimaneAlMassimo, MASSIMO_PATTO_SETTIMANA } from './negozioCatalogo'
import { APPROVA_BRUNO, PERSONALIZZAZIONI, SOLO_REGALO, isPotenziamento, unaVoltaSola } from './negozio'
import { DEFAULT_TARGETS } from './config'
import { DEFAULT_ECONOMY_RULES } from '@/lib/economy/rules'
import { guadagnoGdo, guadagnoConferme, SCENARI_CONFERME, SCENARI_GDO, PATTO, CHIUSURA_SCENARI } from '@/lib/economy/scenari'

const concreti = CATALOGO_NEGOZIO.filter(i => i.kind === 'concreto' || i.kind === 'permesso')
const settimane = (id: string) => {
    const i = CATALOGO_NEGOZIO.find(x => x.id === id)!
    return settimaneAlMassimo(i.currency, i.price)
}

test('catalogo: 25-32 articoli con id unici e prezzi interi positivi', () => {
    assert.ok(CATALOGO_NEGOZIO.length >= 25 && CATALOGO_NEGOZIO.length <= 32, `articoli: ${CATALOGO_NEGOZIO.length}`)
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

test('corso Fenice Academy: circa tre mesi al massimo del patto, regalabile; regalabile anche il caffè per un collega', () => {
    const corsi = CATALOGO_NEGOZIO.filter(i => i.kind === 'corso')
    assert.equal(corsi.length, 1)
    assert.equal(corsi[0].currency, 'P')
    assert.equal(corsi[0].giftable, true)
    const mesi = settimaneAlMassimo('P', corsi[0].price) / (52 / 12)
    assert.ok(mesi >= 2.8 && mesi <= 3.2, `${mesi.toFixed(2)} mesi`)
    assert.deepEqual(CATALOGO_NEGOZIO.filter(i => i.giftable).map(i => i.id).sort(), [corsi[0].id, 'caffe-per-un-collega'].sort())
    for (const id of SOLO_REGALO) assert.equal(CATALOGO_NEGOZIO.find(i => i.id === id)?.giftable, true, id)
})

test('premi concreti e permessi: in Scintille e almeno una settimana al massimo del patto (il caffè per un collega no, apposta)', () => {
    assert.ok(concreti.length >= 5)
    const caffeCollega = concreti.find(i => i.id === 'caffe-per-un-collega')!
    assert.equal(caffeCollega.currency, 'S')
    assert.ok(settimaneAlMassimo('S', caffeCollega.price) >= 0.3 && settimaneAlMassimo('S', caffeCollega.price) < 1)
    for (const i of concreti.filter(x => x.id !== 'caffe-per-un-collega')) {
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

test('testi: niente tetti in euro, pranzo su Glovo in ufficio, niente cena con i titolari', () => {
    for (const i of CATALOGO_NEGOZIO) assert.doesNotMatch(`${i.name} ${i.description}`, /euro|€/i, i.id)
    assert.match(CATALOGO_NEGOZIO.find(i => i.id === 'pranzo-offerto')!.description, /Glovo.*in ufficio/)
    // PO 25/10/2026: in sala si è tutti alla pari, i titolari non sono un premio
    assert.ok(!CATALOGO_NEGOZIO.some(i => /cena/i.test(i.name)))
})

test('booster: solo GDO, poco caro, si attiva da solo e non si regala', () => {
    const b = CATALOGO_NEGOZIO.find(i => i.kind === 'booster')!
    assert.deepEqual(b.roles, ['GDO'])
    assert.equal(b.currency, 'S')
    assert.ok(b.price > 0 && b.price < 50)
    assert.equal(b.giftable, false)
})

test('tempi: un GDO medio arriva al corso in 4-5 mesi, un campione in meno di due', () => {
    const corso = CATALOGO_NEGOZIO.find(i => i.kind === 'corso')!
    const mesi = (piumeSettimana: number) => corso.price / piumeSettimana / (52 / 12)
    const medio = guadagnoGdo(SCENARI_GDO[0], DEFAULT_ECONOMY_RULES, DEFAULT_TARGETS).piume.totale
    const campione = guadagnoGdo(SCENARI_GDO[SCENARI_GDO.length - 1], DEFAULT_ECONOMY_RULES, DEFAULT_TARGETS).piume.totale
    assert.ok(mesi(medio) > 4 && mesi(medio) < 5, `medio ${mesi(medio).toFixed(2)}`)
    assert.ok(mesi(campione) < 2, `campione ${mesi(campione).toFixed(2)}`)
    // Le Conferme, con gli obiettivi alleggeriti da Bruno il 25/10 (presenze 14/20,
    // chiusure 4/6): la brava ci mette poco meno di un GDO al massimo del patto,
    // la media poco meno di un GDO medio.
    const brava = guadagnoConferme(SCENARI_CONFERME[1], DEFAULT_ECONOMY_RULES).piume.totale
    const mediaConf = guadagnoConferme(SCENARI_CONFERME[0], DEFAULT_ECONOMY_RULES).piume.totale
    assert.ok(mesi(brava) >= 2.5 && mesi(brava) <= 3.2, `Conferma brava ${mesi(brava).toFixed(2)}`)
    assert.ok(mesi(mediaConf) >= 3.5 && mesi(mediaConf) <= 4.5, `Conferma media ${mesi(mediaConf).toFixed(2)}`)
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

test("ruoli: tutto il catalogo è per GDO e Conferme, tranne la mezz'ora in cui fissa Bruno, i potenziamenti e le cuffie (solo GDO), auricolari e telefono (solo Conferme)", () => {
    const soloConferme = new Set(['postazione-auricolari', 'postazione-telefono'])
    for (const i of CATALOGO_NEGOZIO) {
        const attesi = soloConferme.has(i.id) ? ['CONFERME']
            : i.id === 'pausa-30-bruno-fissa' || i.id === 'postazione-cuffie' || isPotenziamento(i.kind) ? ['GDO']
            : ['CONFERME', 'GDO']
        assert.deepEqual([...i.roles].sort(), attesi, i.id)
    }
})

test('potenziamenti: moltiplicatore e scudo della serie, solo GDO, non regalabili', () => {
    const m = CATALOGO_NEGOZIO.find(i => i.kind === 'moltiplicatore')!
    const s = CATALOGO_NEGOZIO.find(i => i.kind === 'scudo')!
    assert.equal(m.price, 20)
    assert.equal(s.price, 400)
    for (const i of [m, s]) {
        assert.deepEqual(i.roles, ['GDO'])
        assert.equal(i.giftable, false)
        assert.equal(i.currency, 'S')
    }
    // Il testo del moltiplicatore dice i numeri delle regole di default.
    assert.match(m.description, new RegExp(`${DEFAULT_ECONOMY_RULES.moltiplicatore.bonus} Scintille.*${DEFAULT_ECONOMY_RULES.moltiplicatore.maxPresenze} presenze`))
})

test('premi nuovi del 25/10: pausa quando vuoi mai in punta, abbonamento, cinema, buoni; niente tazza, salvadanaio, cena', () => {
    const pausa = CATALOGO_NEGOZIO.find(i => i.id === 'pausa-quando-vuoi')!
    assert.equal(pausa.kind, 'permesso')
    assert.match(pausa.description, /mai nell'ora di punta \(18-19, il sabato 12:30-13:30\)/)
    // PO 25/10/2026: la approva Bruno, con il suo nome
    assert.match(pausa.description, /la approva Bruno/)
    assert.ok(APPROVA_BRUNO.has(pausa.id))
    for (const id of ['spotify-o-netflix', 'cinema-per-due', 'buono-amazon-10', 'buono-amazon-25', 'caffe-per-un-collega']) {
        assert.ok(CATALOGO_NEGOZIO.some(i => i.id === id), id)
    }
    assert.ok(settimane('buono-amazon-25') > settimane('buono-amazon-10'))
    assert.ok(!CATALOGO_NEGOZIO.some(i => /tazza|borraccia|salvadanaio/i.test(`${i.name} ${i.description}`)))
})

test('la tua postazione: cinque upgrade a ruolo, una volta a persona, cari apposta', () => {
    const p = CATALOGO_NEGOZIO.filter(i => i.kind === 'postazione')
    assert.deepEqual(p.map(i => i.id).sort(), [
        'postazione-auricolari', 'postazione-cuffie', 'postazione-gadget', 'postazione-monitor',
        'postazione-mouse', 'postazione-tastiera', 'postazione-telefono',
    ])
    // PO 25/10/2026: le Conferme chiamano col telefono, niente cuffie ma
    // auricolari e telefono; il resto per entrambi.
    const di = (ruolo: string) => p.filter(i => i.roles.includes(ruolo)).map(i => i.id).sort()
    assert.deepEqual(di('GDO'), ['postazione-cuffie', 'postazione-gadget', 'postazione-monitor', 'postazione-mouse', 'postazione-tastiera'])
    assert.deepEqual(di('CONFERME'), [
        'postazione-auricolari', 'postazione-gadget', 'postazione-monitor', 'postazione-mouse', 'postazione-tastiera', 'postazione-telefono',
    ])
    for (const i of p) {
        assert.equal(i.currency, 'S')
        assert.equal(i.giftable, false)
        assert.ok(unaVoltaSola(i.kind))
        // PO 25/10/2026: restano dell'azienda, sono per la postazione di lavoro
        assert.match(i.description, /Rest(a|ano) dell'azienda: (è|sono) per la tua postazione di lavoro\./, i.id)
        assert.ok(settimaneAlMassimo('S', i.price) >= 2, `${i.id}: ${settimaneAlMassimo('S', i.price).toFixed(1)} settimane`)
    }
    assert.ok(settimane('postazione-monitor') > settimane('postazione-cuffie'))
    assert.ok(settimane('postazione-telefono') > settimane('postazione-auricolari'))
})

test('settimane al massimo dei premi principali', () => {
    assert.ok(settimane('caffe-cornetto') >= 1 && settimane('caffe-cornetto') < 1.2)
    assert.ok(settimane('sabato-libero') >= 9)
})
