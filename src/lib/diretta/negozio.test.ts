import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    checkPurchase, normalizzaRegalo, ownedItemIds, canTransition, isDigitale, daApprovare,
    stileProfilo, messaggioErrore, statoIniziale, GIFT_TO_MAX,
} from './negozio'

const gdo = { role: 'GDO', isActive: true, isBot: false, scintille: 1000, piume: 50 }
const caffe = { isActive: true, roles: ['GDO', 'CONFERME'], currency: 'S', price: 700, giftable: false, kind: 'concreto' }
const corso = { isActive: true, roles: ['GDO', 'CONFERME'], currency: 'P', price: 400, giftable: true, kind: 'corso' }

test('acquisto: va bene con saldo, ruolo e articolo attivo', () => {
    assert.deepEqual(checkPurchase({ user: gdo, item: caffe }), { ok: true, giftTo: null })
})

test('acquisto: saldo insufficiente nella valuta giusta', () => {
    assert.deepEqual(checkPurchase({ user: { ...gdo, scintille: 699 }, item: caffe }), { ok: false, error: 'saldo' })
    // le Piume non pagano un articolo in Scintille
    assert.deepEqual(checkPurchase({ user: { ...gdo, scintille: 0, piume: 9999 }, item: caffe }), { ok: false, error: 'saldo' })
    assert.deepEqual(checkPurchase({ user: { ...gdo, piume: 399 }, item: corso }), { ok: false, error: 'saldo' })
    assert.equal(checkPurchase({ user: { ...gdo, piume: 400 }, item: corso }).ok, true)
})

test('acquisto: utente disattivato, bot o mancante non compra', () => {
    assert.deepEqual(checkPurchase({ user: { ...gdo, isActive: false }, item: caffe }), { ok: false, error: 'utente' })
    assert.deepEqual(checkPurchase({ user: { ...gdo, isBot: true }, item: caffe }), { ok: false, error: 'utente' })
    assert.deepEqual(checkPurchase({ user: null, item: caffe }), { ok: false, error: 'utente' })
})

test('acquisto: articolo spento, mancante o con prezzo non valido', () => {
    assert.deepEqual(checkPurchase({ user: gdo, item: { ...caffe, isActive: false } }), { ok: false, error: 'articolo' })
    assert.deepEqual(checkPurchase({ user: gdo, item: null }), { ok: false, error: 'articolo' })
    assert.deepEqual(checkPurchase({ user: gdo, item: { ...caffe, price: 0 } }), { ok: false, error: 'articolo' })
    assert.deepEqual(checkPurchase({ user: gdo, item: { ...caffe, price: 10.5 } }), { ok: false, error: 'articolo' })
    assert.deepEqual(checkPurchase({ user: gdo, item: { ...caffe, currency: 'X' } }), { ok: false, error: 'articolo' })
})

test('acquisto: il ruolo deve essere tra quelli dell articolo', () => {
    assert.deepEqual(checkPurchase({ user: { ...gdo, role: 'VENDITORE' }, item: caffe }), { ok: false, error: 'ruolo' })
    assert.deepEqual(checkPurchase({ user: gdo, item: { ...caffe, roles: ['CONFERME'] } }), { ok: false, error: 'ruolo' })
    assert.equal(checkPurchase({ user: { ...gdo, role: 'CONFERME' }, item: caffe }).ok, true)
})

test('regalo: solo sugli articoli regalabili, nome ripulito', () => {
    assert.deepEqual(checkPurchase({ user: gdo, item: caffe, giftTo: 'Mia sorella' }), { ok: false, error: 'non_regalabile' })
    assert.deepEqual(
        checkPurchase({ user: { ...gdo, piume: 400 }, item: corso, giftTo: '  Giulia   Rossi ' }),
        { ok: true, giftTo: 'Giulia Rossi' },
    )
    // stringa vuota o di soli spazi = nessun regalo
    assert.deepEqual(checkPurchase({ user: gdo, item: caffe, giftTo: '   ' }), { ok: true, giftTo: null })
})

test('regalo: nome tagliato alla lunghezza massima', () => {
    const lungo = 'a'.repeat(GIFT_TO_MAX + 30)
    assert.equal(normalizzaRegalo(lungo)!.length, GIFT_TO_MAX)
    assert.equal(normalizzaRegalo(null), null)
    assert.equal(normalizzaRegalo(undefined), null)
})

test('immagini e personalizzazioni: non si ricomprano', () => {
    const img = { ...caffe, kind: 'immagine', price: 400 }
    assert.deepEqual(checkPurchase({ user: gdo, item: img, alreadyOwned: true }), { ok: false, error: 'gia_tuo' })
    assert.equal(checkPurchase({ user: gdo, item: img, alreadyOwned: false }).ok, true)
    // un premio concreto si può richiedere di nuovo
    assert.equal(checkPurchase({ user: gdo, item: caffe, alreadyOwned: true }).ok, true)
})

test('tipi: digitali consegnati subito, permessi da approvare', () => {
    assert.equal(isDigitale('immagine'), true)
    assert.equal(isDigitale('personalizzazione'), true)
    assert.equal(isDigitale('concreto'), false)
    assert.equal(isDigitale('corso'), false)
    assert.equal(statoIniziale('immagine'), 'consegnato')
    assert.equal(statoIniziale('concreto'), 'richiesto')
    assert.equal(statoIniziale('permesso'), 'richiesto')
    assert.equal(daApprovare('permesso'), true)
    assert.equal(daApprovare('concreto'), false)
})

test('possesso: conta tutto tranne gli annullati', () => {
    const owned = ownedItemIds([
        { itemId: 'squalo', status: 'consegnato' },
        { itemId: 'falco', status: 'annullato' },
        { itemId: 'caffe', status: 'richiesto' },
    ])
    assert.deepEqual([...owned].sort(), ['caffe', 'squalo'])
})

test('stati: da richiesto si consegna o si annulla, da consegnato si annulla, mai indietro', () => {
    assert.equal(canTransition('richiesto', 'consegnato'), true)
    assert.equal(canTransition('richiesto', 'annullato'), true)
    assert.equal(canTransition('consegnato', 'annullato'), true)
    assert.equal(canTransition('consegnato', 'consegnato'), false)
    assert.equal(canTransition('annullato', 'consegnato'), false)
    assert.equal(canTransition('annullato', 'annullato'), false)
    assert.equal(canTransition('consegnato', 'richiesto'), false)
})

test('stile profilo: cornice se posseduta, titolo più caro tra quelli posseduti', () => {
    assert.deepEqual(stileProfilo([]), { cornice: false, titolo: null })
    assert.deepEqual(stileProfilo([{ itemId: 'cornice-fenice', price: 900 }]), { cornice: true, titolo: null })
    assert.deepEqual(
        stileProfilo([{ itemId: 'titolo-voce-della-sala', price: 50 }, { itemId: 'squalo', price: 400 }]),
        { cornice: false, titolo: 'Voce della sala' },
    )
    // gli articoli sconosciuti non cambiano niente
    assert.deepEqual(stileProfilo([{ itemId: 'qualcosa', price: 10 }]), { cornice: false, titolo: null })
})

test('messaggi di errore in italiano, mai vuoti', () => {
    for (const e of ['utente', 'articolo', 'ruolo', 'non_regalabile', 'gia_tuo', 'saldo', 'diretta', 'errore'] as const) {
        assert.ok(messaggioErrore(e).length > 5, e)
    }
})
