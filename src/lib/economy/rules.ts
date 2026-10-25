// Regole della nuova economia: Scintille (ritmo) e Piume (risultati verificati
// da altri), PO 25/10/2026.
//
// I valori vivono in appSettings, chiave ECONOMY_RULES_KEY (JSON), e l'admin li
// può cambiare senza deploy. Qui ci sono i default decisi da Bruno e tutti i
// calcoli puri: chiavi idempotenti del registro, regola dei 30 giorni per lead,
// scalini personali, Piume dovute a un lead, contenuto e destinatari dei
// forzieri di squadra. Le soglie (8/10, 55/65, 14/20, presenze) non stanno
// qui: sono gli obiettivi della Diretta (src/lib/diretta/config.ts).

import { dayBoundsRome } from '@/lib/dateUtils'
import { stepReached, isTeamMember, type GamificationTargets } from '@/lib/diretta/config'

export const ECONOMY_RULES_KEY = 'economy_rules'

export type TipoPiuma = 'conferma' | 'presenza' | 'chiusura'
export type ChestTier = 'raro' | 'leggendario'
export type ChestKind = 'giorno_1' | 'giorno_2' | 'punta_1' | 'punta_2'

export interface ChestOdds {
    probPiuma: number              // probabilità (0..1) che il forziere contenga Piume
    piume: number                  // quante Piume, se escono
    scintille: [number, number]    // altrimenti Scintille fra min e max, estremi inclusi
}

export interface EconomyRules {
    /** Giorno di Roma 'YYYY-MM-DD' da cui contano gli esiti per le Piume. */
    inizio: string
    fissato: {
        scintille: number          // per ogni lead fissato
        finestraGiorni: number     // un lead paga una volta ogni N giorni
        tettoGiorno: number        // fissati pagati al giorno a persona
    }
    /** Scintille al primo e al secondo scalino personale del giorno. */
    scaliniPersonali: [number, number]
    piume: {
        conferma: number
        presenza: number
        presenzaOltreSoglia: number    // dalla presenza successiva a presenzeSogliaEuro
        chiusura: number
    }
    forzieri: {
        raro: ChestOdds
        leggendario: ChestOdds
        // Chi riceve il forziere: i GDO della squadra con almeno N fissati nel
        // giorno (forzieri del giorno) o nell'ora di punta (forzieri della
        // punta). 0 = tutta la squadra.
        minFissatiGiorno: number
        minFissatiPunta: number
    }
}

export const DEFAULT_ECONOMY_RULES: EconomyRules = {
    inizio: '2026-10-26',
    fissato: { scintille: 10, finestraGiorni: 30, tettoGiorno: 15 },
    scaliniPersonali: [20, 60],
    piume: { conferma: 1, presenza: 2, presenzaOltreSoglia: 4, chiusura: 5 },
    forzieri: {
        raro: { probPiuma: 0.05, piume: 1, scintille: [20, 60] },
        leggendario: { probPiuma: 0.2, piume: 1, scintille: [60, 150] },
        minFissatiGiorno: 1,
        minFissatiPunta: 1,
    },
}

// ── Lettura delle regole ────────────────────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const intero = (v: unknown, d: number, min: number) => (Number.isInteger(v) && (v as number) >= min ? (v as number) : d)
const probabilita = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d)
const coppia = (v: unknown, d: [number, number], min: number): [number, number] =>
    Array.isArray(v) && v.length === 2 && v.every(x => Number.isInteger(x) && x >= min) && v[0] <= v[1]
        ? [v[0], v[1]]
        : d
const giornoIso = (v: unknown, d: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d)

function parseOdds(v: unknown, d: ChestOdds): ChestOdds {
    const o = isObj(v) ? v : {}
    return {
        probPiuma: probabilita(o.probPiuma, d.probPiuma),
        piume: intero(o.piume, d.piume, 1),
        scintille: coppia(o.scintille, d.scintille, 1),
    }
}

