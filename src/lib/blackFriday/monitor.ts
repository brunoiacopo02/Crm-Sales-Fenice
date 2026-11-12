// Monitor del Black Friday (PO 09/11/2026): i conti della pagina
// /admin/diretta/black-friday, puri e testati. Le letture stanno in
// monitorDb.ts. Tutto è JSON (stringhe ISO e numeri): il risultato passa per
// la cache di Next.
//
// Regola del PO sulle percentuali: risposta e fissaggio si calcolano SEMPRE
// sul totale dei lead (o delle chat), come per i GDO, mai su "raggiunti" o
// "su chi risponde". Unica eccezione Mario Sonnet/Opus: il braccio si sceglie
// alla prima risposta, quindi lì il fissaggio si legge anche su chi ha risposto.
//
// Chat, messaggi consegnati, risposte, numero WhatsApp e versione di Mario
// arrivano dal bot (`/api/bot/statistiche-bf`, campo `bot`): se il bot non
// risponde `bot` è null e la pagina resta in piedi coi soli dati del CRM.
//
// Le percentuali "come nel Sales Manager" usano le definizioni della tabella
// Numeri mensili di Panoramica Generale (panoramicaActions.metricsOverviewForCompany)
// e la stessa attribuzione degli stadi (stageHits di src/lib/kpi/funnelStages.ts).

import { toRomeDateStr } from '@/lib/dateUtils'
import { shiftWindow, type GamificationTargets } from '@/lib/diretta/config'
import { stageHits, type FunnelStageLead } from '@/lib/kpi/funnelStages'

export interface LeadBf {
    id: string
    /**
     * Data di ingresso nel Black Friday (ingressoBf): la creazione per chi nasce
     * BF, la conversione per chi lo diventa dopo. Giorno dell'imbuto, età e ritardi
     * partono da qui; chiamate, ridati e stadi di prima non contano.
     */
    createdAt: Date
    utmSource: string | null
    status: string
    assignedToId: string | null
    appointmentDate: Date | null
    confirmationsOutcome: string | null
    confirmationsDiscardReason: string | null
    presentedAt: Date | null
    salespersonOutcome: string | null
    closeAmountEur: number | null
    closeProduct: string | null
    // Date degli stadi, per le percentuali come nel Sales Manager (stageHits).
    appointmentCreatedAt: Date | null
    confirmationsTimestamp: Date | null
    salespersonOutcomeAt: Date | null
    /** Chiave persona (chiavePersona del telefono): serve solo ad agganciare le chiusure su altre schede. */
    persona?: string | null
}

/**
 * Esito "Chiuso" dal 7/11 su una scheda FUORI dal monitor (es. la scheda vecchia
 * di chi si è iscritto al Black Friday dall'email e ha firmato lì).
 */
export interface ChiusuraAltrove {
    leadId: string
    persona: string | null
    /** salespersonOutcomeAt della scheda. */
    at: Date
    closeAmountEur: number | null
    closeProduct: string | null
}

/** Stato della chat del lead BF, dal bot. */
export interface BotLeadBf {
    leadId: string
    conversationId: number | null
    /** true = chat nata col BF; false = già nota al bot; null = nessuna chat. */
    chatNuova: boolean | null
    conChat: boolean
    consegnato: boolean
    risposto: boolean
    waNumber: string | null
    braccio: string | null
    /** bot_outcome scritto dopo l'ingresso BF, altrimenti null. */
    esitoBot: string | null
}
/** Chat nate dal 7/11 per funnel attuale della chat, dal bot. */
export interface BotFunnelChat { funnel: string; chat: number; risposto: number; appuntamenti: number; etaMediaOre: number | null }
export interface DatiBotBf { lettoAlle: string; leads: BotLeadBf[]; funnel: BotFunnelChat[] }

/** Contatori degli stadi come nel Sales Manager. */
export interface StadiSm { app: number; conferme: number; presenze: number; presenzeConfermate: number; chiusi: number; euro: number }
/** Gli altri funnel nello stesso periodo: lead entrati e stadi. */
export interface AltriFunnelSm { lead: number; stadi: StadiSm }

/** REASSIGNED_FROM_BOT del lead. `manuale` = passaggio fatto a mano (metadata.motivo), fuori dai ridati. */
export interface EventoBf { leadId: string; eventType: string; reason: string | null; manuale: boolean; at: Date }
export interface ChiamataBf { leadId: string; userId: string | null; outcome: string; at: Date }
export interface GdoBf { id: string; codice: number | null; nome: string; attivo: boolean; bot: boolean }
/** Lead aperti (NEW / IN_PROGRESS) del GDO, su tutti i funnel. */
export interface CaricoGdo { userId: string; aperti: number; maiChiamati: number; richiamiOggi: number; richiamiScaduti: number }
/** callLogs di oggi (giorno di Roma) del GDO. */
export interface AttivitaGdo { userId: string; chiamate: number; appuntamenti: number }
/** Lead entrati dal 7/11 e passati dal bot (BOT_PUSHED), per funnel. */
export interface FunnelBot { funnel: string; lead: number; appuntamenti: number; etaMediaOre: number }

export interface InputMonitorBf {
    adesso: Date
    inizio: Date
    leads: LeadBf[]
    eventi: EventoBf[]
    chiamate: ChiamataBf[]
    gdo: GdoBf[]
    carichi: CaricoGdo[]
    attivita: AttivitaGdo[]
    funnelBot: FunnelBot[]
    /** Dati del bot; null se il bot non ha risposto. */
    bot: DatiBotBf | null
    /** Turni dei GDO (DEFAULT_TARGETS + appSettings gamification_targets). */
    turni: GamificationTargets
    /** Altri funnel nello stesso periodo, per le percentuali come nel Sales Manager; null se non letti. */
    altriSm: AltriFunnelSm | null
    /** Chiusure dal 7/11 sulle schede fuori dal monitor (vedi attribuisciChiusureAltrove). */
    chiusureAltrove?: ChiusuraAltrove[]
}

