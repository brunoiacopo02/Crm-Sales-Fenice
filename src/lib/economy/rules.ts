// Regole della nuova economia: Scintille (ritmo) e Piume (risultati verificati
// da altri), PO 25/10/2026, riviste il 25/10 sera ("economia v2": più
// parsimoniosa, calcoli in docs/superpowers/specs/2026-10-25-economia-v2-margini.md).
//
// I valori vivono in appSettings, chiave ECONOMY_RULES_KEY (JSON), e l'admin li
// può cambiare senza deploy. Qui ci sono i default e tutti i calcoli puri:
// chiavi idempotenti del registro, regola dei 30 giorni per lead, scalini
// personali, stadi dei lead (Piume del GDO e Scintille delle Conferme),
// obiettivi settimanali delle Conferme, forzieri di squadra e premi della
// classifica. Le soglie della Diretta (8/10, 55/65, 14/20, presenze) non stanno
// qui: sono gli obiettivi in src/lib/diretta/config.ts.
//
// Regola d'oro della v2: sullo stesso lead le Piume NON si sommano per stadio.
// Vale lo stadio più alto raggiunto (confermato, presentato, chiuso): quando il
// lead sale si accredita solo la differenza, quando scende si storna.

import { DEFAULT_BOOSTER, parseBooster, type BoosterRules } from './booster'
import { dayBoundsRome } from '@/lib/dateUtils'
import { stepReached, guadagnaPremiPersonali, type GamificationTargets } from '@/lib/diretta/config'

export const ECONOMY_RULES_KEY = 'economy_rules'

export type ChestTier = 'raro' | 'leggendario'
export type ChestKind = 'giorno_1' | 'giorno_2' | 'punta_1' | 'punta_2'

/** Stadio di un lead per le Piume del GDO: 0 nessuno, 1 confermato, 2 presentato, 3 chiuso. */
export type StadioGdo = 0 | 1 | 2 | 3
/** Stadio di un lead per le Scintille delle Conferme: 0 nessuno, 1 confermato in tempo utile, 2 presentato. */
export type StadioConferme = 0 | 1 | 2
export type TipoObiettivo = 'presenze' | 'chiusure'

export interface ChestOdds {
    probPiuma: number              // probabilità (0..1) che il forziere contenga Piume
    piume: number                  // quante Piume, se escono
    scintille: [number, number]    // altrimenti Scintille fra min e max, estremi inclusi
}

/** Obiettivo settimanale a due scalini: soglie (1° e 2°) e Piume di ciascuno scalino. */
export interface Obiettivo {
    soglie: [number, number]
    piume: [number, number]
}