/** Unisce il JSON salvato ai default, chiave per chiave: un valore mancante o assurdo resta al default. */
export function parseEconomyRules(raw: string | null | undefined): EconomyRules {
    const d = DEFAULT_ECONOMY_RULES
    if (!raw) return d
    let saved: unknown
    try {
        saved = JSON.parse(raw)
    } catch {
        return d
    }
    if (!isObj(saved)) return d
    const fissato = isObj(saved.fissato) ? saved.fissato : {}
    const piume = isObj(saved.piume) ? saved.piume : {}
    const forzieri = isObj(saved.forzieri) ? saved.forzieri : {}
    return {
        inizio: giornoIso(saved.inizio, d.inizio),
        fissato: {
            scintille: intero(fissato.scintille, d.fissato.scintille, 0),
            finestraGiorni: intero(fissato.finestraGiorni, d.fissato.finestraGiorni, 1),
            tettoGiorno: intero(fissato.tettoGiorno, d.fissato.tettoGiorno, 0),
        },
        scaliniPersonali: coppia(saved.scaliniPersonali, d.scaliniPersonali, 0),
        piume: {
            conferma: intero(piume.conferma, d.piume.conferma, 0),
            presenza: intero(piume.presenza, d.piume.presenza, 0),
            presenzaOltreSoglia: intero(piume.presenzaOltreSoglia, d.piume.presenzaOltreSoglia, 0),
            chiusura: intero(piume.chiusura, d.piume.chiusura, 0),
        },
        forzieri: {
            raro: parseOdds(forzieri.raro, d.forzieri.raro),
            leggendario: parseOdds(forzieri.leggendario, d.forzieri.leggendario),
            minFissatiGiorno: intero(forzieri.minFissatiGiorno, d.forzieri.minFissatiGiorno, 0),
            minFissatiPunta: intero(forzieri.minFissatiPunta, d.forzieri.minFissatiPunta, 0),
        },
    }
}

/** Mezzanotte di Roma del giorno d'avvio: gli esiti precedenti non pagano Piume. */
export function inizioEconomia(r: EconomyRules): Date {
    return dayBoundsRome(new Date(`${r.inizio}T12:00:00Z`)).start
}

// ── Registro: righe e storni ────────────────────────────────────────────

export interface LedgerRow {
    idemKey: string
    amount: number
    createdAt?: Date
}

const STORNO = 'storno:'

/** Accrediti con il prefisso dato e chiavi già stornate (reverseOnce scrive 'storno:<chiave>'). */
function accreditiEStorni(rows: LedgerRow[], prefisso: string) {
    const accrediti = rows.filter(r => r.idemKey.startsWith(prefisso) && r.amount > 0)
    const stornati = new Set(
        rows.filter(r => r.idemKey.startsWith(STORNO + prefisso)).map(r => r.idemKey.slice(STORNO.length)),
    )
    return { accrediti, stornati }
}

// ── Fissato ─────────────────────────────────────────────────────────────

const GIORNO_MS = 86_400_000

/** Indice della finestra fissa di `giorni` giorni che contiene il giorno di Roma 'YYYY-MM-DD'. */
export function finestraIndex(giornoRoma: string, giorni: number): number {
    const [y, m, d] = giornoRoma.split('-').map(Number)
    return Math.floor(Date.UTC(y, m - 1, d) / GIORNO_MS / giorni)
}

/**
 * Chiave del fissato: S:fissato:<leadId>:<finestra di 30 giorni>. La finestra
 * tiene fuori le gare fra due salvataggi simultanei (stessa chiave = un solo
 * accredito); la regola vera dei 30 giorni la applica `pianoFissato`. Una
 * seconda chiave nella stessa finestra serve solo dopo uno storno.
 */
export function fissatoIdemKey(leadId: string, giornoRoma: string, giorni: number, generazione = 1): string {
    const base = `S:fissato:${leadId}:${finestraIndex(giornoRoma, giorni)}`
    return generazione > 1 ? `${base}:${generazione}` : base
}

