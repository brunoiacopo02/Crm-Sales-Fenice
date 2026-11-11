// Lead di DATABASE della coda marketing al bot (PO 10/11/2026, contratto v1.17).
//
// Il marketing mette nella sua coda (POST /api/webhooks/marketing-leads) una
// trentina di contatti VECCHI al giorno, segnati con `"database": true` nel
// singolo lead. Il bot li apre con le sue aperture apposta (5 varianti), li
// divide su tutti i numeri e li lavora DA SOLO: nessuno torna ai GDO.
//
// Qui solo le regole (modulo puro, testato in database.test.ts); la scrittura
// sta in databaseAlBot.ts, chiamata dal cron marketing-coda-bot.
//
// Due interruttori, entrambi SPENTI di default:
// - qui `MKT_DATABASE_BOT=on` (env su Vercel): il CRM spinge i lead al bot;
// - nel bot `app_settings.database_bot`: il bot li apre.
// Con questo spento i lead segnati restano fermi nella coda: non prendono MAI la
// strada ordinaria (apertura di Mario, ritorno ai GDO), che e' proprio cio' che
// non si vuole per loro.

/** L'infornata a senso unico dei lead di database dati al bot (vedi intakeBatch.ts). */
export const BATCH_DATABASE_BOT = 'DATABASE_BOT_202611'

/** Evento sul lead: una riga per ogni esito definitivo del giro database. */
export const EVENTO_DATABASE_BOT = 'DATABASE_BOT'

/** Il segno del marketing sul lead della coda: solo `true` (booleano) vale. */
export function eLeadDatabase(raw: unknown): boolean {
    return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).database === true
}

export const SCAGLIONE_DATABASE_DEFAULT = 10
export const GIORNI_CODA_DATABASE_DEFAULT = 7

export interface ConfigDatabaseAlBot {
    attivo: boolean
    /** Lead spinti per giro del cron (il tetto vero al giorno lo tiene il bot). */
    scaglione: number
    /** Da quanti giorni di coda si pescano i lead non ancora aperti. */
    giorniCoda: number
}

const ON_VALUES = new Set(['on', '1', 'true', 'acceso'])

function intero(env: Record<string, string | undefined>, nome: string, ripiego: number, max: number): number {
    const raw = env[nome]?.trim()
    if (!raw) return ripiego
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 && n <= max ? n : ripiego
}

/** SPENTO salvo `MKT_DATABASE_BOT=on` esplicito. */
export function leggiConfigDatabaseAlBot(env: Record<string, string | undefined> = process.env): ConfigDatabaseAlBot {
    return {
        attivo: ON_VALUES.has(env.MKT_DATABASE_BOT?.trim().toLowerCase() ?? ''),
        scaglione: intero(env, 'MKT_DATABASE_BOT_BATCH', SCAGLIONE_DATABASE_DEFAULT, 50),
        giorniCoda: intero(env, 'MKT_DATABASE_BOT_GIORNI', GIORNI_CODA_DATABASE_DEFAULT, 60),
    }
}

export interface CandidatoDatabase {
    id: string
    status: string
    assignedToId: string | null
    appointmentDate: Date | null
    presentedAt: Date | null
    phoneSuspicious: boolean
    isTest: boolean
    intakeBatch: string | null
    /** Il bot ha gia' avuto questo NUMERO (push andato a segno, nota, esito, restituzione). */
    toccatoDalBot: boolean
    /** Questo numero ha gia' un esito del giro database (aperto o rifiuto definitivo), su qualunque scheda. */
    giaGestito: boolean
    /** Un'altra scheda con lo stesso numero (ultime 10 cifre) e' di una persona o ha un appuntamento. */
    doppioneOccupato: boolean
    /** Spinte database finite con un errore di questo lead (arruolamento fallito, errore HTTP). */
    tentativiFalliti: number
}

/** Dopo tanti errori dello stesso lead si smette di riprovarlo: non blocca la coda. */
export const MAX_TENTATIVI_FALLITI = 3

