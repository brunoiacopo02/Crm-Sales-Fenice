// Conti puri della pagina /statistiche-fissatore (rifatta il 28/10/2026, PO).
//
// Due coorti, tutte e due per mese di Roma:
//  A. funnel del bot: lead il cui primo ASSIGNED li dà all'account del bot e
//     cade nel mese (prova e lancio esclusi a monte);
//  B. linea del piano: appuntamenti fissati dal bot con appointmentDate nel
//     mese e già passati.
// C. è un pezzo della A: i lead ridati dal bot e come li lavorano i GDO.
// La lettura dal database è in src/app/actions/fissatoreStatsActions.ts: qui
// solo regole, così i test le fissano.

import { isNeverAnsweredLog, isFunnelClosure } from '@/lib/kpi/canon'
import { toRomeDateStr } from '@/lib/dateUtils'
import { eLeadDelLancio } from '@/lib/diretta/instradamento'

/**
 * Lead evergreen: il bot si misura solo su questi (PO 28/10/2026).
 * Fuori i lanci (launchBucket, funnel del lancio, pool del lancio, prova
 * umani del lancio), le infornate da liste (intakeBatch, per esempio il flood
 * del 15/09) e il database (funnel 'Database', in qualunque maiuscola).
 * Nel codice non c'era un helper "evergreen": è questo.
 */
export function eLeadEvergreen(l: {
    launchBucket: string | null
    intakeBatch: string | null
    funnel: string | null
    lancioPool: string | null
    humanTestCohort: string | null
}): boolean {
    if (l.launchBucket || l.intakeBatch) return false
    if ((l.funnel ?? '').trim().toLowerCase() === 'database') return false
    return !eLeadDelLancio(l)
}

export type Semaforo = 'verde' | 'rosso'
/** 'alto' = più alto è meglio; 'basso' = più basso è meglio (restituzioni). */
export type Direzione = 'alto' | 'basso'

/** num/den in percentuale (0-100), null se il denominatore è zero. */
export function percentuale(num: number, den: number): number | null {
    return den > 0 ? (num / den) * 100 : null
}

/** Verde alla soglia o meglio, rosso sotto; nessun colore se manca qualcosa. */
export function semaforo(valore: number | null, soglia: number | null, direzione: Direzione): Semaforo | null {
    if (valore === null || soglia === null) return null
    const ok = direzione === 'alto' ? valore >= soglia : valore <= soglia
    return ok ? 'verde' : 'rosso'
}

/** Differenza col mese prima (punti per i tassi, unità per i conteggi). */
export function confronto(questo: number | null, prima: number | null): number | null {
    if (questo === null || prima === null) return null
    return questo - prima
}

// ------------------------------------------------------------------ mesi

const RE_MESE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Il mese del parametro se valido e non futuro, altrimenti il mese corrente di Roma. */
export function meseDaParametro(param: string | undefined | null, ora: Date): string {
    const corrente = toRomeDateStr(ora).slice(0, 7)
    if (!param || !RE_MESE.test(param)) return corrente
    return param > corrente ? corrente : param
}

export function mesePrecedente(mese: string): string {
    const [a, m] = mese.split('-').map(Number)
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}

// ------------------------------------------------------------------ A. funnel del bot

export type MotivoRestituzione = 'mai_risposto' | 'chat_interrotta'

export interface LeadDelBot {
    /** Primo ASSIGNED, quello che lo ha dato al bot. */
    assegnatoIl: Date
    /** callLogs scritti dal bot sul lead. */
    logDelBot: { outcome: string; discardReason: string | null; at: Date }[]
    /** Prima restituzione dal bot (REASSIGNED_FROM_BOT), se c'è. */
    restituzione: { reason: string | null; toGdo: string | null; at: Date } | null
    /** Istanti degli eventi BOT_REPORT, INBOUND_MESSAGE e BOT_CONTACT_REQUEST del lead. */
    segnali: Date[]
    /** Assegnatario di oggi: null = nessuno lo ha in carico. */
    assignedToId: string | null
}

