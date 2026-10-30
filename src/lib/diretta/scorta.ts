// Scorta personale delle prime chiamate dei GDO (PO 29/10/2026). Funzioni pure:
// le usano scortaDb.ts, getPipelineLeads e lo script della prima assegnazione,
// e si testano senza DB (scorta.test.ts).
//
// Cosa vede il GDO in PRIMA CHIAMATA quando la scorta è accesa:
//  - tutti i vergini, in cima, l'ultimo arrivato per primo;
//  - i ridati caldi (stella "Chiama per primo": chat interrotte, chi ha scritto,
//    chat riprese dal bot) e i "Ti ha cercato", appena arrivano;
//  - una parte del resto: 40 alla prima assegnazione, poi 30 a ogni sblocco.
// Tutti gli altri lead in prima chiamata restano suoi ma nascosti nella scorta.
// Quando non ha più niente in prima chiamata (vergini compresi) se ne sbloccano
// altri 30, i migliori. Gli arrivi successivi non caldi vanno in fondo.
//
// La distribuzione non cambia: un lead nascosto resta assegnato al GDO, con lo
// stesso stato e gli stessi tentativi, quindi ogni conteggio che la usa lo vede
// come prima.

import { destinatarioAssegnazione } from './arrivo'

/** Quanti lead non vergini restano visibili alla prima assegnazione. */
export const VISIBILI_INIZIALI = 40
/** Quanti lead escono dalla scorta a ogni sblocco. */
export const SBLOCCO = 30
/**
 * Un lead arrivato da meno di così non si classifica ancora: chi lo assegna
 * scrive il lead e poi l'evento che dice se è caldo, e la stella non deve
 * perdersi a metà. Nel frattempo si vede, come ogni lead da classificare.
 */
export const GRAZIA_MS = 20_000
/** Un vergine che il GDO trova dopo un giorno di assenza resta un vergine. */
export const VERGINE_MAX_MS = 7 * 24 * 3600 * 1000

export type StatoScorta = 'visibile' | 'scorta'

/** Motivi di restituzione che vengono dai letti (ridistribuzione del 29/10 e giro del bot). */
const MOTIVI_LETTI = new Set(['ridistribuzione_29_10_letti'])

export interface LeadScorta {
    id: string
    status: string
    callCount: number
    source: string | null
    launchBucket: string | null
    funnel: string | null
    createdAt: Date
    updatedAt: Date
    scortaStato: string | null
    scortaDal: Date | null
    /** "Ti ha cercato" aperto (botContactRequests non chiusa). */
    cercato: boolean
    /** metadata.reason dell'ultima restituzione dal bot (REASSIGNED_FROM_BOT), null se mai. */
    ultimoMotivo: string | null
    /** metadata.instradato dell'ultima restituzione dal bot ('letto', 'mai_consegnato'). */
    ultimoInstradato: string | null
    /** Ha almeno un BOT_PUSHED: è passato dal bot. */
    passatoDalBot: boolean
    /** Ora di arrivo al GDO attuale (oraArrivo di arrivo.ts). */
    arrivedAt: Date
}

/** Stella "Chiama per primo": stessa regola della board (pipelineActions). */
export function conStella(l: Pick<LeadScorta, 'ultimoMotivo' | 'launchBucket'>): boolean {
    return l.ultimoMotivo === 'chat_interrotta' && !l.launchBucket
}

/**
 * Vergine: fresco di ActiveCampaign mai toccato da nessuno (né persona né bot).
 * Come eVergineDelGiorno di arrivo.ts ma senza il limite di oggi: un vergine
 * arrivato sabato sera e trovato lunedì resta un vergine.
 */
export function eVergine(l: LeadScorta, ora: Date): boolean {
    return l.status === 'NEW'
        && l.callCount === 0
        && l.source === 'activecampaign'
        && !l.launchBucket
        && l.ultimoMotivo === null
        && !l.passatoDalBot
        && !l.cercato
        && ora.getTime() - l.createdAt.getTime() <= VERGINE_MAX_MS
}

/** Vergini, stelle e "Ti ha cercato" si vedono sempre, appena arrivano. */
export function sempreVisibile(l: LeadScorta, ora: Date): boolean {
    return l.cercato || conStella(l) || eVergine(l, ora)
}

