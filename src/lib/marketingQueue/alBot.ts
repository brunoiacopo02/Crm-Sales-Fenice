// Coda marketing al bot (PO 29/10/2026).
//
// I lead che il CRM marketing spinge ogni mattina (POST /api/webhooks/marketing-leads)
// nascono nel pool MKT_CODA senza assegnatario: fino al 29/10 non li vedeva
// nessuno (154 lead dal 14/10, mai toccati). Decisione di Bruno: vanno al bot
// come i lead di ActiveCampaign, stesso giro, stesso timer 96h, stessa
// restituzione ai GDO. Anche i vecchi.
//
// Sono contatti VECCHI (ingresso 2024-2025): per il numero WhatsApp sono
// aperture a freddo, le stesse che il 15/09 lo hanno portato a LOW. Per questo
// passano a scaglioni, mai tutti insieme.
//
// Ritmo (PO 29/10/2026, sessione qualita' numeri): 20 al giorno PER NUMERO sui 3
// numeri delle aperture a freddo, 10 la mattina e 10 il pomeriggio. Il CRM ne
// manda 30 nella finestra della mattina e 30 in quella del pomeriggio, col campo
// `codaMarketing: true`; il bot li divide alla pari sui numeri del giro (mai il
// 3199). Anche i vecchi, i piu' recenti per primi.
//
// Modulo puro: niente DB, niente rete. Testato in alBot.test.ts.

/** Lead per giro (il cron gira una volta all'ora, alle :40). */
export const SCAGLIONE_DEFAULT = 10

/** Lead per finestra (mattina o pomeriggio), al massimo, sommando i giri: 10 per numero. */
export const TETTO_FINESTRA_DEFAULT = 30

/**
 * Le due finestre, in ore di Roma [inizio, fine). Il cron gira alle :40: la mattina
 * fa 09:40, 10:40, 11:40, 12:40; il pomeriggio 15:40, 16:40, 17:40, 18:40. Con
 * scaglione 10 e tetto 30 la finestra si riempie ai primi tre giri.
 */
export const FINESTRE = [
    { nome: 'mattina', inizio: 9, fine: 13 },
    { nome: 'pomeriggio', inizio: 15, fine: 19 },
] as const

export type Finestra = (typeof FINESTRE)[number]

/** L'ora di Roma (0-23). */
export function oraRoma(d: Date): number {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(d))
}

/** La finestra in cui cade quell'istante, o null fuori finestra. */
export function finestraCodaAlBot(d: Date): Finestra | null {
    const h = oraRoma(d)
    return FINESTRE.find((f) => h >= f.inizio && h < f.fine) ?? null
}

const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0'])

export interface ConfigCodaAlBot {
    attivo: boolean
    scaglione: number
    tettoFinestra: number
}

function interoDaEnv(env: Record<string, string | undefined>, nome: string, ripiego: number): number {
    const raw = env[nome]?.trim()
    if (!raw) return ripiego
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0 || n > 500) {
        console.error(`[coda-marketing-bot] ${nome}="${raw}" non e' un intero fra 1 e 500: uso ${ripiego}`)
        return ripiego
    }
    return n
}

/**
 * Acceso di default (decisione del PO): `MKT_CODA_BOT=off` lo spegne (env su
 * Vercel + redeploy). Scaglione e tetto per finestra da `MKT_CODA_BOT_BATCH` e
 * `MKT_CODA_BOT_FINESTRA`.
 */
export function leggiConfigCodaAlBot(env: Record<string, string | undefined> = process.env): ConfigCodaAlBot {
    const raw = env.MKT_CODA_BOT?.trim().toLowerCase()
    return {
        attivo: !(raw && OFF_VALUES.has(raw)),
        scaglione: interoDaEnv(env, 'MKT_CODA_BOT_BATCH', SCAGLIONE_DEFAULT),
        tettoFinestra: interoDaEnv(env, 'MKT_CODA_BOT_FINESTRA', TETTO_FINESTRA_DEFAULT),
    }
}

export interface CandidatoCoda {
    id: string
    /** Il bot ha già scritto a questo NUMERO (anche sotto un'altra scheda)? */
    toccatoDalBot: boolean
    status: string
    callCount: number
    assignedToId: string | null
    appointmentDate: Date | null
    phoneSuspicious: boolean
}

/**
 * Un lead della coda si può dare al bot? Mai chiamato, di nessuno, senza
 * appuntamento, con un telefono buono e mai scritto dal bot: una seconda
 * apertura alla stessa persona è proprio quello che abbassa la qualità del numero.
 */
export function spostabileAlBot(l: CandidatoCoda): boolean {
    return l.assignedToId === null
        && l.status === 'NEW'
        && l.callCount === 0
        && l.appointmentDate === null
        && !l.phoneSuspicious
        && !l.toccatoDalBot
}

export interface PianoCoda {
    daSpostare: string[]
    residui: number
    motivo: 'ok' | 'spento' | 'nessun_candidato' | 'tetto_raggiunto'
}

/**
 * I primi `scaglione` spostabili, senza superare il tetto della finestra. L'ordine
 * lo decide la query (i più recenti per primi), qui il taglio è stabile.
 */
export function pianificaCodaAlBot(args: {
    candidati: CandidatoCoda[]
    config: ConfigCodaAlBot
    giaNellaFinestra: number
}): PianoCoda {
    const { candidati, config, giaNellaFinestra } = args
    if (!config.attivo) return { daSpostare: [], residui: 0, motivo: 'spento' }
    const buoni = candidati.filter(spostabileAlBot)
    if (buoni.length === 0) return { daSpostare: [], residui: 0, motivo: 'nessun_candidato' }
    const resta = Math.min(config.scaglione, Math.max(0, config.tettoFinestra - giaNellaFinestra))
    if (resta === 0) return { daSpostare: [], residui: buoni.length, motivo: 'tetto_raggiunto' }
    const daSpostare = buoni.slice(0, resta).map((l) => l.id)
    return { daSpostare, residui: buoni.length - daSpostare.length, motivo: 'ok' }
}

/**
 * Il funnel come lo scrive ActiveCampaign, così il bot sceglie l'apertura
 * giusta (`normalizeFunnel` del bot riconosce solo CORSO 10 ORE, TELEGRAM e
 * JOB SIMULATOR). Il marketing scrive gli stessi funnel in minuscolo e senza
 * spazi. Si traduce solo nel push: il lead nel CRM resta com'è arrivato.
 */
export function funnelPerIlBot(funnel: string | null): string | null {
    const v = (funnel ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
    if (v === 'corso10ore') return 'CORSO 10 ORE'
    if (v === 'jobsimulator') return 'JOB SIMULATOR'
    if (v === 'telegram') return 'TELEGRAM'
    return funnel
}
