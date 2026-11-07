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
//
// Sblocco (PO 06/11/2026): quando in prima chiamata gli restano SOGLIA_SBLOCCO
// (5) lead visibili da chiamare o meno (vergini compresi), se ne sbloccano
// altri 30. Si innesca alla lettura della pipeline (getPipelineLeads) e dopo
// un esito su una prima chiamata (dopoEsitoPrimaChiamata), sempre dentro
// sbloccaSeVuota: lock consultivo per GDO e rilettura sotto lock, quindi due
// richieste insieme ne sbloccano 30, non 60 (dopo lo sblocco ne ha 35 > 5).
// I rimasti stanno SEMPRE sopra i nuovi sbloccati: ogni sblocco scrive
// scortaDal = ora sui lead che fa uscire ("ondata"), e in prima chiamata
// un'ondata più vecchia sta sopra una più nuova (rangoOndata). Vergini,
// stelle e "Ti ha cercato" restano comunque in cima a tutte le ondate.
//
// Chi esce per primo dalla scorta (PO 06/11/2026, gruppoUscita): stella, poi
// chi non è mai stato contattato su WhatsApp (mai passato dal bot, o il bot non
// ci ha mai chattato), poi i ridati dal bot, poi i "WhatsApp mai consegnato"
// (numero senza WhatsApp); dentro ogni gruppo il più recente prima. Non conta
// più da quanto è in scorta: il 06/11 l'ordine per ingresso faceva uscire per
// primi i ridati vecchi.
//
// Arrivi (PO 30/10/2026): un lead che arriva al GDO o va IN CIMA (vergine,
// stella, "Ti ha cercato": visibile subito) o va nella scorta (da cui esce
// secondo gruppoUscita), senza mai comparire per un attimo. Un arrivo non caldo ancora da classificare
// (scortaStato null) quindi non si vede, nemmeno durante la grazia.
//
// La distribuzione non cambia: un lead nascosto resta assegnato al GDO, con lo
// stesso stato e gli stessi tentativi, quindi ogni conteggio che la usa lo vede
// come prima.

import { destinatarioAssegnazione } from './arrivo'

/** Quanti lead non vergini restano visibili alla prima assegnazione. */
export const VISIBILI_INIZIALI = 40
/** Quanti lead escono dalla scorta a ogni sblocco. */
export const SBLOCCO = 30
/** Si sblocca quando in prima chiamata restano da chiamare questi lead visibili o meno (PO 06/11/2026). */
export const SOGLIA_SBLOCCO = 5
/**
 * Un lead arrivato da meno di così non si SCRIVE ancora in scorta: chi lo
 * assegna scrive il lead e poi l'evento che dice se è caldo, e la stella non
 * deve perdersi a metà. Nel frattempo NON si vede (PO 30/10/2026): se diventa
 * caldo, alla lettura dopo è sempre visibile e compare in cima; altrimenti
 * finita la grazia va in fondo alla scorta.
 */
export const GRAZIA_MS = 20_000

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
 *
 * Nessun limite d'età (PO 07/11/2026: "i vergini, mai contattati da nessuno,
 * né GDO né bot, devono apparire sempre in cima"). Fino al 07/11 oltre i 7
 * giorni smetteva di esserlo e poteva finire nascosto in scorta. `ora` resta
 * nella firma per non cambiare i chiamanti.
 */
export function eVergine(l: LeadScorta, _ora?: Date): boolean {
    return l.status === 'NEW'
        && l.callCount === 0
        && l.source === 'activecampaign'
        && !l.launchBucket
        && l.ultimoMotivo === null
        && !l.passatoDalBot
        && !l.cercato
}

/**
 * Lead del Black Friday (PO 07/11/2026): quando il bot li ridà ai GDO hanno la
 * priorità su tutto (sopra vergini, stelle e "Ti ha cercato") e non finiscono
 * mai nascosti in scorta.
 */
export function eBlackFriday(l: { funnel?: string | null }): boolean {
    return (l.funnel ?? '').trim().toUpperCase() === 'BLACK FRIDAY'
}

