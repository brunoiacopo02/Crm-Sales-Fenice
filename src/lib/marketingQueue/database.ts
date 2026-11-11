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
    /**
     * Ingresso ALLARGATO (proposta PO 11/11/2026, `MKT_DATABASE_ALLARGATO=on`): oltre ai
     * lead liberi mai scritti dal bot entrano i lead FERMI (nessun contatto da
     * `giorniFermo` giorni) e i lead dei GDO mai chiamati. Spento = regola di prima.
     */
    allargato: boolean
    /** `MKT_DATABASE_GIORNI_FERMO` (default 14): giorni senza nessun contatto per dire "fermo". */
    giorniFermo: number
}

export const GIORNI_FERMO_DEFAULT = 14

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
        allargato: ON_VALUES.has(env.MKT_DATABASE_ALLARGATO?.trim().toLowerCase() ?? ''),
        giorniFermo: intero(env, 'MKT_DATABASE_GIORNI_FERMO', GIORNI_FERMO_DEFAULT, 365),
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

/**
 * Cio' che serve all'ingresso allargato, letto su TUTTE le schede della persona (stesse
 * ultime 10 cifre del telefono): la persona e' ferma solo se e' ferma ovunque.
 */
export interface PersonaDatabase {
    /** Ultimo contatto di qualunque tipo: chiamata, messaggio del/al bot, esito, restituzione (ms). */
    ultimoContattoMs: number | null
    /** Chiamate registrate su QUESTA scheda (callLogs). */
    chiamateScheda: number
    callCount: number
    recallDate: Date | null
    /** Una scheda della persona ha un appuntamento futuro o degli ultimi 14 giorni. */
    appuntamentoVicino: boolean
    /** Cliente: esito venditore "Chiuso", nel gestionale contratti, o scartato come "gia' cliente". */
    cliente: boolean
    /** Una scheda della persona ha un richiamo fissato nel futuro. */
    richiamoFissato: boolean
    /** Scarto che chiude per sempre su una scheda della persona: non interessato, non in target, numero sbagliato. */
    scartoChiuso: boolean
    /** L'assegnatario e' una persona (non l'account bot). */
    assegnatoAPersona: boolean
    /** Funnel Black Friday con la scheda ancora aperta. */
    blackFridayAperto: boolean
    /** Lead del lancio non archiviato con la scheda ancora aperta. */
    lancioInLavorazione: boolean
}

/**
 * Gli eventi che contano come "contatto" o "cambio di esito" per dire se la persona e'
 * ferma (oltre alle chiamate in `callLogs`). Non contano le mosse amministrative
 * (ASSIGNED, REASSIGNED_ADMIN, IMPORTED, TOLTO_AL_BOT, coda marketing...).
 */
export const EVENTI_CONTATTO = [
    'REASSIGNED_FROM_BOT', 'BOT_NOTE', 'BOT_REPORT', 'BOT_CALL_ATTEMPT', 'AGENDA_SENT', 'AGENDA_DELIVERED',
    'INBOUND_MESSAGE', 'BOT_CONTACT_REQUEST', 'BOT_APPOINTMENT_RESCHEDULED', 'BOT_DISDETTA_SCARTO', 'BOT_DISDETTA_NON_SCARTATA',
    'BOT_ESITO_IGNORATO', 'BOT_VERIFICA_INVIATA', 'BOT_VERIFICA_RISPOSTA', 'LANCIO_INTAKE',
    'conferme_no_answer', 'conferme_outcome_set', 'conferme_auto_discarded_3nr', 'conferme_call_logged', 'conferme_recall_scheduled',
    'salesperson_outcome_set', 'negotiation_started', 'appointment_forced', 'LEAD_RIAPERTO',
] as const

/** Mai, in nessun modo (PO): Enrico Marchioretto. */
export const LEAD_MAI_TOCCARE = ['306abd1c']

export type MotivoNonIdoneoAllargato = MotivoNonIdoneo
    | 'mai_toccare' | 'cliente' | 'appuntamento_vicino' | 'richiamo' | 'scarto_chiuso' | 'black_friday' | 'lancio'
    | 'presenza_storica' | 'appuntamento_storico_gdo' | 'gdo_al_lavoro' | 'non_fermo'

export type RegolaIngresso = 'libero_nuovo' | 'gdo_mai_chiamato' | 'fermo'

/** Gli scarti che chiudono per sempre (PO 11/11/2026). Confronto senza maiuscole, per parola. */
export function scartoCheChiude(motivo: string | null | undefined): boolean {
    const m = (motivo ?? '').toLowerCase()
    return /non interessat|non in target|numero (sbagliato|errato|inesistente)|inesistente|gi[aà] cliente|non contattare|opt.?out/.test(m)
}