export const BF_FUNNEL = 'BLACK FRIDAY'

// ── Perimetro (PO 09/11/2026) ──
// Un lead è del monitor se ha funnel BLACK FRIDAY e (è nato dal 7/11 oppure è
// diventato BF dal 7/11). Un lead diventa BF dopo la nascita in tre modi, e
// ognuno lascia un evento in leadEvents:
//  - /api/admin/bf-converti                       → BF_CONVERTITO
//  - webhook AC, BF su un lead delle ultime 24 ore → AC_UPDATED con changes ['funnel → BLACK FRIDAY']
//  - webhook AC `update` su un lead SCONOSCIUTO    → AC_UPDATED con changes ['funnel → BLACK FRIDAY']
/** Evento della conversione fatta da /api/admin/bf-converti. */
export const EVENTO_BF_CONVERTITO = 'BF_CONVERTITO'
/** Voce di metadata.changes che il webhook AC scrive in AC_UPDATED quando il lead diventa BF. */
export const CAMBIO_FUNNEL_BF = `funnel → ${BF_FUNNEL}`

/** L'evento segna un lead diventato BLACK FRIDAY? */
export function eConversioneBf(e: { eventType: string; changes?: unknown }): boolean {
    if (e.eventType === EVENTO_BF_CONVERTITO) return true
    return e.eventType === 'AC_UPDATED' && Array.isArray(e.changes) && e.changes.includes(CAMBIO_FUNNEL_BF)
}

/**
 * Data di ingresso BF di un lead col funnel BLACK FRIDAY, o null se fuori dal
 * perimetro. `convertitoAt` = prima conversione dal 7/11 (null se mai convertito):
 * per un convertito vale la conversione, anche se il lead è nato dopo il 7/11.
 */
export function ingressoBf(createdAt: Date, convertitoAt: Date | null, inizio: Date): Date | null {
    if (convertitoAt && convertitoAt >= inizio) return convertitoAt > createdAt ? convertitoAt : createdAt
    return createdAt >= inizio ? createdAt : null
}

// ── Vendite per persona (PO 12/11/2026) ──
// Una vendita Black Friday si conta per PERSONA (stesse ultime 10 cifre del
// telefono): chi si iscrive al BF e firma su un'altra sua scheda (di solito la
// vecchia, perché la scheda BF è stata chiusa come doppione) è una vendita BF.

/** Chiave persona: le ultime 10 cifre del telefono; null se le cifre sono meno di 10. */
export function chiavePersona(telefono: string | null | undefined): string | null {
    const cifre = (telefono ?? '').replace(/\D/g, '')
    return cifre.length >= 10 ? cifre.slice(-10) : null
}

/** Una chiusura su un'altra scheda contata per il Black Friday. */
export interface ChiusuraAttribuita { leadBfId: string; leadChiusuraId: string; at: Date; closeAmountEur: number | null; closeProduct: string | null }

/**
 * Porta sulla scheda BF le chiusure fatte su un'altra scheda della stessa persona.
 * Regole:
 *  - conta solo una chiusura con data successiva o uguale all'ingresso della PRIMA
 *    scheda BF della persona: una chiusura precedente è un già cliente che si iscrive;
 *  - una persona conta una volta sola: se una sua scheda BF è già "Chiuso" non si
 *    aggiunge niente, e con più schede BF la vendita va sulla prima (il suo canale);
 *  - con più chiusure valide vale la prima.
 * La scheda BF scelta esce con esito "Chiuso", data, importo e prodotto di quella
 * chiusura; il resto (appuntamento, conferma, presenza) resta com'è.
 */
export function attribuisciChiusureAltrove(leads: LeadBf[], chiusure: ChiusuraAltrove[]): { leads: LeadBf[]; attribuite: ChiusuraAttribuita[] } {
    if (chiusure.length === 0) return { leads, attribuite: [] }
    const idBf = new Set(leads.map(l => l.id))
    const perPersona = new Map<string, ChiusuraAltrove[]>()
    for (const c of chiusure) {
        if (!c.persona || idBf.has(c.leadId)) continue
        perPersona.set(c.persona, [...(perPersona.get(c.persona) ?? []), c])
    }
    const schede = new Map<string, LeadBf[]>()
    for (const l of leads) {
        if (!l.persona || !perPersona.has(l.persona)) continue
        schede.set(l.persona, [...(schede.get(l.persona) ?? []), l])
    }
    const attribuite: ChiusuraAttribuita[] = []
    for (const [persona, sue] of schede) {
        if (sue.some(l => l.salespersonOutcome === 'Chiuso')) continue
        const prima = sue.reduce((a, b) => (b.createdAt < a.createdAt ? b : a))
        const valida = perPersona.get(persona)!
            .filter(c => c.at >= prima.createdAt)
            .sort((a, b) => a.at.getTime() - b.at.getTime())[0]
        if (!valida) continue
        attribuite.push({ leadBfId: prima.id, leadChiusuraId: valida.leadId, at: valida.at, closeAmountEur: valida.closeAmountEur, closeProduct: valida.closeProduct })
    }
    if (attribuite.length === 0) return { leads, attribuite }
    const perLead = new Map(attribuite.map(a => [a.leadBfId, a]))
    return {
        leads: leads.map(l => {
            const a = perLead.get(l.id)
            return a ? { ...l, salespersonOutcome: 'Chiuso', salespersonOutcomeAt: a.at, closeAmountEur: a.closeAmountEur, closeProduct: a.closeProduct } : l
        }),
        attribuite,
    }
}