/**
 * Il lead paga se negli ultimi `giorni` giorni non ha un fissato ancora valido
 * (non stornato), di chiunque sia: rifissare lo stesso lead non rende niente.
 * Un fissato stornato (appuntamento annullato) si può ripagare, con una chiave
 * nuova: il netto resta di un fissato per appuntamento vero.
 */
export function pianoFissato(rows: LedgerRow[], leadId: string, at: Date, giornoRoma: string, giorni: number): { bloccato: boolean; idemKey: string } {
    const { accrediti, stornati } = accreditiEStorni(rows, `S:fissato:${leadId}:`)
    const limite = at.getTime() - giorni * GIORNO_MS
    const bloccato = accrediti.some(c => !stornati.has(c.idemKey) && (c.createdAt?.getTime() ?? at.getTime()) > limite)
    const base = fissatoIdemKey(leadId, giornoRoma, giorni)
    const nellaFinestra = accrediti.filter(c => c.idemKey === base || c.idemKey.startsWith(`${base}:`)).length
    return { bloccato, idemKey: fissatoIdemKey(leadId, giornoRoma, giorni, nellaFinestra + 1) }
}

/**
 * Fissati ancora validi del lead da stornare quando l'appuntamento sparisce.
 * `dal` limita al ciclo corrente (gli accrediti nati da `dal` in poi); null = tutti.
 */
export function fissatiDaStornare(rows: LedgerRow[], leadId: string, dal: Date | null): string[] {
    const { accrediti, stornati } = accreditiEStorni(rows, `S:fissato:${leadId}:`)
    return accrediti
        .filter(c => !stornati.has(c.idemKey))
        .filter(c => !dal || !c.createdAt || c.createdAt.getTime() >= dal.getTime())
        .map(c => c.idemKey)
}

/**
 * Chi può guadagnare le Scintille di un APPUNTAMENTO: un GDO in sessione che
 * esita di persona. Fuori il bot e l'IA vocale (passano dal serviceCtx), chi
 * non è GDO (venditori, manager, admin) e chi passa al server un `userId`
 * diverso dal proprio. Che sia davvero in squadra lo verifica poi il DB.
 */
export function fissatoPremiabile(i: {
    serviceCtx: boolean
    isBot: boolean
    actorRole: string | undefined
    sessionUserId: string | undefined
    effectiveUserId: string | undefined
}): boolean {
    return !i.serviceCtx && !i.isBot && i.actorRole === 'GDO'
        && !!i.sessionUserId && i.effectiveUserId === i.sessionUserId
}

// ── Scalini personali ───────────────────────────────────────────────────

export function scalinoIdemKey(userId: string, giornoRoma: string, scalino: 1 | 2): string {
    return `S:scalino:${userId}:${giornoRoma}:${scalino}`
}

/** Bonus degli scalini raggiunti con `fissati` fissati nel giorno (entrambi, se si è oltre il secondo). */
export function bonusScalini(fissati: number, soglie: [number, number], importi: [number, number]): Array<{ scalino: 1 | 2; scintille: number }> {
    const raggiunto = stepReached(fissati, soglie)
    const out: Array<{ scalino: 1 | 2; scintille: number }> = []
    if (raggiunto >= 1 && importi[0] > 0) out.push({ scalino: 1, scintille: importi[0] })
    if (raggiunto >= 2 && importi[1] > 0) out.push({ scalino: 2, scintille: importi[1] })
    return out
}

/**
 * Premio di un fissato restituito al client. Ha la stessa forma del vecchio
 * rewardData (`RewardEarnedDetail` di src/lib/animationUtils): chi ascolta
 * l'evento window `reward_earned` continua a funzionare, con le Scintille al
 * posto delle monete e zero XP.
 */