/**
 * Ingresso allargato (proposta del PO dell'11/11/2026, soglie da confermare).
 *
 * Entra, oltre a chi entrava gia' (libero, NEW, mai scritto dal bot):
 *  - `gdo_mai_chiamato`: scheda aperta di un GDO con 0 chiamate e nessun richiamo, SUBITO;
 *    la scheda passa all'account bot (infornata a senso unico) e il GDO la perde;
 *  - `fermo`: la persona non ha avuto NESSUN contatto da `giorniFermo` giorni (chiamata,
 *    messaggio, esito), qualunque sia lo stato: scartato, esitato, libero, gia' scritto
 *    dal bot. La chat col bot la giudica poi il bot (ferma da `giorni_fermo`).
 * Resta sempre fuori: cliente, appuntamento futuro o recente, richiamo fissato, scarto
 * che chiude (non interessato, non in target, numero sbagliato), Black Friday e lancio
 * aperti, un GDO che lo sta lavorando (chiamate e non fermo), presenza gia' registrata
 * su questa scheda (spostarla cancellerebbe numeri gia' pagati ai GDO: vedi outcome route).
 */
export function ingressoAllargato(
    l: CandidatoDatabase, p: PersonaDatabase, i: { nowMs: number; giorniFermo: number },
): { regola: RegolaIngresso } | { motivo: MotivoNonIdoneoAllargato } {
    if (LEAD_MAI_TOCCARE.some((x) => l.id.startsWith(x))) return { motivo: 'mai_toccare' }
    if (l.isTest) return { motivo: 'test' }
    if (l.giaGestito) return { motivo: 'gia_gestito' }
    if (l.phoneSuspicious) return { motivo: 'telefono_sospetto' }
    if (p.cliente) return { motivo: 'cliente' }
    if (p.appuntamentoVicino) return { motivo: 'appuntamento_vicino' }
    // Richiamo fissato su una scheda APERTA della persona (un richiamo vecchio su uno scarto o
    // su un appuntamento chiuso non conta).
    if (p.richiamoFissato) return { motivo: 'richiamo' }
    if (p.scartoChiuso) return { motivo: 'scarto_chiuso' }
    if (p.blackFridayAperto) return { motivo: 'black_friday' }
    if (p.lancioInLavorazione) return { motivo: 'lancio' }
    if (l.presentedAt !== null) return { motivo: 'presenza_storica' }
    // Appuntamento (anche vecchio) su una scheda di un GDO: spostarla all'account bot gli
    // toglierebbe l'appuntamento dai conteggi calcolati sull'assegnatario. Fuori finche'
    // Bruno non decide (proposta: si', ma solo spostando la chat e non la scheda).
    if (l.appointmentDate !== null && p.assegnatoAPersona) return { motivo: 'appuntamento_storico_gdo' }
    // Le altre schede della stessa persona le giudicano i controlli "di persona" qui sopra
    // (ultimo contatto, appuntamenti, richiami, clienti): `doppioneOccupato` non serve.
    if (l.tentativiFalliti >= MAX_TENTATIVI_FALLITI) return { motivo: 'troppi_errori' }
    if (l.intakeBatch !== null && l.intakeBatch !== BATCH_DATABASE_BOT && l.intakeBatch !== 'DB_LISTA133_20260915') return { motivo: 'batch_diverso' }

    const aperto = l.status === 'NEW' || l.status === 'IN_PROGRESS'
    // Di un GDO, aperto, mai chiamato: al bot subito.
    if (p.assegnatoAPersona && aperto && p.chiamateScheda === 0 && p.callCount === 0) return { regola: 'gdo_mai_chiamato' }
    // Libero, NEW, mai scritto dal bot: la regola di prima.
    if (!l.assignedToId && l.status === 'NEW' && !l.toccatoDalBot && l.appointmentDate === null) return { regola: 'libero_nuovo' }
    // Tutto il resto entra solo se la persona e' ferma.
    const soglia = i.nowMs - i.giorniFermo * 24 * 3600_000
    const fermo = p.ultimoContattoMs === null || p.ultimoContattoMs <= soglia
    if (!fermo) return { motivo: p.assegnatoAPersona && aperto ? 'gdo_al_lavoro' : 'non_fermo' }
    return { regola: 'fermo' }
}

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
            // Chat ancora viva o quota delle riaperture piena: riprova questo lead piu' avanti.
            if (r.motivo === 'database_chat_attiva') return { tipo: 'riprova', esito: 'chat_attiva', globale: false }
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