/** ORE DI TURNO GDO oltre le quali un ridato dal bot non ancora chiamato va segnalato (PO 09/11/2026). */
export const ORE_RIDATO_NON_CHIAMATO = 2
/** Numero WhatsApp segnalato se ha almeno questi lead BF... */
export const MIN_LEAD_NUMERO = 5
/** ...e risponde un numero di punti percentuali in meno della media BF, oppure... */
export const PUNTI_RESA_BASSA = 15
/** ...l'apertura arriva a meno di questa quota dei suoi lead. */
export const PCT_CONSEGNA_MINIMA = 80
/** Ore dall'ingresso oltre le quali un lead ancora col bot, senza appuntamento, è fermo. */
export const ORE_FERMO_SUL_BOT = 48
/** Ore dopo l'orario della call oltre le quali un appuntamento senza esito va segnalato. */
export const ORE_APPUNTAMENTO_SENZA_ESITO = 3

const APERTI = new Set(['NEW', 'IN_PROGRESS'])
const ORA_MS = 3_600_000

export function pct(n: number, d: number): number | null {
    return d ? Math.round((1000 * n) / d) / 10 : null
}

/** Giorni di Roma (YYYY-MM-DD) da `inizio` a `adesso` compresi. */
export function giorniDal(inizio: Date, adesso: Date): string[] {
    const fine = toRomeDateStr(adesso)
    const out: string[] = []
    const d = new Date(`${toRomeDateStr(inizio)}T12:00:00Z`)
    for (let i = 0; i < 400; i++) {
        const g = d.toISOString().slice(0, 10)
        if (g > fine) break
        out.push(g)
        d.setUTCDate(d.getUTCDate() + 1)
    }
    return out
}

/**
 * Ore di turno GDO fra `da` e `a` (PO 09/11/2026): solo le ore dentro il turno
 * del giorno (feriali turnoFeriale, sabato turnoSabato, domenica niente), non
 * quelle di orologio. Un ridato alle 19:30 di venerdì e ancora fermo lunedì
 * alle 14:00 ha 0,5 + 6,5 + 0,5 = 7,5 ore di turno.
 */
export function oreDiTurno(da: Date, a: Date, turni: GamificationTargets): number {
    if (a <= da) return 0
    let totale = 0
    for (const g of giorniDal(da, a)) {
        const w = shiftWindow(new Date(`${g}T12:00:00Z`), turni)
        if (!w) continue
        const inizio = Math.max(w.start.getTime(), da.getTime())
        const fine = Math.min(w.end.getTime(), a.getTime())
        if (fine > inizio) totale += fine - inizio
    }
    return totale / ORA_MS
}

// ── Percentuali come nel Sales Manager ──────────────────────────────────

const MAI = new Date(8.64e15)

/**
 * Stadi del periodo [inizio, fine) con la regola di Panoramica Generale
 * (stageHits): app su apptSetAt, conferme su confirmationsTimestamp con esito
 * 'confermato', presenze sul latch presentedAt, chiusure su salespersonOutcomeAt
 * con esito 'Chiuso'. presenzeConfermate = presenze con esito 'confermato'
 * (la riga "Trattative presenziati" toglie dalla % le presenze fuori Conferme).
 */
export function stadiSm(righe: (FunnelStageLead & { confirmationsOutcome: string | null })[], inizio: Date, fine: Date = MAI): StadiSm {
    const s: StadiSm = { app: 0, conferme: 0, presenze: 0, presenzeConfermate: 0, chiusi: 0, euro: 0 }
    for (const l of righe) {
        const h = stageHits(l, inizio, fine)
        if (h.app) s.app++
        if (h.conferme) s.conferme++
        if (h.trattative) {
            s.presenze++
            if (l.confirmationsOutcome === 'confermato') s.presenzeConfermate++
        }
        if (h.close) { s.chiusi++; s.euro += h.fatturato }
    }
    return s
}

export interface CascataSm extends StadiSm {
    lead: number
    /** Appuntamenti fissati / lead ("Appuntamenti fissati", % ACT). */
    pctFissaggio: number | null
    /** Confermati / appuntamenti fissati ("Appuntamenti Confermati"). */
    pctConferme: number | null
    /** Presenze passate dalle Conferme / confermati ("Trattative presenziati"). */
    pctPresenze: number | null
    /** Chiusi / presenze ("Closed"). */
    pctChiusure: number | null
}

/** Le % a cascata della tabella Numeri mensili del Sales Manager, con gli stessi denominatori. */
export function cascataSm(lead: number, s: StadiSm): CascataSm {
    return {
        lead, ...s,
        pctFissaggio: pct(s.app, lead),
        pctConferme: pct(s.conferme, s.app),
        pctPresenze: pct(s.presenzeConfermate, s.conferme),
        pctChiusure: pct(s.chiusi, s.presenze),
    }
}

/** "whatsapp:+393520158061" → "8061". */
export function sigleNumero(wa: string | null): string {
    const cifre = (wa ?? '').replace(/\D/g, '')
    return cifre.length >= 4 ? cifre.slice(-4) : 'nessuno'
}

export type Canale = 'meta' | 'instagram' | 'email' | 'telegram' | 'altro'
export const NOMI_CANALE: Record<Canale, string> = {
    meta: 'Inserzioni Meta', instagram: 'Instagram', email: 'Email al database', telegram: 'Telegram', altro: 'Altro',
}

/** Canale dal utmSource dei lead BF (Meta, bioorg, Email, Telegram, ...). */
export function canaleDi(utmSource: string | null): Canale {
    const s = (utmSource ?? '').trim().toLowerCase()
    if (s === 'meta') return 'meta'
    if (s === 'bioorg' || s.includes('instagram')) return 'instagram'
    if (s.startsWith('email')) return 'email'
    if (s === 'telegram') return 'telegram'
    return 'altro'
}