export interface FissatoReward {
    xpGained: number
    coinsGained: number
    actionType: 'FISSATO'
    didLevelUp: boolean
    valuta: 'S'
    /** Scintille entrate con questo esito: fissato più eventuali scalini. */
    scintille: number
    /** Lead distinti fissati oggi, questo compreso. */
    fissatiOggi: number
    /** Scalino personale raggiunto oggi (0, 1 o 2). */
    scalino: 0 | 1 | 2
    saldoScintille: number
}

export function rewardFissato(i: { scintille: number; fissatiOggi: number; scalino: 0 | 1 | 2; saldo: number }): FissatoReward {
    return {
        xpGained: 0,
        coinsGained: i.scintille,
        actionType: 'FISSATO',
        didLevelUp: false,
        valuta: 'S',
        scintille: i.scintille,
        fissatiOggi: i.fissatiOggi,
        scalino: i.scalino,
        saldoScintille: i.saldo,
    }
}

/**
 * Un appuntamento tolto dal GDO con un altro esito si storna solo se le
 * Conferme non l'hanno ancora visto: se l'hanno lavorato, l'appuntamento è
 * esistito davvero e le Scintille restano.
 */
export function confermeNonHannoToccato(l: {
    confirmationsOutcome: string | null
    confCall1At: Date | null
    confNeedsReschedule: boolean
    confSnoozeAt: Date | null
}): boolean {
    return !l.confirmationsOutcome && !l.confCall1At && !l.confNeedsReschedule && !l.confSnoozeAt
}

// ── Piume ───────────────────────────────────────────────────────────────

export interface StatoPiumeLead {
    confirmationsOutcome: string | null
    /** Chi ha confermato è una persona dello staff (non il bot del lancio). */
    confermatoDaPersona: boolean
    confirmationsTimestamp: Date | null
    presentedAt: Date | null
    appointmentDate: Date | null
    salespersonOutcome: string | null
}

/**
 * Piume che il lead deve aver dato al suo GDO, dato lo stato attuale. Tutte
 * richiedono una conferma fatta da una persona: le Piume premiano risultati
 * verificati da Conferme e venditori, non dal bot. Gli esiti di prima
 * dell'avvio dell'economia non pagano.
 */
export function piumeDovute(s: StatoPiumeLead, inizio: Date): Record<TipoPiuma, boolean> {
    const confermato = s.confirmationsOutcome === 'confermato' && s.confermatoDaPersona
    const dopoInizio = (d: Date | null) => !!d && d.getTime() >= inizio.getTime()
    return {
        conferma: confermato && dopoInizio(s.confirmationsTimestamp),
        presenza: confermato && dopoInizio(s.presentedAt),
        chiusura: confermato && s.salespersonOutcome === 'Chiuso' && dopoInizio(s.presentedAt ?? s.appointmentDate),
    }
}

export function piumaIdemKey(tipo: TipoPiuma, leadId: string, generazione: number): string {
    return `P:${tipo}:${leadId}:${generazione}`
}

/**
 * Cosa fare sul registro perché il lead abbia esattamente una Piuma di quel
 * tipo se è dovuta, e nessuna se non lo è. Ogni nuovo accredito dopo uno
 * storno ha una chiave nuova (generazione successiva).
 */
export function pianoPiuma(rows: LedgerRow[], tipo: TipoPiuma, leadId: string, dovuta: boolean): { accredita: string | null; storna: string[] } {
    const { accrediti, stornati } = accreditiEStorni(rows, `P:${tipo}:${leadId}:`)
    const attivi = accrediti.filter(c => !stornati.has(c.idemKey)).map(c => c.idemKey)
    if (!dovuta) return { accredita: null, storna: attivi }
    if (attivi.length === 0) return { accredita: piumaIdemKey(tipo, leadId, accrediti.length + 1), storna: [] }
    return { accredita: null, storna: attivi.slice(1) }
}

/** Piume di una presenza: di più dalla presenza che supera la soglia degli euro (dalla 5ª con soglia 4). */
export function piumePresenza(ordinaleSettimana: number, sogliaEuro: number, r: EconomyRules): number {
    return ordinaleSettimana > sogliaEuro ? r.piume.presenzaOltreSoglia : r.piume.presenza
}