export interface EconomyRules {
    /** Giorno di Roma 'YYYY-MM-DD' da cui contano gli esiti per Piume e premi delle Conferme. */
    inizio: string
    fissato: {
        scintille: number          // per ogni lead fissato
        finestraGiorni: number     // un lead paga una volta ogni N giorni
        tettoGiorno: number        // fissati pagati al giorno a persona
    }
    /** Scintille al primo e al secondo scalino personale del giorno. */
    scaliniPersonali: [number, number]
    /**
     * Piume del GDO per lead: VALORE dello stadio più alto raggiunto, non una
     * somma. Un lead chiuso vale `chiusura` in tutto, non conferma + presenza +
     * chiusura. Devono crescere: conferma ≤ presenza ≤ chiusura.
     */
    piume: {
        conferma: number
        presenza: number
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
    /** Premi delle Conferme (solo ruolo CONFERME letto dal DB). */
    conferme: {
        /** Scintille per lead, a stadi come le Piume del GDO (vale lo stadio più alto). */
        scintille: {
            conferma: number           // stadio 1: confermato prima dell'ora dell'appuntamento
            presenza: number           // stadio 2: il lead si è presentato (valore totale del lead)
            inTempo: number            // in più sulla presenza se la conferma è arrivata con anticipo
            inTempoMinuti: number      // anticipo minimo sull'ora dell'appuntamento
            tettoConfermeGiorno: number // stadi 1 pagati al giorno a persona
        }
        /** Obiettivi settimanali (lun-sab) sui lead confermati da chi guarda. */
        obiettivi: Record<TipoObiettivo, Obiettivo>
        /** Soglie diverse per persona (per esempio chi fa le Conferme a metà tempo). */
        perPersona: Record<string, Partial<Record<TipoObiettivo, [number, number]>>>
    }
    /** Classifica settimanale (lun-sab): euro lordi al 1°, 2° e 3°. */
    classifica: {
        premiEuro: [number, number, number]
        /** Presenze minime per stare sul podio (e prendere il premio). */
        minPresenze: number
    }
    /** Booster dei fissati comprato in negozio (./booster): il prezzo sta nell'articolo. */
    booster: BoosterRules
}

export const DEFAULT_ECONOMY_RULES: EconomyRules = {
    inizio: '2026-10-26',
    fissato: { scintille: 10, finestraGiorni: 30, tettoGiorno: 15 },
    scaliniPersonali: [20, 60],
    piume: { conferma: 1, presenza: 2, chiusura: 4 },
    forzieri: {
        raro: { probPiuma: 0.05, piume: 1, scintille: [10, 30] },
        leggendario: { probPiuma: 0.2, piume: 1, scintille: [30, 80] },
        minFissatiGiorno: 1,
        minFissatiPunta: 1,
    },
    conferme: {
        scintille: { conferma: 4, presenza: 22, inTempo: 8, inTempoMinuti: 60, tettoConfermeGiorno: 14 },
        obiettivi: {
            presenze: { soglie: [14, 20], piume: [3, 4] },
            chiusure: { soglie: [4, 6], piume: [4, 5] },
        },
        perPersona: {},
    },
    classifica: { premiEuro: [50, 25, 10], minPresenze: 1 },
    booster: DEFAULT_BOOSTER,
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
const coppiaLibera = (v: unknown, d: [number, number], min: number): [number, number] =>
    Array.isArray(v) && v.length === 2 && v.every(x => Number.isInteger(x) && x >= min) ? [v[0], v[1]] : d
const giornoIso = (v: unknown, d: string) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : d)
/** Euro lordi: da 0 a 1.000, al massimo due decimali. */
const euro = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6 ? v : d

function parseOdds(v: unknown, d: ChestOdds): ChestOdds {
    const o = isObj(v) ? v : {}
    return {
        probPiuma: probabilita(o.probPiuma, d.probPiuma),
        piume: intero(o.piume, d.piume, 1),
        scintille: coppia(o.scintille, d.scintille, 1),
    }
}

function parseObiettivo(v: unknown, d: Obiettivo): Obiettivo {
    const o = isObj(v) ? v : {}
    return { soglie: coppia(o.soglie, d.soglie, 1), piume: coppiaLibera(o.piume, d.piume, 0) }
}

/**
 * Valori degli stadi: interi da 0 in su e non decrescenti. Se l'ordine è
 * rotto (per esempio la presenza vale meno della conferma) torna il default
 * intero del blocco: con un valore che scende uno stadio più alto toglierebbe
 * Piume invece di darne.
 */
function stadiCrescenti<T extends Record<string, number>>(raw: unknown, d: T, ordine: (keyof T)[]): T {
    const o = isObj(raw) ? raw : {}
    const out = { ...d }
    for (const k of ordine) out[k] = intero(o[k as string], d[k], 0) as T[keyof T]
    for (let i = 1; i < ordine.length; i++) {
        if (out[ordine[i]] < out[ordine[i - 1]]) return { ...d }
    }
    return out
}

function parsePerPersona(raw: unknown): EconomyRules['conferme']['perPersona'] {
    const out: EconomyRules['conferme']['perPersona'] = {}
    if (!isObj(raw)) return out
    for (const [userId, v] of Object.entries(raw)) {
        if (!userId || !isObj(v)) continue
        const voce: Partial<Record<TipoObiettivo, [number, number]>> = {}
        for (const tipo of ['presenze', 'chiusure'] as const) {
            const c = coppia(v[tipo], [0, 0], 1)
            if (c[0] >= 1) voce[tipo] = c
        }
        if (voce.presenze || voce.chiusure) out[userId] = voce
    }
    return out
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
    const forzieri = isObj(saved.forzieri) ? saved.forzieri : {}
    const conferme = isObj(saved.conferme) ? saved.conferme : {}
    const obiettivi = isObj(conferme.obiettivi) ? conferme.obiettivi : {}
    const sc = isObj(conferme.scintille) ? conferme.scintille : {}
    const classifica = isObj(saved.classifica) ? saved.classifica : {}
    const premi = Array.isArray(classifica.premiEuro) && classifica.premiEuro.length === 3
        ? classifica.premiEuro.map((v, i) => euro(v, d.classifica.premiEuro[i])) as [number, number, number]
        : d.classifica.premiEuro
    const stadiConferme = stadiCrescenti(
        { conferma: sc.conferma, presenza: sc.presenza },
        { conferma: d.conferme.scintille.conferma, presenza: d.conferme.scintille.presenza },
        ['conferma', 'presenza'],
    )
    return {
        inizio: giornoIso(saved.inizio, d.inizio),
        fissato: {
            scintille: intero(fissato.scintille, d.fissato.scintille, 0),
            finestraGiorni: intero(fissato.finestraGiorni, d.fissato.finestraGiorni, 1),
            tettoGiorno: intero(fissato.tettoGiorno, d.fissato.tettoGiorno, 0),
        },
        scaliniPersonali: coppia(saved.scaliniPersonali, d.scaliniPersonali, 0),
        piume: stadiCrescenti(saved.piume, d.piume, ['conferma', 'presenza', 'chiusura']),
        forzieri: {
            raro: parseOdds(forzieri.raro, d.forzieri.raro),
            leggendario: parseOdds(forzieri.leggendario, d.forzieri.leggendario),
            minFissatiGiorno: intero(forzieri.minFissatiGiorno, d.forzieri.minFissatiGiorno, 0),
            minFissatiPunta: intero(forzieri.minFissatiPunta, d.forzieri.minFissatiPunta, 0),
        },
        conferme: {
            scintille: {
                ...stadiConferme,
                inTempo: intero(sc.inTempo, d.conferme.scintille.inTempo, 0),
                inTempoMinuti: intero(sc.inTempoMinuti, d.conferme.scintille.inTempoMinuti, 0),
                tettoConfermeGiorno: intero(sc.tettoConfermeGiorno, d.conferme.scintille.tettoConfermeGiorno, 0),
            },
            obiettivi: {
                presenze: parseObiettivo(obiettivi.presenze, d.conferme.obiettivi.presenze),
                chiusure: parseObiettivo(obiettivi.chiusure, d.conferme.obiettivi.chiusure),
            },
            perPersona: parsePerPersona(conferme.perPersona),
        },
        classifica: {
            premiEuro: premi,
            minPresenze: intero(classifica.minPresenze, d.classifica.minPresenze, 1),
        },
        booster: parseBooster(saved.booster),
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
    /** Chi possiede la riga: serve a sapere chi tiene la conferma di un lead. */
    userId?: string
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

/** Chiave con generazione: la prima è la base, le successive ':2', ':3'... (servono solo dopo uno storno). */
function conGenerazione(base: string, generazione: number): string {
    return generazione > 1 ? `${base}:${generazione}` : base
}

export interface Gradino { gradino: number; amount: number; idemKey: string }
export interface PianoGradini { accredita: Gradino[]; storna: string[] }

/**
 * Motore comune di scalini, stadi e obiettivi: `importi[i]` è il valore del
 * gradino i+1. Ogni gradino raggiunto deve avere esattamente un accredito
 * attivo, ogni gradino non più raggiunto nessuno. Dopo uno storno il gradino
 * si riprende con una chiave nuova. Un importo a zero non accredita e non
 * storna niente: conta solo la soglia.
 */
function pianoGradini(rows: LedgerRow[], chiave: (gradino: number) => string, raggiunto: number, importi: readonly number[]): PianoGradini {
    const accredita: Gradino[] = []
    const storna: string[] = []
    for (let gradino = 1; gradino <= importi.length; gradino++) {
        const base = chiave(gradino)
        const { accrediti, stornati } = accreditiEStorni(rows, base)
        const propri = accrediti.filter(c => c.idemKey === base || c.idemKey.startsWith(`${base}:`))
        const attivi = propri.filter(c => !stornati.has(c.idemKey)).map(c => c.idemKey)
        if (raggiunto < gradino) {
            storna.push(...attivi)
        } else if (attivi.length === 0) {
            const amount = importi[gradino - 1]
            if (amount > 0) accredita.push({ gradino, amount, idemKey: conGenerazione(base, propri.length + 1) })
        } else {
            storna.push(...attivi.slice(1))
        }
    }
    return { accredita, storna }
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
    return conGenerazione(`S:fissato:${leadId}:${finestraIndex(giornoRoma, giorni)}`, generazione)
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
 * `dal` limita al ciclo corrente (gli accrediti nati da `dal` in poi, vedi
 * `inizioStorno`); null = tutti.
 */
export function fissatiDaStornare(rows: LedgerRow[], leadId: string, dal: Date | null): string[] {
    const { accrediti, stornati } = accreditiEStorni(rows, `S:fissato:${leadId}:`)
    return accrediti
        .filter(c => !stornati.has(c.idemKey))
        .filter(c => !dal || !c.createdAt || c.createdAt.getTime() >= dal.getTime())
        .map(c => c.idemKey)
}

// ── Ciclo dell'appuntamento (per gli storni) ────────────────────────────

/**
 * Fatti della storia di un lead che contano per capire a quale ciclo
 * d'appuntamento appartiene un accredito:
 * - 'fissato': un callLog APPUNTAMENTO (di chiunque);
 * - 'chiusura': un callLog con un altro esito, l'annullamento dell'admin, la
 *   riapertura di uno scarto delle Conferme, un appuntamento messo da un'altra
 *   strada (lancio, venditore);
 * - 'lavoro': un lavoro delle Conferme o del venditore sul lead (chiamate,
 *   conferma, presenza, esito).
 */
export type TipoEventoCiclo = 'fissato' | 'chiusura' | 'lavoro'

export interface EventoCiclo {
    at: Date
    tipo: TipoEventoCiclo
}

// A pari istante la chiusura e il lavoro vengono prima del fissato: la
// riapertura di uno scarto scritta insieme al nuovo fissato apre il ciclo nuovo.
const PESO_EVENTO: Record<TipoEventoCiclo, number> = { chiusura: 0, lavoro: 1, fissato: 2 }

/**
 * Ciclo d'appuntamento in corso: la serie più recente di APPUNTAMENTO, a
 * ritroso fino alla prima chiusura o al primo lavoro delle Conferme.
 * Rifissare un lead già in appuntamento allunga la serie ma non ne sposta
 * l'inizio, anche se riscrive appointmentCreatedAt. Il lavoro delle Conferme
 * DOPO l'ultimo fissato non chiude il ciclo (l'appuntamento è quello). `dopo` è
 * il fatto che precede il ciclo, se c'è.
 *
 * null = dopo l'ultimo fissato c'è una chiusura (il ciclo in corso non ha
 * fissati) oppure non c'è nessun fissato: niente da stornare.
 */
export function cicloInCorso(eventi: readonly EventoCiclo[]): { inizio: Date; dopo: Date | null } | null {
    const ord = [...eventi].sort((a, b) => a.at.getTime() - b.at.getTime() || PESO_EVENTO[a.tipo] - PESO_EVENTO[b.tipo])
    let ultimo = -1
    for (let i = ord.length - 1; i >= 0; i--) {
        if (ord[i].tipo === 'fissato') { ultimo = i; break }
        if (ord[i].tipo === 'chiusura') return null
    }
    if (ultimo < 0) return null
    let primo = ultimo
    while (primo > 0 && ord[primo - 1].tipo === 'fissato') primo--
    return { inizio: ord[primo].at, dopo: primo > 0 ? ord[primo - 1].at : null }
}

/**
 * Da quando stornare gli accrediti del fissato di un lead il cui appuntamento
 * sparisce: dall'inizio del ciclo in corso meno `margineMs` (orologio dell'app
 * contro orologio del DB), mai prima del fatto che chiude il ciclo precedente.
 * null = niente da stornare.
 */
export function inizioStorno(eventi: readonly EventoCiclo[], margineMs: number): Date | null {
    const ciclo = cicloInCorso(eventi)
    if (!ciclo) return null
    const t = ciclo.inizio.getTime() - margineMs
    return new Date(ciclo.dopo ? Math.max(t, ciclo.dopo.getTime()) : t)
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

/**
 * Chiave dello scalino del giorno. Dopo uno storno (fissati scesi sotto la
 * soglia) lo scalino si può riprendere con una chiave nuova: ':2', ':3'...
 */
export function scalinoIdemKey(userId: string, giornoRoma: string, scalino: 1 | 2, generazione = 1): string {
    return conGenerazione(`S:scalino:${userId}:${giornoRoma}:${scalino}`, generazione)
}

/**
 * Scalini personali del giorno allineati ai fissati validi (vedi
 * src/lib/diretta/fissati.ts): si accredita lo scalino raggiunto che non ha un
 * accredito attivo e si storna quello che non è più raggiunto, per esempio dopo
 * un appuntamento tolto. Un importo messo a zero non storna niente: conta solo
 * la soglia.
 */
export function pianoScalini(
    rows: LedgerRow[], userId: string, giornoRoma: string, fissati: number,
    soglie: [number, number], importi: [number, number],
): { accredita: Array<{ scalino: 1 | 2; scintille: number; idemKey: string }>; storna: string[] } {
    const p = pianoGradini(rows, g => scalinoIdemKey(userId, giornoRoma, g as 1 | 2), stepReached(fissati, soglie), importi)
    return {
        accredita: p.accredita.map(a => ({ scalino: a.gradino as 1 | 2, scintille: a.amount, idemKey: a.idemKey })),
        storna: p.storna,
    }
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
    /** Fissati validi di oggi (src/lib/diretta/fissati.ts), questo compreso. */
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

// ── Stadi del lead (comuni a GDO e Conferme) ────────────────────────────

/** Prefissi delle chiavi a stadi: Piume del GDO e Scintille delle Conferme. */
export const PREFISSO_STADI = { gdo: 'P:lead', conferme: 'S:conf' } as const

/** Chiave dello stadio `stadio` di un lead: '<prefisso>:<leadId>:<stadio>', poi ':2', ':3' dopo gli storni. */
export function stadioIdemKey(prefisso: string, leadId: string, stadio: number, generazione = 1): string {
    return conGenerazione(`${prefisso}:${leadId}:${stadio}`, generazione)
}

/**
 * Importi dei gradini a partire dai VALORI degli stadi: il primo gradino vale
 * lo stadio 1, ogni gradino dopo vale la differenza con lo stadio prima. Così
 * un lead allo stadio k ha in tutto esattamente il valore dello stadio k.
 */
export function importiDaValori(valori: readonly number[]): number[] {
    return valori.map((v, i) => Math.max(0, v - (i > 0 ? valori[i - 1] : 0)))
}

/**
 * Cosa fare sul registro perché il lead abbia gli accrediti dei gradini fino
 * allo stadio raggiunto e nessuno sopra: sale di stadio = si accredita la
 * differenza, scende = si storna il gradino perso.
 */
export function pianoStadi(rows: LedgerRow[], prefisso: string, leadId: string, stadio: number, importi: readonly number[]): PianoGradini {
    return pianoGradini(rows, g => stadioIdemKey(prefisso, leadId, g), stadio, importi)
}

// ── Presenza e chiusura verificate (collaudo del 25/10/2026) ────────────
//
// Il server accetta "Presenziato" e "Chiuso" anche prima dell'ora
// dell'appuntamento, e il latch presentedAt prende la data dell'appuntamento
// e non si toglie più. Le monete invece pagano una presenza o una chiusura
// solo se qualcuno l'ha registrata all'ora dell'appuntamento o dopo, e solo
// quando quell'ora è passata: prima nessuno può sapere se il lead si
// presenterà, e un esito scritto in anticipo non è un risultato verificato
// (non lo diventa da solo quando l'ora passa). Se poi arriva un esito vero
// (il venditore dopo la call), paga quello.

/** Un esito del venditore registrato sul lead: quando è stato scritto e cosa dice. */
export interface RegistrazioneEsito {
    at: Date
    /** 'Chiuso', 'Non chiuso', 'Lead non presenziato'... null = non dice niente di presenza o chiusura. */
    esito: string | null
    /**
     * Vendita applicata dal foglio (riconciliazione): è già avvenuta, qualunque
     * ora dica l'appuntamento nel CRM.
     */
    daFoglio?: boolean
}

/** Gli esiti che dicono che il lead si è presentato. */
export const ESITI_PRESENZA: readonly string[] = ['Chiuso', 'Non chiuso']

/**
 * Famiglie della riconciliazione col foglio (src/lib/riconciliazione) che
 * registrano una vendita. 'solo-crm' (una chiusura che il foglio non ha e che
 * torna "Non chiuso") resta fuori: non dice che il lead si è presentato.
 */
const ESITO_RICONCILIAZIONE: Record<string, string> = {
    'esito-mancante': 'Chiuso',
    'lead-scartato': 'Chiuso',
}

/**
 * Le registrazioni dagli eventi del lead: 'salesperson_outcome_set' (Conferme
 * dallo Storico e venditori, `metadata.outcome`) e 'RECONCILED' (vendite
 * applicate dal foglio, fatte sempre a cose avvenute). Una run annullata non
 * registra niente: si saltano l'annullamento e gli eventi della run con lo
 * stesso runId, perché lo stato del lead è tornato com'era.
 */
export function registrazioniDaEventi(eventi: readonly { eventType: string; timestamp: Date; metadata: unknown }[]): RegistrazioneEsito[] {
    const meta = (e: { metadata: unknown }) => (e.metadata && typeof e.metadata === 'object' ? e.metadata : {}) as Record<string, unknown>
    const annullate = new Set<string>()
    for (const e of eventi) {
        const m = meta(e)
        if (e.eventType === 'RECONCILED' && m.undo === true && typeof m.runId === 'string') annullate.add(m.runId)
    }
    const out: RegistrazioneEsito[] = []
    for (const e of eventi) {
        const m = meta(e)
        if (e.eventType === 'salesperson_outcome_set') {
            out.push({ at: e.timestamp, esito: typeof m.outcome === 'string' ? m.outcome : null })
        } else if (e.eventType === 'RECONCILED' && m.undo !== true && typeof m.family === 'string') {
            if (typeof m.runId === 'string' && annullate.has(m.runId)) continue
            const esito = ESITO_RICONCILIAZIONE[m.family]
            if (esito) out.push({ at: e.timestamp, esito, daFoglio: true })
        }
    }
    return out
}

/** Tipi di evento da leggere per registrazioniDaEventi. */
export const EVENTI_REGISTRAZIONE = ['salesperson_outcome_set', 'RECONCILED'] as const

/**
 * Presenza e chiusura del lead valgono per l'economia solo se una
 * registrazione dell'esito è arrivata all'ora dell'appuntamento o dopo, e
 * quell'ora è passata.
 *
 * L'ora di riferimento di una registrazione è l'appuntamento che valeva
 * quando è stata scritta:
 * - quello di adesso, se da allora non è stato spostato (appointmentMovedAt);
 * - quello del latch presentedAt (l'ora dell'appuntamento alla prima
 *   presenza), se è stato spostato dopo.
 * Così un esito scritto dopo uno spostamento guarda il nuovo appuntamento (il
 * latch lasciato da un esito in anticipo non conta), e una presenza già
 * verificata non si perde se poi l'appuntamento cambia. Senza appuntamento né
 * latch non c'è un "prima" da cui guardarsi. Le vendite dal foglio valgono
 * sempre: sono già avvenute.
 */
export function esitiVerificati(
    s: { presentedAt: Date | null; appointmentDate: Date | null; appointmentMovedAt?: Date | null; salespersonOutcome: string | null },
    registrazioni: readonly RegistrazioneEsito[],
    now: Date,
): { presenza: boolean; chiusura: boolean } {
    const riferimento = (r: RegistrazioneEsito): Date | null => {
        const spostatoDopo = !!s.appointmentMovedAt && s.appointmentMovedAt.getTime() > r.at.getTime()
        return spostatoDopo ? (s.presentedAt ?? s.appointmentDate) : (s.appointmentDate ?? s.presentedAt)
    }
    const valida = (r: RegistrazioneEsito) => {
        if (r.daFoglio) return true
        const ora = riferimento(r)
        return !ora || (r.at.getTime() >= ora.getTime() && ora.getTime() <= now.getTime())
    }
    return {
        presenza: !!s.presentedAt
            && registrazioni.some(r => !!r.esito && ESITI_PRESENZA.includes(r.esito) && valida(r)),
        chiusura: s.salespersonOutcome === 'Chiuso'
            && registrazioni.some(r => r.esito === 'Chiuso' && valida(r)),
    }
}

// ── Piume del GDO ───────────────────────────────────────────────────────

export interface StatoPiumeLead {
    confirmationsOutcome: string | null
    /** Chi ha confermato è una persona dello staff (non il bot del lancio). */
    confermatoDaPersona: boolean
    confirmationsTimestamp: Date | null
    presentedAt: Date | null
    appointmentDate: Date | null
    salespersonOutcome: string | null
    /** Presenza registrata a appuntamento passato (esitiVerificati): obbligatorio, così nessuna lettura lo dimentica. */
    presenzaVerificata: boolean
    /** Chiusura registrata a appuntamento passato (esitiVerificati). */
    chiusuraVerificata: boolean
}

/**
 * Quali risultati del lead valgono per il suo GDO, dato lo stato attuale.
 * Tutti richiedono una conferma fatta da una persona: le Piume premiano
 * risultati verificati da Conferme e venditori, non dal bot. Presenza e
 * chiusura richiedono anche la verifica (esitiVerificati): un "Presenziato"
 * scritto prima dell'ora dell'appuntamento non paga.
 *
 * Avvio dell'economia (26/10): conta sia il fatto sia la sua registrazione.
 * La conferma guarda quando è stata scritta; presenza e chiusura guardano
 * l'ora dell'appuntamento, e la verifica chiede che la registrazione sia
 * arrivata dopo, quindi anche lei dal 26/10. Così un esito scritto prima
 * dell'avvio non paga (anche se l'appuntamento è dopo) e un appuntamento di
 * prima dell'avvio registrato in ritardo resta del periodo vecchio, come per
 * il bonus delle presenze e la classifica, che contano per settimana
 * dell'appuntamento.
 */
export function piumeDovute(s: StatoPiumeLead, inizio: Date): { conferma: boolean; presenza: boolean; chiusura: boolean } {
    const confermato = s.confirmationsOutcome === 'confermato' && s.confermatoDaPersona
    const dopoInizio = (d: Date | null) => !!d && d.getTime() >= inizio.getTime()
    return {
        conferma: confermato && dopoInizio(s.confirmationsTimestamp),
        presenza: confermato && s.presenzaVerificata && dopoInizio(s.presentedAt),
        chiusura: confermato && s.chiusuraVerificata && s.salespersonOutcome === 'Chiuso' && dopoInizio(s.presentedAt ?? s.appointmentDate),
    }
}

/** Stadio più alto raggiunto dal lead per le Piume del GDO. */
export function stadioGdo(s: StatoPiumeLead, inizio: Date): StadioGdo {
    const d = piumeDovute(s, inizio)
    if (d.chiusura) return 3
    if (d.presenza) return 2
    if (d.conferma) return 1
    return 0
}

/** Importi dei tre gradini del GDO (conferma, presenza, chiusura) dai valori degli stadi. */
export function importiGdo(r: EconomyRules): number[] {
    return importiDaValori([r.piume.conferma, r.piume.presenza, r.piume.chiusura])
}

/** Causale del gradino del GDO sul registro. */
export function causaleGradinoGdo(gradino: number): string {
    return gradino === 3 ? 'chiusura' : gradino === 2 ? 'presenza' : 'conferma'
}

export interface PersonaEconomia {
    id: string
    role: string
    isActive: boolean
    isBot?: boolean | null
    /** Account di prova (migr. 0050): obbligatorio, così nessuna lettura lo dimentica. */
    isTest: boolean | null
    firstName: string | null
}

const RUOLI_STAFF = new Set(['CONFERME', 'VENDITORE', 'MANAGER', 'ADMIN', 'TL'])

/** Conferme, venditori e staff in carne e ossa: il ruolo viene dal DB, non dai metadata della sessione. */
export function isPersonaleUmano(u: PersonaEconomia | undefined | null): boolean {
    return !!u && !u.isBot && RUOLI_STAFF.has(u.role)
}

/**
 * Le Piume entrano solo se a scrivere l'esito è lo staff e a riceverle è un GDO
 * della squadra, o il GDO di prova sul suo registro (mai sé stesso). Che lead e
 * destinatario stiano dalla stessa parte lo controlla chi chiama (syncLeadPiume).
 */
export function puoAccreditarePiume(autore: PersonaEconomia | undefined | null, destinatario: PersonaEconomia | undefined | null): boolean {
    return !!autore && !!destinatario && isPersonaleUmano(autore) && guadagnaPremiPersonali(destinatario) && autore.id !== destinatario.id
}

// ── Conferme: Scintille per lead ────────────────────────────────────────

/** Account delle Conferme che guadagna: ruolo CONFERME letto dal DB, attivo, non bot. */
export function isConfermePersona(u: Pick<PersonaEconomia, 'role' | 'isActive' | 'isBot'> | undefined | null): boolean {
    return !!u && u.role === 'CONFERME' && u.isActive && !u.isBot
}

export interface StatoConfermeLead {
    confirmationsOutcome: string | null
    confirmationsTimestamp: Date | null
    appointmentDate: Date | null
    presentedAt: Date | null
}

/** Lo stato delle Conferme con la verifica della presenza (esitiVerificati), per gli stadi. */
export interface StatoConfermeVerificato extends StatoConfermeLead {
    presenzaVerificata: boolean
}

/**
 * La conferma conta per le Conferme solo se è arrivata PRIMA dell'ora
 * dell'appuntamento: una conferma registrata a call iniziata (il lead è già
 * davanti al venditore) serve al conteggio delle presenze del GDO, ma non è
 * lavoro di conferma e non paga.
 */
export function confermaUtile(s: StatoConfermeLead): boolean {
    return s.confirmationsOutcome === 'confermato' && !!s.confirmationsTimestamp && !!s.appointmentDate
        && s.confirmationsTimestamp.getTime() < s.appointmentDate.getTime()
}

/** Conferma arrivata con almeno `minuti` di anticipo sull'appuntamento. */
export function confermaInTempo(s: Pick<StatoConfermeLead, 'confirmationsTimestamp' | 'appointmentDate'>, minuti: number): boolean {
    return !!s.confirmationsTimestamp && !!s.appointmentDate
        && s.appointmentDate.getTime() - s.confirmationsTimestamp.getTime() >= minuti * 60_000
}

/**
 * Stadio del lead per le Scintille di chi l'ha confermato. La presenza vale
 * dall'avvio dell'economia e solo se verificata (registrata a appuntamento
 * passato, vedi esitiVerificati); la sola conferma solo se fatta dall'avvio
 * in poi. `giaRegistrata` = la conferma ha già il suo accredito attivo (era
 * utile quando è stata fatta): un salvataggio successivo a call iniziata, per
 * esempio per cambiare venditore, sposta confirmationsTimestamp ma non la
 * rende meno vera.
 */
export function stadioConferme(s: StatoConfermeVerificato, inizio: Date, giaRegistrata = false): StadioConferme {
    if (s.confirmationsOutcome !== 'confermato') return 0
    if (!giaRegistrata && !confermaUtile(s)) return 0
    if (s.presentedAt && s.presenzaVerificata && s.presentedAt.getTime() >= inizio.getTime()) return 2
    if (giaRegistrata || (s.confirmationsTimestamp && s.confirmationsTimestamp.getTime() >= inizio.getTime())) return 1
    return 0
}

/** Importi dei due gradini delle Conferme: la conferma e il resto della presenza (più il bonus "in tempo"). */
export function importiConferme(r: EconomyRules, inTempo: boolean): number[] {
    const s = r.conferme.scintille
    const [g1, g2] = importiDaValori([s.conferma, s.presenza])
    return [g1, g2 + (inTempo ? s.inTempo : 0)]
}

/** L'accredito attivo del primo gradino delle Conferme sul lead (la conferma pagata), se c'è. */
export function confermaRegistrata(rows: LedgerRow[], leadId: string): LedgerRow | undefined {
    const base = stadioIdemKey(PREFISSO_STADI.conferme, leadId, 1)
    const { accrediti, stornati } = accreditiEStorni(rows, base)
    return accrediti.find(c => (c.idemKey === base || c.idemKey.startsWith(`${base}:`)) && !stornati.has(c.idemKey))
}

/**
 * Chi tiene la conferma del lead per i premi delle Conferme: chi ha
 * l'accredito attivo del primo gradino (la prima conferma del ciclo), così una
 * seconda conferma di un collega sullo stesso lead non sposta il premio;
 * altrimenti chi risulta sul lead.
 */
export function titolareConferma(rows: LedgerRow[], leadId: string, confirmationsUserId: string | null): string | null {
    return confermaRegistrata(rows, leadId)?.userId ?? confirmationsUserId
}

/** Il tetto giornaliero delle conferme pagate: true se se ne può pagare un'altra. */
export function sottoTettoConferme(pagateOggi: number, r: EconomyRules): boolean {
    return pagateOggi < r.conferme.scintille.tettoConfermeGiorno
}

// ── Conferme: obiettivi settimanali (Piume) ─────────────────────────────

/** Soglie e Piume degli obiettivi di una persona: le sue soglie se impostate, altrimenti quelle di tutti. */
export function obiettiviPersona(r: EconomyRules, userId: string): Record<TipoObiettivo, Obiettivo> {
    const p = r.conferme.perPersona[userId]
    return {
        presenze: { soglie: p?.presenze ?? r.conferme.obiettivi.presenze.soglie, piume: r.conferme.obiettivi.presenze.piume },
        chiusure: { soglie: p?.chiusure ?? r.conferme.obiettivi.chiusure.soglie, piume: r.conferme.obiettivi.chiusure.piume },
    }
}

/** Chiave dello scalino di un obiettivo: 'P:obiettivo:<tipo>:<userId>:<lunedì>:<scalino>'. */
export function obiettivoIdemKey(tipo: TipoObiettivo, userId: string, lunedi: string, scalino: number, generazione = 1): string {
    return conGenerazione(`P:obiettivo:${tipo}:${userId}:${lunedi}:${scalino}`, generazione)
}

/** Scalini dell'obiettivo settimanale allineati al conteggio: come gli scalini personali dei GDO. */
export function pianoObiettivo(rows: LedgerRow[], tipo: TipoObiettivo, userId: string, lunedi: string, valore: number, o: Obiettivo): PianoGradini {
    return pianoGradini(rows, g => obiettivoIdemKey(tipo, userId, lunedi, g), stepReached(valore, o.soglie), o.piume)
}

/**
 * Lead che contano per gli obiettivi di una Conferma in una settimana. Contano
 * solo i lead che tiene lei (titolareConferma), confermati prima
 * dell'appuntamento, e solo se presenza o chiusura le ha scritte qualcun
 * altro: chi conferma non si premia registrando da sé l'esito del venditore.
 */
export interface LeadObiettivo {
    titolare: string | null
    confermaUtile: boolean
    /** Chi ha scritto l'ultimo esito del venditore (null = nessun evento). */
    autoreEsito: string | null
    presentedAt: Date | null
    chiusoAt: Date | null
    /** Presenza e chiusura registrate a appuntamento passato (esitiVerificati). */
    presenzaVerificata: boolean
    chiusuraVerificata: boolean
}

export function contaObiettivi(rows: readonly LeadObiettivo[], userId: string, start: Date, end: Date): Record<TipoObiettivo, number> {
    const dentro = (d: Date | null) => !!d && d.getTime() >= start.getTime() && d.getTime() < end.getTime()
    let presenze = 0
    let chiusure = 0
    for (const r of rows) {
        if (r.titolare !== userId || !r.confermaUtile || r.autoreEsito === userId) continue
        if (r.presenzaVerificata && dentro(r.presentedAt)) presenze++
        if (r.chiusuraVerificata && dentro(r.chiusoAt)) chiusure++
    }
    return { presenze, chiusure }
}

// ── Forzieri di squadra ─────────────────────────────────────────────────
// I conteggi (fissati validi di squadra e di ciascuno) arrivano da
// contaFissati di src/lib/diretta/fissati.ts, gli stessi della home.

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
export function destinatariForziere(perUtente: Record<string, number>, squadra: string[], minimo: number): string[] {
    return squadra.filter(id => (perUtente[id] ?? 0) >= minimo)
}

export function chestIdemKey(chestId: string, userId: string): string {
    return `chest:${chestId}:${userId}`
}

// ── Classifica settimanale ──────────────────────────────────────────────

/** Euro lordi della posizione (1, 2, 3); fuori dal podio 0. */
export function premioClassifica(posizione: number, r: EconomyRules): number {
    return posizione >= 1 && posizione <= 3 ? r.classifica.premiEuro[posizione - 1] : 0
}
