// Lead della brochure gratuita (PO 10/11/2026): i conti della pagina
// /marketing-analytics/brochure, puri e testati. Le letture stanno in
// brochureDb.ts. Tutto è JSON (stringhe ISO e numeri): il risultato passa per
// la cache di Next.
//
// CHI È UN LEAD BROCHURE. La landing "brochure-gratuita" (funnel Professioni)
// promette la scheda del corso in PDF e lascia due tracce nel CRM, che qui
// valgono entrambe (basta una):
//  - il lead arriva da ActiveCampaign con la campagna Meta della brochure
//    (oggi utm_campaign "Campagna di Ret - pdf"): si riconosce da "pdf" o
//    "brochure" in un utm;
//  - la persona scrive al bot la frase del link wa.me ("...vorrei ricevere la
//    scheda del corso"): evento INBOUND_MESSAGE con provenienza PROFESSIONI,
//    oppure il lead nasce col funnel PROFESSIONI.
// Il funnel AC di questi lead è spesso TELEGRAM: non si guarda il funnel AC.
//
// Regola del PO sulle percentuali: sempre sul totale dei lead, mai a cascata.

import { toRomeDateStr } from '@/lib/dateUtils'

export const FUNNEL_PROFESSIONI = 'PROFESSIONI'

/**
 * "pdf" come parola o "brochure" in un utm: la campagna che promette la scheda.
 * `UTM_BROCHURE_PG` e' la stessa regola per Postgres (`~*`, senza maiuscole), da
 * applicare a `concat_ws(' ', utm_source, utm_medium, utm_campaign, utm_content, utm_term)`:
 * la usano la pagina brochure e il tetto del bot (conteggioTettoBot.ts).
 */
export const UTM_BROCHURE_PG = '(brochure|(^|[^a-z])pdf([^a-z]|$))'
const UTM_BROCHURE = new RegExp(UTM_BROCHURE_PG, 'i')

/** Frase precompilata del link wa.me della landing. */
export const FRASE_SCHEDA = /scheda del corso/i

/** Un utm del lead nomina la brochure? */
export function utmDaBrochure(utm: ReadonlyArray<string | null | undefined>): boolean {
    return utm.some(v => UTM_BROCHURE.test(v ?? ''))
}

/** I sei corsi del funnel Professioni, come li scrive il bot (`conversations.professione`). */
const PROFESSIONI: Record<string, string> = {
    sviluppatore_web_ai: 'Sviluppatore Web AI',
    video_editor: 'Video Editor',
    project_manager: 'Project Manager',
    graphic_designer: 'Graphic Designer',
    copywriter: 'Copywriter',
    social_media_manager: 'Social Media Manager',
}
export const PROFESSIONE_NON_INDICATA = 'Non indicata'

const compatto = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '')
const PER_COMPATTO = new Map(Object.entries(PROFESSIONI).flatMap(([slug, nome]) => [
    [compatto(slug), nome], [compatto(nome), nome],
]))

/** Nome del corso da uno slug del bot ("social_media_manager") o da un testo ("Social Media Manager"). */
export function nomeProfessione(v: string | null | undefined): string | null {
    const t = (v ?? '').trim()
    if (!t) return null
    return PER_COMPATTO.get(compatto(t)) ?? null
}

/** Il corso dalla frase del link: "...alla professione di Video Editor e vorrei...". */
export function professioneDaFrase(frase: string | null | undefined): string | null {
    const m = /professione (?:di|del|della|dello)\s+(.+?)\s+e vorrei/i.exec(frase ?? '')
    return m ? nomeProfessione(m[1]) : null
}

/** Il lead è della brochure? */
export function eLeadBrochure(l: {
    funnel: string | null
    utm: ReadonlyArray<string | null | undefined>
    /** Ha scritto lui la frase del link (INBOUND_MESSAGE della brochure). */
    haScrittoFrase: boolean
}): boolean {
    if ((l.funnel ?? '').trim().toUpperCase() === FUNNEL_PROFESSIONI) return true
    if (l.haScrittoFrase) return true
    return utmDaBrochure(l.utm)
}

/**
 * Quando il lead entra fra quelli della brochure: la creazione per chi arriva
 * dalla campagna (form della landing su AC), altrimenti il momento in cui ha
 * scritto la frase. Un lead vecchio che scrive la frase oggi conta da oggi.
 */
export function ingressoBrochure(l: { createdAt: Date; daCampagna: boolean; scrittoIl: Date | null }): Date {
    if (l.daCampagna || !l.scrittoIl) return l.createdAt
    return l.scrittoIl
}

/**
 * Da quando il bot deve contare le risposte. Chi scrive per primo la frase del
 * link ha già un messaggio in entrata: quello è la richiesta della brochure,
 * non una risposta. Si conta da qualche secondo dopo la frase (la scheda parte
 * ~15 secondi dopo).
 */