/** Black Friday, vergini, stelle e "Ti ha cercato" si vedono sempre, appena arrivano. */
export function sempreVisibile(l: LeadScorta, ora: Date): boolean {
    return eBlackFriday(l) || l.cercato || conStella(l) || eVergine(l, ora)
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
 * Gruppo di uscita dalla scorta (PO 06/11/2026), più alto = esce prima:
 * 3 stella, 2 mai contattato su WhatsApp (mai passato dal bot, o restituito
 * senza che il bot ci abbia mai chattato), 1 ridato dal bot, 0 "WhatsApp mai
 * consegnato" (numero senza WhatsApp).
 */
export function gruppoUscita(l: Pick<LeadScorta, 'ultimoMotivo' | 'ultimoInstradato' | 'launchBucket' | 'passatoDalBot'>): number {
    if (conStella(l)) return 3
    if (l.ultimoInstradato === 'mai_consegnato') return 0
    if (!l.passatoDalBot || (l.ultimoMotivo ?? '').includes('senza_chat_bot')) return 2
    return 1
}

/**
 * Ordine di uscita dalla scorta (PO 06/11/2026): i più promettenti prima
 * (gruppoUscita), dentro il gruppo il più recente (arrivo al GDO, cioè per un
 * ridato la restituzione), poi il rango di funnel, poi id. Da quanto il lead
 * è in scorta non conta più.
 */
export function ordinaScorta<T extends LeadScorta>(lista: readonly T[]): T[] {
    return [...lista].sort((a, b) => {
        const g = gruppoUscita(b) - gruppoUscita(a)
        if (g !== 0) return g
        const t = b.arrivedAt.getTime() - a.arrivedAt.getTime()
        if (t !== 0) return t
        return confrontaPriorita(a, b)
    })
}

/**
 * È in prima chiamata e si vede? 'visibile' sì, 'scorta' no (salvo un "Ti ha
 * cercato"), null (arrivo da classificare) solo se è sempre visibile: vergine,
 * stella o "Ti ha cercato". Un arrivo non caldo non compare mai, neanche
 * durante la grazia (PO 30/10/2026).
 */
export function visibileInPrimaChiamata(l: LeadScorta, ora: Date): boolean {
    // Black Friday: visibile anche se era gia' stato scritto in scorta (PO 07/11/2026).
    if (eBlackFriday(l) || l.cercato || l.scortaStato === 'visibile') return true
    if (l.scortaStato === 'scorta') return false
    return sempreVisibile(l, ora)
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
 * C'è ancora qualcosa da chiamare in prima chiamata? Un lead VISIBILE mai
 * chiamato, con la stessa regola della board (visibileInPrimaChiamata): conta
 * solo quello che il GDO ha davanti.
 *
 * Arrivi in grazia (PO 30/10/2026): un arrivo non caldo ancora da classificare
 * non si vede e quindi NON conta. Se il GDO è a zero lo sblocco parte subito e
 * fa uscire 30 lead dalla scorta già esistente; l'arrivo, finita la grazia,
 * va in fondo alla scorta, cioè esattamente dove sarebbe andato comunque. Così
 * il GDO non resta mai con la board vuota ad aspettare la grazia, e lo
 * sblocco non dipende dagli arrivi: niente doppio sblocco (l'arrivo non è
 * "da chiamare" né prima né dopo) e nessun lead saltato. Un arrivo caldo
 * invece è visibile subito e conta.
 *
 * Un "Ti ha cercato" che ha già dei tentativi alle spalle resta sulla board
 * finché l'admin non chiude la richiesta, e da solo non deve tenere ferma la
 * scorta: non conta.
 */
export function haDaChiamare(lista: readonly LeadScorta[], ora: Date): boolean {
    return quantiDaChiamare(lista, ora) > 0
}

/** Quanti lead visibili e mai chiamati ha davanti (stessa regola di haDaChiamare). */
export function quantiDaChiamare(lista: readonly LeadScorta[], ora: Date): number {
    return lista.filter(l => l.callCount === 0 && visibileInPrimaChiamata(l, ora)).length
}

/**
 * Va fatto uno sblocco? Sì se da chiamare restano SOGLIA_SBLOCCO lead visibili
 * o meno (PO 06/11/2026) e la scorta non è vuota. Dopo uno sblocco di 30 ne
 * ha più di 5: un secondo calcolo (la richiesta in coda al lock) non sblocca
 * altro; se la scorta è finita, il secondo non trova niente.
 */
export function deveSbloccare(lista: readonly LeadScorta[], ora: Date, soglia = SOGLIA_SBLOCCO): boolean {
    if (quantiDaChiamare(lista, ora) > soglia) return false
    return lista.some(l => l.scortaStato === 'scorta' && !l.cercato)
}

/**
 * Sblocco: se in prima chiamata restano SOGLIA_SBLOCCO lead da chiamare o meno
 * (vergini compresi), i primi `quanti` della scorta tornano visibili. Lista
 * vuota = niente da fare.
 *
 * `lista` sono i lead in prima chiamata DOPO la classificazione degli arrivi.
 */
export function daSbloccare<T extends LeadScorta>(lista: readonly T[], ora: Date, quanti = SBLOCCO, soglia = SOGLIA_SBLOCCO): string[] {
    if (!deveSbloccare(lista, ora, soglia)) return []
    return primiDellaScorta(lista, quanti)
}

/** Peso del rango di ondata sopra la priorità della board (lancioRank × 8 + prioritaScorta < 256). */
export const PESO_ONDATA = 256

/**
 * Rango di ondata in prima chiamata (PO 06/11/2026), più alto = più in alto:
 * i rimasti stanno sempre sopra i nuovi sbloccati. Uno sblocco scrive
 * scortaDal = ora sui lead che fa uscire; un visibile con scortaDal null non
 * viene da uno sblocco (prima assegnazione, arrivi caldi). Ordine: i vergini
 * sopra tutto (PO 07/11/2026: "sempre in cima", anche sopra stelle e "Ti ha
 * cercato"), poi stelle e "Ti ha cercato", poi i visibili senza sblocco, poi
 * le ondate dalla più vecchia alla più nuova. Solo per i lead visibili.
 */
export function rangoOndata(lista: readonly LeadScorta[], ora: Date): Map<string, number> {
    const visibili = lista.filter(l => visibileInPrimaChiamata(l, ora))
    const daSblocco = (l: LeadScorta) => !sempreVisibile(l, ora) && l.scortaStato === 'visibile' && l.scortaDal !== null
    const ondate = [...new Set(visibili.filter(daSblocco).map(l => l.scortaDal!.getTime()))].sort((a, b) => a - b)
    const indice = new Map(ondate.map((t, i) => [t, i]))
    const n = ondate.length
    const out = new Map<string, number>()
    for (const l of visibili) {
        // Black Friday sopra tutto, vergini compresi (PO 07/11/2026).
        if (eBlackFriday(l)) out.set(l.id, n + 3)
        else if (eVergine(l, ora)) out.set(l.id, n + 2)
        else if (sempreVisibile(l, ora)) out.set(l.id, n + 1)
        else if (daSblocco(l)) out.set(l.id, n - 1 - indice.get(l.scortaDal!.getTime())!)
        else out.set(l.id, n)
    }
    return out
}

/**
 * I primi `quanti` della scorta nell'ordine di uscita, senza guardare se il
 * GDO ha ancora da chiamare: lo sblocco automatico (daSbloccare) e quello
 * manuale dell'admin dal monitor di /import.
 */
export function primiDellaScorta<T extends LeadScorta>(lista: readonly T[], quanti = SBLOCCO): string[] {
    return ordinaScorta(lista.filter(l => l.scortaStato === 'scorta' && !l.cercato && !eBlackFriday(l))).slice(0, quanti).map(l => l.id)
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

/**
 * La lista con gli stati appena scritti. `sbloccati`: visibili usciti da uno
 * sblocco, con scortaDal = quando (la loro ondata, vedi rangoOndata).
 */
export function applicaScritti<T extends LeadScorta>(lista: readonly T[], scritti: { visibili: string[]; scorta: string[]; sbloccati?: string[] }, quando: Date = new Date()): T[] {
    const v = new Set(scritti.visibili)
    const s = new Set(scritti.scorta)
    const sb = new Set(scritti.sbloccati ?? [])
    return lista.map(l => sb.has(l.id) ? { ...l, scortaStato: 'visibile', scortaDal: quando }
        : v.has(l.id) ? { ...l, scortaStato: 'visibile', scortaDal: null }
        : s.has(l.id) ? { ...l, scortaStato: 'scorta', scortaDal: quando }
            : l)
}