export interface Imbuto {
    entrati: number
    /** Dal bot; null se il bot non ha risposto. Percentuali sui lead entrati. */
    conChat: number | null
    consegnato: number | null
    risposto: number | null
    pctConChat: number | null
    pctConsegnato: number | null
    pctRisposto: number | null
    appuntamenti: number
    pctAppuntamenti: number | null
    confermati: number
    scartati: number
    motiviScarto: Record<string, number>
    inAttesa: number
    presenti: number
    chiusi: number
    euroChiusi: number
    nonChiusi: number
    futuri: number
}

export type ChiaveEsito =
    | 'appuntamento_bot' | 'appuntamento_gdo' | 'scartato_bot' | 'ridato_mai_risposto'
    | 'ridato_chat_interrotta' | 'tolto_a_mano' | 'col_bot' | 'altro'

export const NOMI_ESITO: Record<ChiaveEsito, string> = {
    appuntamento_bot: 'Appuntamento fissato dal bot',
    appuntamento_gdo: 'Appuntamento fissato da un GDO',
    scartato_bot: 'Scartato dal bot',
    ridato_mai_risposto: 'Ridato ai GDO: mai risposto',
    ridato_chat_interrotta: 'Ridato ai GDO: chat interrotta',
    tolto_a_mano: 'Tolto al bot a mano',
    col_bot: 'Ancora col bot',
    altro: 'Mai arrivato al bot o senza assegnatario',
}
const ORDINE_ESITI: ChiaveEsito[] = [
    'appuntamento_bot', 'appuntamento_gdo', 'scartato_bot', 'ridato_mai_risposto',
    'ridato_chat_interrotta', 'tolto_a_mano', 'col_bot', 'altro',
]

export interface RigaGdo {
    codice: number | null
    nome: string
    attivo: boolean
    aperti: number
    maiChiamati: number
    richiamiOggi: number
    richiamiScaduti: number
    chiamateOggi: number
    appuntamentiOggi: number
    bfInMano: number
    bfDaChiamare: number
}

export interface Attenzione { chiave: string; numero: number; titolo: string; testo: string }

/** Una riga del confronto. `lead` = lead o chat del gruppo; tutte le % su `lead`. */
export interface RigaConfronto {
    funnel: string
    lead: number
    risposto: number | null
    pctRisposto: number | null
    appuntamenti: number
    pctAppuntamenti: number | null
    etaMediaOre: number | null
}

/** Gruppo di lead BF (nuovi/noti, numero WhatsApp, braccio di Mario): % sui lead del gruppo. */
export interface RigaGruppo {
    chiave: string
    nome: string
    lead: number
    consegnato: number
    pctConsegnato: number | null
    risposto: number
    pctRisposto: number | null
    appuntamenti: number
    pctAppuntamenti: number | null
    /** Solo per Mario: appuntamenti su chi ha risposto (eccezione del PO). */
    pctAppuntamentiSuRisposto: number | null
}

export interface MonitorBf {
    calcolatoAlle: string
    inizio: string
    imbuto: { totale: Imbuto; giorni: { giorno: string; dati: Imbuto }[] }
    esiti: { totale: number; voci: { chiave: ChiaveEsito; nome: string; lead: number; pct: number | null }[] }
    ridati: {
        totale: number
        perMotivo: Record<string, number>
        tornatiConAppuntamentoDalBot: number
        chiamatiDaGdo: number
        fissatiDaiGdo: number
        daChiamare: number
    }
    canali: { chiave: Canale; nome: string; lead: number; risposto: number | null; pctRisposto: number | null; appuntamenti: number; pctAppuntamenti: number | null; presenti: number; chiusi: number }[]
    /**
     * Confronto coi funnel del bot. fonte 'bot': chat nate dal 7/11 per funnel
     * (database del bot), più "BF tutti i lead" dal CRM con le risposte del bot.
     * fonte 'crm': lead passati dal bot (BOT_PUSHED), senza risposte.
     */
    confronto: { fonte: 'bot' | 'crm'; bfTutti: RigaConfronto; bfChatNuove: RigaConfronto | null; altri: RigaConfronto; dettaglio: RigaConfronto[] }
    /** Dal bot; null se il bot non ha risposto. */
    bot: {
        lettoAlle: string
        nuoviNoti: RigaGruppo[]
        numeri: RigaGruppo[]
        mario: RigaGruppo[]
    } | null
    /** Percentuali come nel Sales Manager: BF totale, BF per giorno di ingresso, altri funnel nello stesso periodo. */
    salesManager: { bf: CascataSm; giorni: { giorno: string; dati: CascataSm }[]; altri: CascataSm | null }
    gdo: {
        righe: RigaGdo[]
        bot: { bfInMano: number; conAppuntamento: number; aperti: number; scartati: number }
        bfSenzaAssegnatario: number
    }
    attenzioni: Attenzione[]
    controlli: { ok: boolean; errori: string[] }
}

const haAppuntamento = (l: LeadBf) => l.appointmentDate !== null || l.status === 'APPOINTMENT'

