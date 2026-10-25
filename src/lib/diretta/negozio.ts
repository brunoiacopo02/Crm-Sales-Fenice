// Regole del negozio nuovo (Diretta, PO 25/10/2026). Funzioni pure, usate
// dalle action di negozioActions.ts e testate senza database: il controllo
// vero dell'acquisto gira in transazione, con la riga utente bloccata, ma le
// condizioni sono tutte qui.

export type RewardKind = 'concreto' | 'permesso' | 'immagine' | 'personalizzazione' | 'corso'
    | 'booster' | 'moltiplicatore' | 'scudo' | 'postazione'
export type PurchaseStatus = 'richiesto' | 'consegnato' | 'annullato'
export type BuyError = 'utente' | 'articolo' | 'ruolo' | 'non_regalabile' | 'gia_tuo' | 'postazione_tua' | 'saldo' | 'solo_regalo'
    | 'booster_turno' | 'booster_attivo' | 'booster_oggi'
    | 'moltiplicatore_turno' | 'moltiplicatore_oggi'
    | 'scudo_tasca' | 'scudo_mese'

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
    id?: string
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

/** Potenziamenti: partono all'acquisto, senza consegna (booster, moltiplicatore, scudo della serie). */
export function isPotenziamento(kind: string): boolean {
    return kind === 'booster' || kind === 'moltiplicatore' || kind === 'scudo'
}

/**
 * Si prende una volta sola a persona: le cose digitali (già tue) e gli
 * upgrade della postazione (una cuffia nuova basta). Un acquisto annullato
 * dall'admin libera di nuovo il posto.
 */
export function unaVoltaSola(kind: string): boolean {
    return isDigitale(kind) || kind === 'postazione'
}

/**
 * Premi che si comprano solo per un collega (PO 25/10/2026: "Caffè per un
 * collega"). L'id è quello del catalogo: rewardItems non ha una colonna apposta.
 */
export const SOLO_REGALO: ReadonlySet<string> = new Set(['caffe-per-un-collega'])

/** Tempo tolto al turno (uscite, sabati, affiancamenti): lo approva l'admin. */
export function daApprovare(kind: string): boolean {
    return kind === 'permesso'
}

/**
 * Permessi che approva Bruno di persona (PO 25/10/2026: "Pausa quando vuoi per
 * una settimana"). Passano dalla stessa coda di Premi del negozio: nascono
 * 'richiesto', l'admin li approva o li annulla (e le Scintille tornano).
 */
export const APPROVA_BRUNO: ReadonlySet<string> = new Set(['pausa-quando-vuoi'])

/** Etichetta accanto al prezzo: chi approva, oppure niente se non c'è da approvare. */
export function etichettaApprovazione(itemId: string, kind: string): string | null {
    if (!daApprovare(kind)) return null
    return APPROVA_BRUNO.has(itemId) ? 'La approva Bruno' : 'Da approvare'
}

/** Riga della conferma d'acquisto, dopo il prezzo. */
export function avvisoApprovazione(itemId: string, kind: string): string {
    if (!daApprovare(kind)) return '.'
    return APPROVA_BRUNO.has(itemId)
        ? '. La approva Bruno: se non si può, tornano nel saldo.'
        : '. Se non si può approvare, tornano nel saldo.'
}

/** Stato con cui nasce la richiesta: i digitali sono già consegnati. */
export function statoIniziale(kind: string): PurchaseStatus {
    // i potenziamenti partono all'acquisto: niente da consegnare
    return isDigitale(kind) || isPotenziamento(kind) ? 'consegnato' : 'richiesto'
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
    if (!giftTo && item.id && SOLO_REGALO.has(item.id)) return { ok: false, error: 'solo_regalo' }
    if (unaVoltaSola(item.kind) && input.alreadyOwned) return { ok: false, error: item.kind === 'postazione' ? 'postazione_tua' : 'gia_tuo' }
    const saldo = item.currency === 'S' ? user.scintille : user.piume
    if (saldo < item.price) return { ok: false, error: 'saldo' }
    return { ok: true, giftTo }
}

export type StatoPostazione = 'base' | 'in_arrivo' | 'tuo'

/**
 * Stato di uno slot della postazione: "Di base" finché non c'è una richiesta
 * valida, "In arrivo" quando è richiesto, "Tuo" quando l'admin l'ha consegnato.
 */
export function statoPostazione(itemId: string, acquisti: readonly { itemId: string; status: string }[]): StatoPostazione {
    const suoi = acquisti.filter(a => a.itemId === itemId && a.status !== 'annullato')
    if (suoi.some(a => a.status === 'consegnato')) return 'tuo'
    if (suoi.length > 0) return 'in_arrivo'
    return 'base'
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
        case 'booster_turno': return 'Il booster si attiva solo durante il turno.'
        case 'booster_attivo': return 'Hai già un booster attivo.'
        case 'booster_oggi': return 'Il booster di oggi l\'hai già usato: domani ce n\'è un altro.'
        case 'postazione_tua': return 'Questo upgrade della postazione è già tuo, o in arrivo.'
        case 'solo_regalo': return 'Questo premio è per un collega: scrivi il suo nome.'
        case 'moltiplicatore_turno': return 'Il moltiplicatore si attiva solo durante il turno.'
        case 'moltiplicatore_oggi': return 'Il moltiplicatore di oggi è già attivo: domani ce n\'è un altro.'
        case 'scudo_tasca': return 'Hai già uno scudo da parte: si usa da solo al primo giorno mancato.'
        case 'scudo_mese': return 'Questo mese hai già preso tutti gli scudi: il mese prossimo ce ne sono altri.'
        default: return 'Qualcosa non ha funzionato. Riprova tra poco.'
    }
}

/** Nome della valuta, al singolare o al plurale. */
export function nomeValuta(currency: string, n: number): string {
    if (currency === 'P') return n === 1 ? 'Piuma' : 'Piume'
    return n === 1 ? 'Scintilla' : 'Scintille'
}