/**
 * Il lead ha risposto al bot (stima del CRM, il bot non ci manda la chat):
 * appuntamento o scarto del bot (non "numero inesistente"), restituzione per
 * chat interrotta, oppure un report, un messaggio in entrata o una richiesta
 * di contatto.
 *
 * Contano solo i segnali mentre il lead è del bot, cioè da `assegnatoIl` fino
 * alla prima restituzione esclusa: dopo, agenda e riscaldamento dei GDO
 * passano dai numeri del bot e gonfierebbero il dato (coordinatore 28/10/2026).
 *
 * Eccezione: un lead fissato dal bot ha sempre risposto, anche se il bot lo
 * ha fissato dopo averlo restituito. I fissati contano tutti gli appuntamenti
 * del bot (come il piano), e così il fissaggio su chi risponde resta coerente.
 */
export function haRisposto(l: Pick<LeadDelBot, 'assegnatoIl' | 'logDelBot' | 'restituzione' | 'segnali'>): boolean {
    if (l.restituzione?.reason === 'chat_interrotta') return true
    if (l.logDelBot.some(c => c.outcome === 'APPUNTAMENTO')) return true
    const fine = l.restituzione?.at ?? null
    const dentro = (d: Date) => d >= l.assegnatoIl && (fine === null || d < fine)
    if (l.segnali.some(dentro)) return true
    return l.logDelBot.some(c => dentro(c.at) && (
        c.outcome === 'APPUNTAMENTO'
        || (c.outcome === 'DA_SCARTARE' && !isNeverAnsweredLog(c.outcome, c.discardReason))))
}

export interface RestituzioniPerMotivo {
    totale: number
    /** Date a un GDO (metadata.toGdo non nullo). */
    aUnGdo: number
    /** Non date a nessuno (toGdo nullo: parcheggiati, IA vocale). */
    parcheggiati: number
    /** Oggi senza assegnatario. */
    ancoraDaChiamare: number
}

export interface FunnelDelBot {
    ricevuti: number
    risposti: number
    fissati: number
    restituiti: number
    pctRisposta: number | null
    pctFissaggioTotale: number | null
    pctFissaggioRisposti: number | null
    pctRestituzione: number | null
    maiRisposto: RestituzioniPerMotivo
    chatInterrotta: RestituzioniPerMotivo
}

function perMotivo(leads: LeadDelBot[], motivo: MotivoRestituzione): RestituzioniPerMotivo {
    const r = leads.filter(l => l.restituzione?.reason === motivo)
    const aUnGdo = r.filter(l => !!l.restituzione?.toGdo).length
    return {
        totale: r.length,
        aUnGdo,
        parcheggiati: r.length - aUnGdo,
        ancoraDaChiamare: r.filter(l => l.assignedToId === null).length,
    }
}

export function funnelDelBot(leads: LeadDelBot[]): FunnelDelBot {
    const ricevuti = leads.length
    const risposti = leads.filter(haRisposto).length
    const fissati = leads.filter(l => l.logDelBot.some(c => c.outcome === 'APPUNTAMENTO')).length
    const restituiti = leads.filter(l => l.restituzione !== null).length
    return {
        ricevuti,
        risposti,
        fissati,
        restituiti,
        pctRisposta: percentuale(risposti, ricevuti),
        pctFissaggioTotale: percentuale(fissati, ricevuti),
        pctFissaggioRisposti: percentuale(fissati, risposti),
        pctRestituzione: percentuale(restituiti, ricevuti),
        maiRisposto: perMotivo(leads, 'mai_risposto'),
        chatInterrotta: perMotivo(leads, 'chat_interrotta'),
    }
}

// ------------------------------------------------------------------ B. linea del piano

export interface AppuntamentoDelBot {
    confirmationsOutcome: string | null
    /** Latch della presenza (PO 2026-07-17). */
    presentedAt: Date | null
    salespersonOutcome: string | null
}

export interface LineaDelPiano {
    appuntamenti: number
    confermati: number
    /** Confermati che si sono presentati. */
    presentatiConfermati: number
    /** Tutti i presentati della coorte: base del closing. */
    presentati: number
    /** Chiusi con presenza (isFunnelClosure). */
    chiusi: number
    /** Presentati ancora senza esito del venditore. */
    inLavorazione: number
    pctConferma: number | null
    pctPresenza: number | null
    pctClosing: number | null
}

