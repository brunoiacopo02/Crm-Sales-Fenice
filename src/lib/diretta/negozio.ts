// Regole del negozio nuovo (Diretta, PO 25/10/2026). Funzioni pure, usate
// dalle action di negozioActions.ts e testate senza database: il controllo
// vero dell'acquisto gira in transazione, con la riga utente bloccata, ma le
// condizioni sono tutte qui.

export type RewardKind = 'concreto' | 'permesso' | 'immagine' | 'personalizzazione' | 'corso'
export type PurchaseStatus = 'richiesto' | 'consegnato' | 'annullato'
export type BuyError = 'utente' | 'articolo' | 'ruolo' | 'non_regalabile' | 'gia_tuo' | 'saldo'

/** Chi riceve un regalo: nome e cognome, niente di più lungo di così. */
export const GIFT_TO_MAX = 80

export interface BuyerState {
    role: string
    isActive: boolean
    isBot?: boolean | null
    scintille: number
    piume: number
}

export interface ItemState {
    isActive: boolean
    roles: string[]
    currency: string
    price: number
    giftable: boolean
    kind: string
}

/** Immagini e personalizzazioni sono digitali: si usano subito, senza consegna. */
export function isDigitale(kind: string): boolean {
    return kind === 'immagine' || kind === 'personalizzazione'
}

/** Tempo tolto al turno (uscite, sabati, affiancamenti): lo approva l'admin. */
export function daApprovare(kind: string): boolean {
    return kind === 'permesso'
}

/** Stato con cui nasce la richiesta: i digitali sono già consegnati. */
export function statoIniziale(kind: string): PurchaseStatus {
    return isDigitale(kind) ? 'consegnato' : 'richiesto'
}

/** Nome di chi riceve il regalo, ripulito. Vuoto = nessun regalo. */
export function normalizzaRegalo(giftTo: string | null | undefined): string | null {
    if (typeof giftTo !== 'string') return null
    const clean = giftTo.replace(/\s+/g, ' ').trim().slice(0, GIFT_TO_MAX).trim()
    return clean.length > 0 ? clean : null
}

/**
 * Tutte le condizioni di un acquisto. L'ordine conta: prima chi compra, poi
 * l'articolo, poi il regalo, il possesso e infine il saldo nella valuta
 * dell'articolo (le Piume non pagano un articolo in Scintille e viceversa).
 */
export function checkPurchase(input: {
    user: BuyerState | null | undefined
    item: ItemState | null | undefined
    giftTo?: string | null
    alreadyOwned?: boolean
}): { ok: true; giftTo: string | null } | { ok: false; error: BuyError } {
    const { user, item } = input
    if (!user || !user.isActive || user.isBot) return { ok: false, error: 'utente' }
    if (!item || !item.isActive || !Number.isInteger(item.price) || item.price <= 0) return { ok: false, error: 'articolo' }
    if (item.currency !== 'S' && item.currency !== 'P') return { ok: false, error: 'articolo' }
    if (!item.roles.includes(user.role)) return { ok: false, error: 'ruolo' }
    const giftTo = normalizzaRegalo(input.giftTo)
    if (giftTo && !item.giftable) return { ok: false, error: 'non_regalabile' }
    if (isDigitale(item.kind) && input.alreadyOwned) return { ok: false, error: 'gia_tuo' }
    const saldo = item.currency === 'S' ? user.scintille : user.piume
    if (saldo < item.price) return { ok: false, error: 'saldo' }
    return { ok: true, giftTo }
}

/** Articoli posseduti: ogni richiesta che non è stata annullata. */
export function ownedItemIds(purchases: { itemId: string; status: string }[]): Set<string> {
    return new Set(purchases.filter(p => p.status !== 'annullato').map(p => p.itemId))
}

/**
 * Passaggi di stato ammessi all'admin. 'consegnato' -> 'annullato' resta
 * possibile per correggere un clic sbagliato (con rimborso); da 'annullato'
 * non si torna indietro, perché il rimborso è già partito.
 */
export function canTransition(from: string, to: string): boolean {
    if (from === 'richiesto') return to === 'consegnato' || to === 'annullato'
    if (from === 'consegnato') return to === 'annullato'
    return false
}

// Personalizzazioni: il comportamento sta qui, legato all'id dell'articolo
// (rewardItems non ha una colonna per i dettagli). Si mostrano da sole a chi
// le possiede: con più titoli vince il più caro.
export type Personalizzazione = { tipo: 'cornice' } | { tipo: 'titolo'; testo: string }

export const PERSONALIZZAZIONI: Record<string, Personalizzazione> = {
    'cornice-fenice': { tipo: 'cornice' },
    'titolo-voce-della-sala': { tipo: 'titolo', testo: 'Voce della sala' },
}

export interface StileProfilo { cornice: boolean; titolo: string | null }

export function stileProfilo(owned: { itemId: string; price: number }[]): StileProfilo {
    let cornice = false
    let titolo: { testo: string; price: number } | null = null
    for (const o of owned) {
        const p = PERSONALIZZAZIONI[o.itemId]
        if (!p) continue
        if (p.tipo === 'cornice') cornice = true
        else if (!titolo || o.price > titolo.price) titolo = { testo: p.testo, price: o.price }
    }
    return { cornice, titolo: titolo?.testo ?? null }
}

export function messaggioErrore(e: BuyError | 'diretta' | 'errore'): string {
    switch (e) {
        case 'utente': return 'Il tuo account non può fare acquisti.'
        case 'articolo': return 'Questo premio non è più disponibile.'
        case 'ruolo': return 'Questo premio non è previsto per il tuo ruolo.'
        case 'non_regalabile': return 'Questo premio non si può regalare.'
        case 'gia_tuo': return 'Ce l\'hai già: lo trovi nel profilo.'
        case 'saldo': return 'Il saldo non basta per questo premio.'
        case 'diretta': return 'Il negozio nuovo non è ancora attivo per il tuo ruolo.'
        default: return 'Qualcosa non ha funzionato. Riprova tra poco.'
    }
}

/** Nome della valuta, al singolare o al plurale. */
export function nomeValuta(currency: string, n: number): string {
    if (currency === 'P') return n === 1 ? 'Piuma' : 'Piume'
    return n === 1 ? 'Scintilla' : 'Scintille'
}