const funnelSu = (f: string | null) => (f ?? '').trim().toUpperCase()
const eJsTg = (f: string | null) => ['JOB SIMULATOR', 'TELEGRAM'].includes(funnelSu(f))
const eC10 = (f: string | null) => funnelSu(f).startsWith('CORSO 10 ORE') || funnelSu(f).startsWith('CORSO10ORE')
const eLetto = (l: Pick<LeadScorta, 'ultimoMotivo' | 'ultimoInstradato'>) =>
    (l.ultimoMotivo !== null && MOTIVI_LETTI.has(l.ultimoMotivo)) || l.ultimoInstradato === 'letto'

/**
 * Priorità dentro la scorta (PO 29/10/2026): stella, poi letti JOB SIMULATOR e
 * TELEGRAM, poi letti CORSO 10 ORE, poi il resto. Più alto = prima.
 */
export function rangoScorta(l: Pick<LeadScorta, 'ultimoMotivo' | 'ultimoInstradato' | 'launchBucket' | 'funnel'>): number {
    if (conStella(l)) return 3
    if (eLetto(l) && eJsTg(l.funnel)) return 2
    if (eLetto(l) && eC10(l.funnel)) return 1
    return 0
}

/** Ordine della priorità a parità di ingresso: rango, poi il più recente, poi id. */
export function confrontaPriorita(
    a: Pick<LeadScorta, 'id' | 'arrivedAt' | 'ultimoMotivo' | 'ultimoInstradato' | 'launchBucket' | 'funnel'>,
    b: Pick<LeadScorta, 'id' | 'arrivedAt' | 'ultimoMotivo' | 'ultimoInstradato' | 'launchBucket' | 'funnel'>,
): number {
    const r = rangoScorta(b) - rangoScorta(a)
    if (r !== 0) return r
    const t = b.arrivedAt.getTime() - a.arrivedAt.getTime()
    if (t !== 0) return t
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Ordine di uscita dalla scorta: chi è entrato prima esce prima (gli arrivi
 * successivi vanno in fondo), dentro lo stesso ingresso la priorità.
 */
export function ordinaScorta<T extends LeadScorta>(lista: readonly T[]): T[] {
    return [...lista].sort((a, b) => {
        const da = a.scortaDal?.getTime() ?? 0
        const db = b.scortaDal?.getTime() ?? 0
        if (da !== db) return da - db
        return confrontaPriorita(a, b)
    })
}

/** È in prima chiamata e si vede? (null = da classificare: si vede come prima). */
export function visibileInPrimaChiamata(l: Pick<LeadScorta, 'scortaStato' | 'cercato'>): boolean {
    return l.cercato || l.scortaStato !== 'scorta'
}

/**
 * Classificazione degli arrivi: per ogni lead da classificare (scortaStato null)
 * arrivato da più della grazia, 'visibile' se è caldo o vergine, altrimenti
 * 'scorta' (in fondo). Restituisce solo i lead da scrivere.
 */
export function classificaArrivi(lista: readonly LeadScorta[], ora: Date): { visibili: string[]; scorta: string[] } {
    const visibili: string[] = []
    const scorta: string[] = []
    for (const l of lista) {
        if (l.scortaStato !== null) continue
        if (l.callCount !== 0 && !l.cercato) continue
        if (l.cercato || sempreVisibile(l, ora)) { visibili.push(l.id); continue }
        if (ora.getTime() - l.updatedAt.getTime() < GRAZIA_MS) continue
        scorta.push(l.id)
    }
    return { visibili, scorta }
}

/**
 * C'è ancora qualcosa da chiamare in prima chiamata? Un lead visibile mai
 * chiamato (i lead ancora da classificare contano come visibili). Un "Ti ha
 * cercato" che ha già dei tentativi alle spalle resta sulla board finché
 * l'admin non chiude la richiesta, e da solo non deve tenere ferma la scorta:
 * non conta.
 */
export function haDaChiamare(lista: readonly Pick<LeadScorta, 'callCount' | 'scortaStato' | 'cercato'>[]): boolean {
    return lista.some(l => l.callCount === 0 && visibileInPrimaChiamata(l))
}

/**
 * Sblocco: se in prima chiamata non resta niente da chiamare (vergini compresi),
 * i primi `quanti` della scorta tornano visibili. Lista vuota = niente da fare.
 *
 * `lista` sono i lead in prima chiamata DOPO la classificazione degli arrivi.
 */
export function daSbloccare<T extends LeadScorta>(lista: readonly T[], quanti = SBLOCCO): string[] {
    if (haDaChiamare(lista)) return []
    return ordinaScorta(lista.filter(l => l.scortaStato === 'scorta' && !l.cercato)).slice(0, quanti).map(l => l.id)
}

/**
 * Prima assegnazione (script di accensione): vergini, stelle e "Ti ha cercato"
 * visibili, poi i migliori `quanti` del resto visibili, gli altri in scorta.
 */
export function primaAssegnazione(lista: readonly LeadScorta[], ora: Date, quanti = VISIBILI_INIZIALI): { visibili: string[]; scorta: string[]; sempre: string[] } {
    const prima = lista.filter(l => l.callCount === 0 || l.cercato)
    const sempre = prima.filter(l => sempreVisibile(l, ora))
    const resto = prima.filter(l => !sempreVisibile(l, ora)).sort(confrontaPriorita)
    return {
        sempre: sempre.map(l => l.id),
        visibili: [...sempre, ...resto.slice(0, quanti)].map(l => l.id),
        scorta: resto.slice(quanti).map(l => l.id),
    }
}

/**
 * Stima dei giorni per finire la scorta: scorta diviso quanto la scorta cala in
 * media al giorno. Ogni prima chiamata esitata ne consuma una, ogni lead che
 * arriva (vergine, caldo o messo in fondo alla scorta) ne rimette una: il calo
 * netto è consumati meno arrivi, sui giorni in cui il GDO ha lavorato.
 * null = al ritmo attuale non si esaurisce, o non ci sono ancora dati.
 */
export function stimaGiorni(scorta: number, giorni: ReadonlyArray<{ consumati: number; arrivi: number }>): number | null {
    if (scorta <= 0) return 0
    const lavorati = giorni.filter(g => g.consumati > 0)
    if (lavorati.length === 0) return null
    const media = lavorati.reduce((s, g) => s + g.consumati - g.arrivi, 0) / lavorati.length
    if (media <= 0) return null
    return Math.ceil(scorta / media)
}

/**
 * Priorità aggiuntiva in prima chiamata quando la scorta è accesa: sopra i
 * vergini della settimana (quelli del giorno stanno già in cima), poi l'ordine
 * della scorta (letti JOB SIMULATOR/TELEGRAM, poi letti CORSO 10 ORE). Si somma
 * sotto la priorità della board, che resta quella che decide per prima.
 */
export function prioritaScorta(l: LeadScorta, ora: Date): number {
    return (eVergine(l, ora) ? 4 : 0) + rangoScorta(l)
}

/** Evento letto dal DB per ricostruire i dati di scorta di un lead. */
export interface EventoScorta {
    eventType: string
    userId: string | null
    timestamp: Date | string
    reason?: string | null
    instradato?: string | null
    toAssigneeId?: string | null
    assignedToUser?: string | null
}

const msDi = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d))