export function lineaDelPiano(app: AppuntamentoDelBot[]): LineaDelPiano {
    const confermati = app.filter(a => a.confirmationsOutcome === 'confermato')
    const presentatiConfermati = confermati.filter(a => a.presentedAt !== null).length
    const presentati = app.filter(a => a.presentedAt !== null)
    const chiusi = presentati.filter(isFunnelClosure).length
    const inLavorazione = presentati.filter(a => !a.salespersonOutcome).length
    return {
        appuntamenti: app.length,
        confermati: confermati.length,
        presentatiConfermati,
        presentati: presentati.length,
        chiusi,
        inLavorazione,
        pctConferma: percentuale(confermati.length, app.length),
        pctPresenza: percentuale(presentatiConfermati, confermati.length),
        pctClosing: percentuale(chiusi, presentati.length),
    }
}

// ------------------------------------------------------------------ C. i ridati nelle mani dei GDO

/**
 * Lead della coorte A ridato dal bot (PO 28/10/2026). `fissaggi` sono le
 * chiamate APPUNTAMENTO sul lead, del bot e dei GDO, dall'inizio del periodo.
 * I campi dell'appuntamento sono quelli di oggi sul lead.
 */
export interface LeadRidato extends AppuntamentoDelBot {
    restituzione: { reason: string | null; toGdo: string | null; at: Date }
    assignedToId: string | null
    fissaggi: { at: Date; delBot: boolean }[]
    appointmentDate: Date | null
}

export interface LavoroGdo extends LineaDelPiano {
    /** Ridati dal bot con questo motivo. */
    ridati: number
    /** Dati a un GDO (metadata.toGdo non nullo): la base del gruppo. */
    aUnGdo: number
    /** Ridati che oggi non ha in carico nessuno. */
    ancoraDaChiamare: number
    /** Passati a un GDO con un appuntamento di un GDO dopo la restituzione. */
    fissati: number
    pctFissati: number | null
    /** Appuntamenti dei GDO già passati: la base delle conferme. */
    appuntamentiPassati: number
}

export interface LavoroDeiGdo {
    chatInterrotta: LavoroGdo
    maiRisposto: LavoroGdo
    /** I due gruppi insieme (altri motivi di restituzione fuori). */
    totale: LavoroGdo
}

/**
 * Fissati dai GDO: almeno un APPUNTAMENTO di un GDO (non il bot) dopo la
 * restituzione; un appuntamento del bot, prima o dopo, non conta.
 * Conferme, presenze e chiusure guardano l'appuntamento di oggi sul lead, solo
 * se è ancora quello di un GDO (l'ultimo fissaggio dopo la restituzione non è
 * del bot) e se è già passato.
 */
function gruppo(leads: LeadRidato[], ora: Date): LavoroGdo {
    const aUnGdo = leads.filter(l => !!l.restituzione.toGdo)
    const dopo = (l: LeadRidato) => l.fissaggi.filter(f => f.at >= l.restituzione.at)
    const fissati = aUnGdo.filter(l => dopo(l).some(f => !f.delBot))
    const passati = fissati.filter(l => {
        const ultimo = dopo(l).reduce((a, b) => (b.at > a.at ? b : a))
        return !ultimo.delBot && l.appointmentDate !== null && l.appointmentDate < ora
    })
    return {
        ...lineaDelPiano(passati),
        ridati: leads.length,
        aUnGdo: aUnGdo.length,
        ancoraDaChiamare: leads.filter(l => l.assignedToId === null).length,
        fissati: fissati.length,
        pctFissati: percentuale(fissati.length, aUnGdo.length),
        appuntamentiPassati: passati.length,
    }
}

/** Ridati dal bot nelle mani dei GDO, per motivo: "chat interrotta" e "mai risposto", più il totale dei due. */
export function lavoroDeiGdo(leads: LeadRidato[], ora: Date): LavoroDeiGdo {
    const chat = leads.filter(l => l.restituzione.reason === 'chat_interrotta')
    const mai = leads.filter(l => l.restituzione.reason === 'mai_risposto')
    return {
        chatInterrotta: gruppo(chat, ora),
        maiRisposto: gruppo(mai, ora),
        totale: gruppo([...chat, ...mai], ora),
    }
}