export type MotivoNonIdoneo =
    | 'test' | 'telefono_sospetto' | 'di_qualcuno' | 'appuntamento' | 'stato' | 'batch_diverso' | 'toccato_dal_bot' | 'gia_gestito'
    | 'doppione_occupato' | 'troppi_errori'

/**
 * Un lead di database della coda si puo' dare al bot? Prima versione prudente
 * (un cambiamento alla volta): solo lead liberi (NEW e di nessuno), mai un lead
 * che lavora un GDO, mai uno con appuntamento o presenza, mai un numero che il
 * bot ha gia' avuto (una seconda apertura alla stessa persona e' cio' che abbassa
 * la qualita' del numero; il bot lo rifiuta comunque). Un lead che sta gia' in
 * un'altra infornata resta fuori, salvo quella a senso unico della lista 133.
 */
export function motivoNonIdoneo(l: CandidatoDatabase): MotivoNonIdoneo | null {
    if (l.isTest) return 'test'
    if (l.giaGestito) return 'gia_gestito'
    if (l.phoneSuspicious) return 'telefono_sospetto'
    if (l.assignedToId !== null) return 'di_qualcuno'
    if (l.appointmentDate !== null || l.presentedAt !== null) return 'appuntamento'
    if (l.status !== 'NEW') return 'stato'
    if (l.intakeBatch !== null && l.intakeBatch !== BATCH_DATABASE_BOT && l.intakeBatch !== 'DB_LISTA133_20260915') return 'batch_diverso'
    if (l.toccatoDalBot) return 'toccato_dal_bot'
    if (l.doppioneOccupato) return 'doppione_occupato'
    if (l.tentativiFalliti >= MAX_TENTATIVI_FALLITI) return 'troppi_errori'
    return null
}

/**
 * Cosa fa il CRM con la risposta del bot a un push database.
 * - `assegna`: il bot l'ha preso → il lead passa all'account bot a senso unico, e
 *   non si ripropone;
 * - `definitivo`: il bot non lo aprira' mai (chat esistente, numero non valido) →
 *   resta dov'e', segnato, e non si ripropone;
 * - `riprova`: non adesso (interruttore, tetti, fascia, timeout) → resta in coda e
 *   il giro si ferma; un errore del solo lead (arruolamento fallito, HTTP) lo salta.
 */
export type AzioneDatabase =
    | { tipo: 'assegna'; esito: string }
    | { tipo: 'definitivo'; esito: string }
    /** `globale` = vale per tutti i lead (si ferma il giro); altrimenti si salta solo questo. */
    | { tipo: 'riprova'; esito: string; globale: boolean }

export function azioneDaPush(r: { result: string; motivo?: string }): AzioneDatabase {
    switch (r.result) {
        case 'sent': return { tipo: 'assegna', esito: 'aperto' }
        case 'duplicate': return { tipo: 'assegna', esito: 'aperto_duplicato' }
        // Un timeout non dice se l'apertura sia partita. Per questi lead si RIPROVA:
        // il bot scrive il segno sulla chat PRIMA dell'invio, quindi al secondo push
        // risponde "duplicato" senza mandare niente (e il lead passa al bot), oppure
        // apre se la prima volta non era partito nulla. Mai lasciarlo appeso al bot
        // senza chat. Il giro si ferma: il bot e' lento per tutti.
        case 'network_error': return { tipo: 'riprova', esito: 'timeout', globale: true }
        case 'not_accepted':
            if (r.motivo === 'database_chat_esistente') return { tipo: 'definitivo', esito: 'chat_esistente' }
            if (r.motivo === 'telefono_non_valido') return { tipo: 'definitivo', esito: 'telefono_non_valido' }
            // La chat e' nata e l'invio e' fallito: e' del bot, che la chiude da se'.
            if (r.motivo === 'apertura_non_partita') return { tipo: 'assegna', esito: 'apertura_non_partita' }
            if (r.motivo === 'arruolamento_fallito') return { tipo: 'riprova', esito: r.motivo, globale: false }
            return { tipo: 'riprova', esito: r.motivo ?? 'rifiutato', globale: true }
        case 'http_error': return { tipo: 'riprova', esito: r.result, globale: false }
        default: return { tipo: 'riprova', esito: r.result, globale: true }
    }
}