/**
 * Dagli eventi di un lead (in qualunque ordine): motivo e instradamento
 * dell'ULTIMA restituzione dal bot, se è passato dal bot, e l'ora di arrivo al
 * proprietario attuale (stessa regola di oraArrivo in arrivo.ts).
 */
export function datiDaEventi(eventi: readonly EventoScorta[], proprietario: string | null, assignedAt: Date | null, createdAt: Date):
    Pick<LeadScorta, 'ultimoMotivo' | 'ultimoInstradato' | 'passatoDalBot' | 'arrivedAt'> {
    let ultimoRidato: EventoScorta | null = null
    let passatoDalBot = false
    let arrivo = -Infinity
    for (const e of eventi) {
        if (e.eventType === 'BOT_PUSHED') { passatoDalBot = true; continue }
        if (e.eventType === 'REASSIGNED_FROM_BOT' && (!ultimoRidato || msDi(e.timestamp) > msDi(ultimoRidato.timestamp))) ultimoRidato = e
        if (proprietario && destinatarioAssegnazione(e) === proprietario) arrivo = Math.max(arrivo, msDi(e.timestamp))
    }
    return {
        ultimoMotivo: ultimoRidato ? (ultimoRidato.reason ?? null) : null,
        ultimoInstradato: ultimoRidato ? (ultimoRidato.instradato ?? null) : null,
        passatoDalBot,
        arrivedAt: arrivo > -Infinity ? new Date(arrivo) : new Date((assignedAt ?? createdAt).getTime()),
    }
}

/** La lista con gli stati appena scritti. */
export function applicaScritti<T extends LeadScorta>(lista: readonly T[], scritti: { visibili: string[]; scorta: string[] }, quando: Date = new Date()): T[] {
    const v = new Set(scritti.visibili)
    const s = new Set(scritti.scorta)
    return lista.map(l => v.has(l.id) ? { ...l, scortaStato: 'visibile', scortaDal: null }
        : s.has(l.id) ? { ...l, scortaStato: 'scorta', scortaDal: quando }
            : l)
}