function imbuto(a: LeadBf[], adesso: Date, bot: Map<string, BotLeadBf> | null): Imbuto {
    const app = a.filter(haAppuntamento)
    const contaBot = (f: (b: BotLeadBf) => boolean) => (bot ? a.filter(l => { const b = bot.get(l.id); return !!b && f(b) }).length : null)
    const conChat = contaBot(b => b.conChat)
    const consegnato = contaBot(b => b.consegnato)
    const risposto = contaBot(b => b.risposto)
    const pctSu = (v: number | null) => (v === null ? null : pct(v, a.length))
    const confermati = app.filter(l => l.confirmationsOutcome === 'confermato').length
    const scart = app.filter(l => l.confirmationsOutcome === 'scartato')
    const motiviScarto: Record<string, number> = {}
    for (const l of scart) {
        const m = l.confirmationsDiscardReason?.trim() || 'senza motivo'
        motiviScarto[m] = (motiviScarto[m] ?? 0) + 1
    }
    // Sui lead, non sugli appuntamenti: una vendita firmata su un'altra scheda della
    // persona (attribuisciChiusureAltrove) arriva su una scheda BF senza appuntamento.
    const chiusi = a.filter(l => l.salespersonOutcome === 'Chiuso')
    return {
        entrati: a.length,
        conChat, consegnato, risposto,
        pctConChat: pctSu(conChat), pctConsegnato: pctSu(consegnato), pctRisposto: pctSu(risposto),
        appuntamenti: app.length,
        pctAppuntamenti: pct(app.length, a.length),
        confermati,
        scartati: scart.length,
        motiviScarto,
        inAttesa: app.length - confermati - scart.length,
        presenti: app.filter(l => l.presentedAt !== null).length,
        chiusi: chiusi.length,
        euroChiusi: chiusi.reduce((s, l) => s + (l.closeAmountEur ?? 0), 0),
        nonChiusi: app.filter(l => l.salespersonOutcome === 'Non chiuso').length,
        futuri: app.filter(l => l.appointmentDate !== null && l.appointmentDate > adesso).length,
    }
}

function rigaConfronto(funnel: string, righe: FunnelBot[]): RigaConfronto {
    const lead = righe.reduce((s, r) => s + r.lead, 0)
    const appuntamenti = righe.reduce((s, r) => s + r.appuntamenti, 0)
    const eta = lead ? Math.round((10 * righe.reduce((s, r) => s + r.etaMediaOre * r.lead, 0)) / lead) / 10 : null
    return { funnel, lead, risposto: null, pctRisposto: null, appuntamenti, pctAppuntamenti: pct(appuntamenti, lead), etaMediaOre: eta }
}

/** Riga di confronto dalle chat del bot (una o più righe di funnel sommate). */
function rigaChat(funnel: string, righe: BotFunnelChat[]): RigaConfronto {
    const lead = righe.reduce((s, r) => s + r.chat, 0)
    const risposto = righe.reduce((s, r) => s + r.risposto, 0)
    const appuntamenti = righe.reduce((s, r) => s + r.appuntamenti, 0)
    const eta = lead ? Math.round((10 * righe.reduce((s, r) => s + (r.etaMediaOre ?? 0) * r.chat, 0)) / lead) / 10 : null
    return { funnel, lead, risposto, pctRisposto: pct(risposto, lead), appuntamenti, pctAppuntamenti: pct(appuntamenti, lead), etaMediaOre: eta }
}

function gruppo(chiave: string, nome: string, a: LeadBf[], bot: Map<string, BotLeadBf>, suRisposto = false): RigaGruppo {
    const b = (l: LeadBf) => bot.get(l.id)
    const consegnato = a.filter(l => b(l)?.consegnato).length
    const risp = a.filter(l => b(l)?.risposto)
    const app = a.filter(haAppuntamento).length
    return {
        chiave, nome, lead: a.length,
        consegnato, pctConsegnato: pct(consegnato, a.length),
        risposto: risp.length, pctRisposto: pct(risp.length, a.length),
        appuntamenti: app, pctAppuntamenti: pct(app, a.length),
        pctAppuntamentiSuRisposto: suRisposto ? pct(app, risp.length) : null,
    }
}

function raggruppa(a: LeadBf[], chiaveDi: (l: LeadBf) => string): Map<string, LeadBf[]> {
    const m = new Map<string, LeadBf[]>()
    for (const l of a) {
        const k = chiaveDi(l)
        m.set(k, [...(m.get(k) ?? []), l])
    }
    return m
}

/** "Zora 5, Alessandro 3": conteggi per nome, dal più alto. */
function elencoNomi(conteggi: Map<string, number>): string {
    return [...conteggi.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, c]) => `${n} ${c}`).join(', ')
}

const piu = (n: number, una: string, tante: string) => (n === 1 ? `1 ${una}` : `${n} ${tante}`)