export const SECONDI_DOPO_FRASE = 5
export function inizioRisposte(ingresso: Date, scrittoIl: Date | null): Date {
    if (!scrittoIl) return ingresso
    const dopo = new Date(scrittoIl.getTime() + SECONDI_DOPO_FRASE * 1000)
    return dopo > ingresso ? dopo : ingresso
}

// ── Ingresso dei conti ───────────────────────────────────────────────────

export interface LeadBrochure {
    id: string
    /** ISO: ingresso fra i lead brochure (ingressoBrochure). */
    ingresso: string
    /** Come si è riconosciuto: campagna AC, frase al bot o entrambi. */
    daCampagna: boolean
    haScrittoFrase: boolean
    /** Corso dalla frase o dalla nota d'ingresso; null se non c'è. */
    professione: string | null
    assignedToId: string | null
    appuntamento: boolean
    confermato: boolean
    presente: boolean
    chiuso: boolean
    euro: number
}

/** Stato della chat dal bot (`/api/bot/statistiche-bf`). */
export interface ChatBrochure {
    leadId: string
    conChat: boolean
    consegnato: boolean
    risposto: boolean
    /** ISO dell'invio della scheda; undefined = il bot non manda ancora il dato. */
    schedaInviataAt?: string | null
    /** Slug del corso scritto dal bot; undefined = non mandato. */
    professione?: string | null
}

export interface Assegnatario { id: string; nome: string; bot: boolean; ruolo: string }

export interface InputBrochure {
    adesso: Date
    inizio: Date
    leads: LeadBrochure[]
    /** null = il bot non ha risposto. */
    chat: ChatBrochure[] | null
    assegnatari: Assegnatario[]
}

// ── Uscita ───────────────────────────────────────────────────────────────

export interface Stadi {
    lead: number
    conChat: number | null
    consegnati: number | null
    /** null = il bot non manda ancora l'invio della scheda. */
    brochure: number | null
    risposto: number | null
    appuntamenti: number
    confermati: number
    presenti: number
    chiusi: number
    euro: number
}

export interface Perc {
    conChat: number | null
    consegnati: number | null
    brochure: number | null
    risposto: number | null
    appuntamenti: number | null
    confermati: number | null
    presenti: number | null
    chiusi: number | null
}

export interface RigaStadi { chiave: string; etichetta: string; stadi: Stadi; perc: Perc }

export interface RigaMano { chiave: string; etichetta: string; tipo: 'bot' | 'gdo' | 'altro' | 'nessuno'; lead: number; perc: number | null }

export interface Brochure {
    calcolatoAlle: string
    inizio: string
    totale: RigaStadi
    perGiorno: RigaStadi[]
    perSettimana: RigaStadi[]
    perProfessione: RigaStadi[]
    inMano: RigaMano[]
    /** Come sono stati riconosciuti. */
    riconosciuti: { soloCampagna: number; soloFrase: number; entrambi: number }
    botDisponibile: boolean
    schedaDisponibile: boolean
}

export function pct(n: number | null, d: number): number | null {
    if (n === null) return null
    return d ? Math.round((1000 * n) / d) / 10 : null
}

function stadi(righe: LeadBrochure[], chat: Map<string, ChatBrochure> | null, schedaDisponibile: boolean): Stadi {
    const s: Stadi = {
        lead: righe.length,
        conChat: chat ? 0 : null,
        consegnati: chat ? 0 : null,
        brochure: chat && schedaDisponibile ? 0 : null,
        risposto: chat ? 0 : null,
        appuntamenti: 0, confermati: 0, presenti: 0, chiusi: 0, euro: 0,
    }
    for (const l of righe) {
        if (l.appuntamento) s.appuntamenti++
        if (l.confermato) s.confermati++
        if (l.presente) s.presenti++
        if (l.chiuso) { s.chiusi++; s.euro += l.euro }
        const c = chat?.get(l.id)
        if (!c) continue
        if (c.conChat) s.conChat!++
        if (c.consegnato) s.consegnati!++
        if (c.risposto) s.risposto!++
        if (s.brochure !== null && c.schedaInviataAt) s.brochure++
    }
    return s
}

function perc(s: Stadi): Perc {
    const d = s.lead
    return {
        conChat: pct(s.conChat, d), consegnati: pct(s.consegnati, d), brochure: pct(s.brochure, d),
        risposto: pct(s.risposto, d), appuntamenti: pct(s.appuntamenti, d), confermati: pct(s.confermati, d),
        presenti: pct(s.presenti, d), chiusi: pct(s.chiusi, d),
    }
}

function riga(chiave: string, etichetta: string, righe: LeadBrochure[], chat: Map<string, ChatBrochure> | null, scheda: boolean): RigaStadi {
    const s = stadi(righe, chat, scheda)
    return { chiave, etichetta, stadi: s, perc: perc(s) }
}

const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const etichettaGiorno = (g: string) => {
    const d = new Date(`${g}T12:00:00Z`)
    return `${GIORNI[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`
}