export interface PersonaEconomia {
    id: string
    role: string
    isActive: boolean
    isBot?: boolean | null
    firstName: string | null
}

const RUOLI_STAFF = new Set(['CONFERME', 'VENDITORE', 'MANAGER', 'ADMIN', 'TL'])

/** Conferme, venditori e staff in carne e ossa: il ruolo viene dal DB, non dai metadata della sessione. */
export function isPersonaleUmano(u: PersonaEconomia | undefined | null): boolean {
    return !!u && !u.isBot && RUOLI_STAFF.has(u.role)
}

/** Le Piume entrano solo se a scrivere l'esito è lo staff e a riceverle è un GDO della squadra (mai sé stesso). */
export function puoAccreditarePiume(autore: PersonaEconomia | undefined | null, destinatario: PersonaEconomia | undefined | null): boolean {
    return !!autore && !!destinatario && isPersonaleUmano(autore) && isTeamMember(destinatario) && autore.id !== destinatario.id
}

// ── Forzieri di squadra ─────────────────────────────────────────────────

export interface RigaFissato {
    userId: string | null
    leadId: string
    createdAt: Date
}

/** Lead distinti fissati da ciascuno, eventualmente solo dentro una finestra [start, end). */
export function contaFissatiPerPersona(rows: RigaFissato[], finestra?: { start: Date; end: Date }): Map<string, number> {
    const perPersona = new Map<string, Set<string>>()
    for (const r of rows) {
        if (!r.userId) continue
        const t = r.createdAt.getTime()
        if (finestra && (t < finestra.start.getTime() || t >= finestra.end.getTime())) continue
        const s = perPersona.get(r.userId) ?? new Set<string>()
        s.add(r.leadId)
        perPersona.set(r.userId, s)
    }
    return new Map([...perPersona].map(([k, v]) => [k, v.size]))
}

/** Fissati di squadra = somma dei fissati di ciascuno. */
export function sommaFissati(conteggi: Map<string, number>): number {
    let n = 0
    for (const v of conteggi.values()) n += v
    return n
}

/** Forzieri sbloccati dai fissati di squadra del giorno e dell'ora di punta (null = niente ora di punta). */
export function forzieriRaggiunti(squadra: number, punta: number | null, t: Pick<GamificationTargets, 'squadra' | 'punta'>): ChestKind[] {
    const out: ChestKind[] = []
    const g = stepReached(squadra, t.squadra)
    if (g >= 1) out.push('giorno_1')
    if (g >= 2) out.push('giorno_2')
    if (punta !== null) {
        const p = stepReached(punta, t.punta)
        if (p >= 1) out.push('punta_1')
        if (p >= 2) out.push('punta_2')
    }
    return out
}

/** Primo scalino = forziere raro, secondo = leggendario. */
export function tierForziere(kind: ChestKind): ChestTier {
    return kind.endsWith('_2') ? 'leggendario' : 'raro'
}

/** Contenuto deciso alla consegna. `rand` restituisce un numero in [0, 1): lato server viene da crypto. */
export function contenutoForziere(tier: ChestTier, r: EconomyRules, rand: () => number): { currency: 'S' | 'P'; amount: number } {
    const o = r.forzieri[tier]
    if (rand() < o.probPiuma) return { currency: 'P', amount: o.piume }
    const [min, max] = o.scintille
    return { currency: 'S', amount: Math.min(max, min + Math.floor(rand() * (max - min + 1))) }
}

/** Chi riceve il forziere: i membri della squadra con almeno `minimo` fissati nel periodo (0 = tutti). */
export function destinatariForziere(conteggi: Map<string, number>, squadra: string[], minimo: number): string[] {
    return squadra.filter(id => (conteggi.get(id) ?? 0) >= minimo)
}

export function chestIdemKey(chestId: string, userId: string): string {
    return `chest:${chestId}:${userId}`
}