export function calcolaMonitorBf(input: InputMonitorBf): MonitorBf {
    const { adesso, inizio } = input
    // Vendite per persona: le chiusure su altre schede entrano qui, una volta sola.
    const { leads } = attribuisciChiusureAltrove(input.leads, input.chiusureAltrove ?? [])
    const botIds = new Set(input.gdo.filter(g => g.bot).map(g => g.id))
    const gdoPerId = new Map(input.gdo.map(g => [g.id, g]))
    const umano = (userId: string | null) => userId !== null && !botIds.has(userId)

    // Chiamate per lead, e del bot per esito.
    const chiamatePerLead = new Map<string, ChiamataBf[]>()
    // Solo la storia dal 7/11: le chiamate e i ridati di un convertito (es. un lead
    // di settembre diventato BF) di prima dell'offerta non sono lavoro sul BF.
    for (const c of input.chiamate.filter(c => c.at >= inizio)) {
        const arr = chiamatePerLead.get(c.leadId) ?? []
        arr.push(c)
        chiamatePerLead.set(c.leadId, arr)
    }
    const chiamateUmane = (leadId: string, dopo?: Date) =>
        (chiamatePerLead.get(leadId) ?? []).filter(c => umano(c.userId) && (!dopo || c.at >= dopo))
    const esitoDelBot = (leadId: string, outcome: string) =>
        (chiamatePerLead.get(leadId) ?? []).some(c => c.userId !== null && botIds.has(c.userId) && c.outcome === outcome)

    // Primo ridato (non manuale) e passaggi a mano, per lead.
    const ridato = new Map<string, EventoBf>()
    const aMano = new Set<string>()
    for (const e of input.eventi.filter(e => e.at >= inizio).sort((a, b) => a.at.getTime() - b.at.getTime())) {
        if (e.eventType !== 'REASSIGNED_FROM_BOT') continue
        if (e.manuale) { aMano.add(e.leadId); continue }
        if (!ridato.has(e.leadId)) ridato.set(e.leadId, e)
    }

    // ── Imbuto ──
    const giorni = giorniDal(inizio, adesso)
    const perGiorno = new Map<string, LeadBf[]>(giorni.map(g => [g, []]))
    for (const l of leads) {
        const g = toRomeDateStr(l.createdAt)
        if (!perGiorno.has(g)) perGiorno.set(g, [])
        perGiorno.get(g)!.push(l)
    }
    const botPerLead = input.bot ? new Map(input.bot.leads.map(b => [b.leadId, b])) : null
    const totale = imbuto(leads, adesso, botPerLead)
    const giorniOrdinati = [...perGiorno.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const giorniImbuto = giorniOrdinati.map(([giorno, a]) => ({ giorno, dati: imbuto(a, adesso, botPerLead) }))

    // ── Percentuali come nel Sales Manager ──
    const salesManager = {
        bf: cascataSm(leads.length, stadiSm(leads, inizio)),
        giorni: giorniOrdinati.map(([giorno, a]) => ({ giorno, dati: cascataSm(a.length, stadiSm(a, inizio)) })),
        altri: input.altriSm ? cascataSm(input.altriSm.lead, input.altriSm.stadi) : null,
    }

    // ── Esiti ──
    const esitoDi = (l: LeadBf): ChiaveEsito => {
        if (haAppuntamento(l)) return esitoDelBot(l.id, 'APPUNTAMENTO') ? 'appuntamento_bot' : 'appuntamento_gdo'
        if (esitoDelBot(l.id, 'DA_SCARTARE')) return 'scartato_bot'
        const r = ridato.get(l.id)
        if (r) return r.reason === 'chat_interrotta' ? 'ridato_chat_interrotta' : 'ridato_mai_risposto'
        if (aMano.has(l.id)) return 'tolto_a_mano'
        if (l.assignedToId && botIds.has(l.assignedToId)) return 'col_bot'
        return 'altro'
    }
    const conteggiEsiti = new Map<ChiaveEsito, number>()
    for (const l of leads) conteggiEsiti.set(esitoDi(l), (conteggiEsiti.get(esitoDi(l)) ?? 0) + 1)
    const voci = ORDINE_ESITI.filter(k => conteggiEsiti.has(k)).map(k => ({
        chiave: k, nome: NOMI_ESITO[k], lead: conteggiEsiti.get(k)!, pct: pct(conteggiEsiti.get(k)!, leads.length),
    }))

    // ── Ridati ──
    const leadRidati = leads.filter(l => ridato.has(l.id))
    const perMotivo: Record<string, number> = {}
    for (const l of leadRidati) {
        const m = ridato.get(l.id)!.reason ?? 'sconosciuto'
        perMotivo[m] = (perMotivo[m] ?? 0) + 1
    }
    const chiamatoDopoRidato = (l: LeadBf) => chiamateUmane(l.id, ridato.get(l.id)!.at).length > 0
    const ridatiDaChiamare = leadRidati.filter(l => !haAppuntamento(l) && APERTI.has(l.status) && !chiamatoDopoRidato(l))

    // ── Canali ──
    const perCanale = new Map<Canale, LeadBf[]>()
    for (const l of leads) {
        const c = canaleDi(l.utmSource)
        perCanale.set(c, [...(perCanale.get(c) ?? []), l])
    }
    const canali = (Object.keys(NOMI_CANALE) as Canale[]).filter(c => perCanale.has(c)).map(c => {
        const a = perCanale.get(c)!
        const app = a.filter(haAppuntamento)
        const risposto = botPerLead ? a.filter(l => botPerLead.get(l.id)?.risposto).length : null
        return {
            chiave: c, nome: NOMI_CANALE[c], lead: a.length,
            risposto, pctRisposto: risposto === null ? null : pct(risposto, a.length),
            appuntamenti: app.length, pctAppuntamenti: pct(app.length, a.length),
            presenti: app.filter(l => l.presentedAt !== null).length, chiusi: a.filter(l => l.salespersonOutcome === 'Chiuso').length,
        }
    })

    // ── Confronto coi funnel del bot ──
    const DETTAGLIO = ['CORSO 10 ORE', 'JOB SIMULATOR', 'TELEGRAM']
    const etaBf = leads.length
        ? Math.round((10 * leads.reduce((s, l) => s + (adesso.getTime() - l.createdAt.getTime()) / ORA_MS, 0)) / leads.length) / 10
        : null
    const bfTutti: RigaConfronto = {
        funnel: 'BF tutti i lead', lead: leads.length,
        risposto: totale.risposto, pctRisposto: totale.pctRisposto,
        appuntamenti: totale.appuntamenti, pctAppuntamenti: totale.pctAppuntamenti, etaMediaOre: etaBf,
    }
    let confronto: MonitorBf['confronto']
    if (input.bot) {
        const f = input.bot.funnel
        const bfChat = f.filter(x => x.funnel === BF_FUNNEL)
        confronto = {
            fonte: 'bot', bfTutti,
            bfChatNuove: bfChat.length > 0 ? rigaChat('BF solo chat nuove', bfChat) : null,
            altri: rigaChat('Tutti gli altri funnel', f.filter(x => x.funnel !== BF_FUNNEL)),
            dettaglio: DETTAGLIO.flatMap(n => { const r = f.find(x => x.funnel === n); return r ? [rigaChat(n, [r])] : [] }),
        }
    } else {
        confronto = {
            fonte: 'crm', bfTutti, bfChatNuove: null,
            altri: rigaConfronto('Tutti gli altri funnel', input.funnelBot.filter(x => x.funnel !== BF_FUNNEL)),
            dettaglio: DETTAGLIO.flatMap(n => { const r = input.funnelBot.find(x => x.funnel === n); return r ? [rigaConfronto(n, [r])] : [] }),
        }
    }

    // ── Gruppi dal bot: nuovi o già in chat, numero WhatsApp, Mario ──
    let gruppiBot: MonitorBf['bot'] = null
    if (input.bot && botPerLead) {
        const b = (l: LeadBf) => botPerLead.get(l.id)
        const nn = raggruppa(leads, l => { const c = b(l)?.chatNuova; return c === true ? 'nuovi' : c === false ? 'noti' : 'senza' })
        const NOMI_NN: Record<string, string> = { nuovi: 'Nuovi al bot', noti: 'Già in chat col bot', senza: 'Senza chat' }
        const nr = raggruppa(leads, l => sigleNumero(b(l)?.waNumber ?? null))
        const br = raggruppa(leads, l => b(l)?.braccio?.trim().toLowerCase() || 'nessuno')
        const NOMI_BR: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', nessuno: 'Mario non ha ancora risposto' }
        const ordine = (m: Map<string, LeadBf[]>, prima: string[]) =>
            [...m.keys()].sort((x, y) => {
                const ix = prima.indexOf(x), iy = prima.indexOf(y)
                if (ix !== -1 || iy !== -1) return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy)
                return (m.get(y)!.length - m.get(x)!.length) || x.localeCompare(y)
            })
        gruppiBot = {
            lettoAlle: input.bot.lettoAlle,
            nuoviNoti: ordine(nn, ['nuovi', 'noti', 'senza']).map(k => gruppo(k, NOMI_NN[k], nn.get(k)!, botPerLead)),
            numeri: ordine(nr, ['3199', '8061', '0047', '8718']).filter(k => k !== 'nessuno').concat(nr.has('nessuno') ? ['nessuno'] : [])
                .map(k => gruppo(k, k === 'nessuno' ? 'Senza chat' : `…${k}`, nr.get(k)!, botPerLead)),
            mario: ordine(br, ['sonnet', 'opus', 'nessuno']).map(k => gruppo(k, NOMI_BR[k] ?? k, br.get(k)!, botPerLead, true)),
        }
    }

    // ── Tabella GDO ──
    const bfPerUtente = new Map<string, LeadBf[]>()
    for (const l of leads) {
        if (!l.assignedToId) continue
        bfPerUtente.set(l.assignedToId, [...(bfPerUtente.get(l.assignedToId) ?? []), l])
    }
    const carico = new Map(input.carichi.map(c => [c.userId, c]))
    const attivita = new Map(input.attivita.map(a => [a.userId, a]))
    const gdoInTabella = input.gdo
        .filter(g => !g.bot && (g.attivo || (bfPerUtente.get(g.id)?.length ?? 0) > 0))
        .sort((a, b) => (a.codice ?? 9999) - (b.codice ?? 9999))
    const idInTabella = new Set(gdoInTabella.map(g => g.id))
    const righeGdo: RigaGdo[] = gdoInTabella
        .map(g => {
            const bf = bfPerUtente.get(g.id) ?? []
            const c = carico.get(g.id)
            const at = attivita.get(g.id)
            return {
                codice: g.codice, nome: g.nome, attivo: g.attivo,
                aperti: c?.aperti ?? 0, maiChiamati: c?.maiChiamati ?? 0,
                richiamiOggi: c?.richiamiOggi ?? 0, richiamiScaduti: c?.richiamiScaduti ?? 0,
                chiamateOggi: at?.chiamate ?? 0, appuntamentiOggi: at?.appuntamenti ?? 0,
                bfInMano: bf.length,
                bfDaChiamare: bf.filter(l => APERTI.has(l.status) && !haAppuntamento(l) && chiamateUmane(l.id).length === 0).length,
            }
        })
    const bfBot = leads.filter(l => l.assignedToId && botIds.has(l.assignedToId))
    const bot = {
        bfInMano: bfBot.length,
        conAppuntamento: bfBot.filter(haAppuntamento).length,
        aperti: bfBot.filter(l => APERTI.has(l.status) && !haAppuntamento(l)).length,
        scartati: bfBot.filter(l => l.status === 'REJECTED').length,
    }
    const bfSenzaAssegnatario = leads.filter(l => !l.assignedToId).length
    // Lead BF assegnati a utenti che non sono GDO (es. un admin): contano nelle somme.
    const bfAltriUtenti = leads.filter(l => l.assignedToId && !botIds.has(l.assignedToId) && !idInTabella.has(l.assignedToId)).length

    // ── Da tenere d'occhio ──
    const attenzioni: Attenzione[] = []
    const ridatiVecchi = ridatiDaChiamare.filter(l => oreDiTurno(ridato.get(l.id)!.at, adesso, input.turni) > ORE_RIDATO_NON_CHIAMATO)
    if (ridatiVecchi.length > 0) {
        const perNome = new Map<string, number>()
        for (const l of ridatiVecchi) {
            const nome = (l.assignedToId && gdoPerId.get(l.assignedToId)?.nome) || 'senza assegnatario'
            perNome.set(nome, (perNome.get(nome) ?? 0) + 1)
        }
        attenzioni.push({
            chiave: 'ridati_non_chiamati', numero: ridatiVecchi.length,
            titolo: `${piu(ridatiVecchi.length, 'lead BF ridato', 'lead BF ridati')} dal bot e non ancora chiamati da più di ${ORE_RIDATO_NON_CHIAMATO} ore di turno.`,
            testo: `Da chiamare: ${elencoNomi(perNome)}.`,
        })
    }
    const orfani = leads.filter(l => !l.assignedToId && APERTI.has(l.status) && !haAppuntamento(l))
    if (orfani.length > 0) {
        attenzioni.push({
            chiave: 'senza_assegnatario', numero: orfani.length,
            titolo: `${piu(orfani.length, 'lead BF aperto', 'lead BF aperti')} senza assegnatario.`,
            testo: 'Nessuno li lavora: né il bot né un GDO.',
        })
    }
    const fermi = bfBot.filter(l => APERTI.has(l.status) && !haAppuntamento(l) && adesso.getTime() - l.createdAt.getTime() > ORE_FERMO_SUL_BOT * ORA_MS)
    if (fermi.length > 0) {
        attenzioni.push({
            chiave: 'fermi_sul_bot', numero: fermi.length,
            titolo: `${piu(fermi.length, 'lead BF fermo', 'lead BF fermi')} sul bot da più di ${ORE_FERMO_SUL_BOT} ore.`,
            testo: 'Entrati da oltre due giorni, ancora col bot e senza appuntamento: il bot di solito li ridà dopo circa 24 ore di silenzio.',
        })
    }
    const senzaEsito = leads.filter(l => l.appointmentDate !== null
        && adesso.getTime() - l.appointmentDate.getTime() > ORE_APPUNTAMENTO_SENZA_ESITO * ORA_MS
        && l.presentedAt === null && l.salespersonOutcome === null && l.confirmationsOutcome !== 'scartato')
    if (senzaEsito.length > 0) {
        attenzioni.push({
            chiave: 'appuntamenti_senza_esito', numero: senzaEsito.length,
            titolo: `${piu(senzaEsito.length, 'appuntamento BF passato', 'appuntamenti BF passati')} senza esito.`,
            testo: `La call era più di ${ORE_APPUNTAMENTO_SENZA_ESITO} ore fa e non risultano né presenza né esito del venditore.`,
        })
    }
    // Resa bassa per numero WhatsApp: % sui lead del numero, confrontata con la media dei lead BF con chat.
    if (gruppiBot && botPerLead) {
        const conNumero = gruppiBot.numeri.filter(g => g.chiave !== 'nessuno')
        const leadConNumero = conNumero.reduce((s, g) => s + g.lead, 0)
        const media = pct(conNumero.reduce((s, g) => s + g.risposto, 0), leadConNumero)
        const bassi = conNumero.filter(g => g.lead >= MIN_LEAD_NUMERO && (
            (g.pctConsegnato ?? 0) < PCT_CONSEGNA_MINIMA
            || (media !== null && (g.pctRisposto ?? 0) <= media - PUNTI_RESA_BASSA)))
        if (bassi.length > 0) {
            attenzioni.push({
                chiave: 'resa_bassa_numero', numero: bassi.length,
                titolo: `${piu(bassi.length, 'numero WhatsApp rende', 'numeri WhatsApp rendono')} poco sui lead BF.`,
                testo: bassi.map(g => `${g.nome}: apertura consegnata al ${g.pctConsegnato ?? 0}% e risposte dal ${g.pctRisposto ?? 0}% dei suoi ${g.lead} lead`).join('; ')
                    + (media !== null ? ` (media BF con chat: risponde il ${media}%).` : '.'),
            })
        }
    }

    // ── Controlli: le somme devono tornare ──
    const errori: string[] = []
    const chiaviSomma: (keyof Imbuto)[] = ['entrati', 'appuntamenti', 'confermati', 'scartati', 'presenti', 'chiusi', 'nonChiusi', 'futuri']
    if (botPerLead) chiaviSomma.push('conChat', 'consegnato', 'risposto')
    for (const k of chiaviSomma) {
        const s = giorniImbuto.reduce((acc, g) => acc + (g.dati[k] as number), 0)
        if (s !== totale[k]) errori.push(`giorni ${k}: ${s} contro ${totale[k] as number}`)
    }
    const sommaEsiti = voci.reduce((s, v) => s + v.lead, 0)
    if (sommaEsiti !== leads.length) errori.push(`esiti: ${sommaEsiti} contro ${leads.length}`)
    const inMano = righeGdo.reduce((s, r) => s + r.bfInMano, 0) + bot.bfInMano + bfSenzaAssegnatario + bfAltriUtenti
    if (inMano !== leads.length) errori.push(`BF in mano: ${inMano} contro ${leads.length}`)

    return {
        calcolatoAlle: adesso.toISOString(),
        inizio: inizio.toISOString(),
        imbuto: { totale, giorni: giorniImbuto },
        esiti: { totale: leads.length, voci },
        ridati: {
            totale: leadRidati.length,
            perMotivo,
            tornatiConAppuntamentoDalBot: leadRidati.filter(l => haAppuntamento(l) && esitoDelBot(l.id, 'APPUNTAMENTO')).length,
            chiamatiDaGdo: leadRidati.filter(chiamatoDopoRidato).length,
            fissatiDaiGdo: leadRidati.filter(l => haAppuntamento(l) && !esitoDelBot(l.id, 'APPUNTAMENTO')).length,
            daChiamare: ridatiDaChiamare.length,
        },
        canali,
        confronto,
        bot: gruppiBot,
        salesManager,
        gdo: { righe: righeGdo, bot, bfSenzaAssegnatario },
        attenzioni,
        controlli: { ok: errori.length === 0, errori },
    }
}