/** Il lunedì (YYYY-MM-DD) della settimana del giorno di Roma `g`. */
export function lunediDi(g: string): string {
    const d = new Date(`${g}T12:00:00Z`)
    const indietro = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - indietro)
    return d.toISOString().slice(0, 10)
}

function etichettaSettimana(lunedi: string): string {
    const a = new Date(`${lunedi}T12:00:00Z`)
    const b = new Date(a)
    b.setUTCDate(b.getUTCDate() + 6)
    return `${a.getUTCDate()}/${a.getUTCMonth() + 1} – ${b.getUTCDate()}/${b.getUTCMonth() + 1}`
}

/** Giorni di Roma da `inizio` a `adesso` compresi. */
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

export function calcolaBrochure(i: InputBrochure): Brochure {
    const chat = i.chat ? new Map(i.chat.map(c => [c.leadId, c])) : null
    // Il dato della scheda c'è solo se il bot lo manda (campo presente nella risposta).
    const schedaDisponibile = !!i.chat && i.chat.some(c => c.schedaInviataAt !== undefined)

    // Professione: quella del bot vince sulla frase (è il corso di cui ha mandato la scheda).
    const leads = i.leads.map(l => {
        const dalBot = nomeProfessione(chat?.get(l.id)?.professione)
        return { ...l, professione: dalBot ?? l.professione }
    })

    const giornoDi = new Map(leads.map(l => [l.id, toRomeDateStr(new Date(l.ingresso))]))
    const primoGiorno = leads.reduce<string | null>((m, l) => {
        const g = giornoDi.get(l.id)!
        return m === null || g < m ? g : m
    }, null)
    const giorni = primoGiorno ? giorniDal(new Date(`${primoGiorno}T12:00:00Z`), i.adesso) : []

    const perGiorno = giorni.slice().reverse().map(g =>
        riga(g, etichettaGiorno(g), leads.filter(l => giornoDi.get(l.id) === g), chat, schedaDisponibile))

    const settimane = [...new Set(giorni.map(lunediDi))].reverse()
    const perSettimana = settimane.map(s =>
        riga(s, etichettaSettimana(s), leads.filter(l => lunediDi(giornoDi.get(l.id)!) === s), chat, schedaDisponibile))

    const professioni = new Map<string, LeadBrochure[]>()
    for (const l of leads) {
        const k = l.professione ?? PROFESSIONE_NON_INDICATA
        professioni.set(k, [...(professioni.get(k) ?? []), l])
    }
    const perProfessione = [...professioni.entries()]
        .sort(([a, ra], [b, rb]) =>
            (a === PROFESSIONE_NON_INDICATA ? 1 : 0) - (b === PROFESSIONE_NON_INDICATA ? 1 : 0)
            || rb.length - ra.length || a.localeCompare(b))
        .map(([k, r]) => riga(k, k, r, chat, schedaDisponibile))

    // Chi li ha in mano adesso: il bot, un GDO, qualcun altro, nessuno.
    const chi = new Map(i.assegnatari.map(a => [a.id, a]))
    const mano = new Map<string, RigaMano>()
    for (const l of leads) {
        const a = l.assignedToId ? chi.get(l.assignedToId) : undefined
        const tipo: RigaMano['tipo'] = !l.assignedToId ? 'nessuno' : a?.bot ? 'bot' : a?.ruolo === 'GDO' ? 'gdo' : 'altro'
        const chiave = tipo === 'nessuno' ? 'nessuno' : tipo === 'bot' ? 'bot' : l.assignedToId!
        const etichetta = tipo === 'nessuno' ? 'Nessuno (da assegnare)' : tipo === 'bot' ? 'Bot (Mario)' : a?.nome ?? 'Utente sconosciuto'
        const r = mano.get(chiave) ?? { chiave, etichetta, tipo, lead: 0, perc: null }
        r.lead++
        mano.set(chiave, r)
    }
    const ordineTipo = { bot: 0, gdo: 1, altro: 2, nessuno: 3 }
    const inMano = [...mano.values()]
        .map(r => ({ ...r, perc: pct(r.lead, leads.length) }))
        .sort((a, b) => ordineTipo[a.tipo] - ordineTipo[b.tipo] || b.lead - a.lead || a.etichetta.localeCompare(b.etichetta))

    return {
        calcolatoAlle: i.adesso.toISOString(),
        inizio: i.inizio.toISOString(),
        totale: riga('totale', 'Totale', leads, chat, schedaDisponibile),
        perGiorno,
        perSettimana,
        perProfessione,
        inMano,
        riconosciuti: {
            soloCampagna: leads.filter(l => l.daCampagna && !l.haScrittoFrase).length,
            soloFrase: leads.filter(l => !l.daCampagna && l.haScrittoFrase).length,
            entrambi: leads.filter(l => l.daCampagna && l.haScrittoFrase).length,
        },
        botDisponibile: !!i.chat,
        schedaDisponibile,
    }
}
