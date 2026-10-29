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
// passano a scaglioni con un tetto al giorno, mai tutti insieme.
//
// Modulo puro: niente DB, niente rete. Testato in alBot.test.ts.

/** Lead per giro (il cron gira una volta all'ora). */
export const SCAGLIONE_DEFAULT = 5

/** Lead al giorno, al massimo, sommando i giri. */
export const TETTO_GIORNALIERO_DEFAULT = 30

const OFF_VALUES = new Set(['off', 'none', 'disabled', 'false', '0'])

export interface ConfigCodaAlBot {
    attivo: boolean
    scaglione: number
    tettoGiornaliero: number
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
 * Acceso di default (decisione del PO): `MKT_CODA_BOT=off` lo spegne senza
 * deploy. Scaglione e tetto da `MKT_CODA_BOT_BATCH` e `MKT_CODA_BOT_DAILY`.
 */
export function leggiConfigCodaAlBot(env: Record<string, string | undefined> = process.env): ConfigCodaAlBot {
    const raw = env.MKT_CODA_BOT?.trim().toLowerCase()
    return {
        attivo: !(raw && OFF_VALUES.has(raw)),
        scaglione: interoDaEnv(env, 'MKT_CODA_BOT_BATCH', SCAGLIONE_DEFAULT),
        tettoGiornaliero: interoDaEnv(env, 'MKT_CODA_BOT_DAILY', TETTO_GIORNALIERO_DEFAULT),
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
 * I primi `scaglione` spostabili, senza superare il tetto del giorno. L'ordine
 * lo decide la query (i più recenti per primi), qui il taglio è stabile.
 */
export function pianificaCodaAlBot(args: {
    candidati: CandidatoCoda[]
    config: ConfigCodaAlBot
    giaOggi: number
}): PianoCoda {
    const { candidati, config, giaOggi } = args
    if (!config.attivo) return { daSpostare: [], residui: 0, motivo: 'spento' }
    const buoni = candidati.filter(spostabileAlBot)
    if (buoni.length === 0) return { daSpostare: [], residui: 0, motivo: 'nessun_candidato' }
    const resta = Math.min(config.scaglione, Math.max(0, config.tettoGiornaliero - giaOggi))
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
