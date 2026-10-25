// Serie e scudo della serie (PO 25/10/2026). Funzioni pure: le usano i premi
// del fissato (awards.ts), la home del GDO e il negozio.
//
// La serie è il numero di giorni lavorativi di fila (lun-sab, domeniche, feste
// nazionali e chiusure dell'ufficio saltate) in cui il GDO arriva al PRIMO
// scalino personale del giorno. Si ricostruisce solo dal registro: un giorno è
// "fatto" se ha l'accredito attivo del primo scalino (S:scalino:<id>:<giorno>:1).
// I giorni passati restano come sono, come gli scalini: solo il giorno di oggi
// può ancora cambiare (fissato tolto = scalino stornato = giorno non fatto).
//
// Le tappe (3, 6, 12... giorni) danno Scintille e, all'ultima, Piume. Ogni
// tappa ha una chiave legata all'inizio della serie: una serie nuova paga di
// nuovo, la stessa serie no. Se oggi lo scalino si storna, la tappa raggiunta
// oggi si storna con lui (e si riprende con una chiave nuova se si torna su).
//
// Lo scudo (potenziamento del negozio) salva la serie per un giorno lavorativo
// mancato: si consuma da solo sul primo giorno mancato dopo l'acquisto, uno
// in tasca al massimo e al massimo `scudiAlMese` comprati nel mese.

import { addDays, isWorkingDay, type DayStr } from '@/lib/quotes/calendar'

export const KIND_SCUDO = 'scudo'
export const CAUSALE_SERIE = 'serie'

export interface TappaSerie {
    giorni: number
    scintille: number
    piume: number
}

export interface SerieRules {
    tappe: TappaSerie[]
    /** Scudi comprabili nel mese di calendario (Roma). */
    scudiAlMese: number
    /** Scudi che si possono tenere da parte, non ancora usati. */
    scudiInTasca: number
}

/** Proposta del 25/10/2026, da far confermare a Bruno (valori in economy_rules.serie). */
export const DEFAULT_SERIE: SerieRules = {
    tappe: [
        { giorni: 3, scintille: 15, piume: 0 },
        { giorni: 6, scintille: 30, piume: 0 },
        { giorni: 12, scintille: 60, piume: 0 },
        { giorni: 24, scintille: 100, piume: 0 },
        { giorni: 36, scintille: 150, piume: 0 },
        { giorni: 48, scintille: 200, piume: 0 },
        { giorni: 60, scintille: 250, piume: 20 },
    ],
    scudiAlMese: 2,
    scudiInTasca: 1,
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const intero = (x: unknown, d: number, min: number) => (Number.isInteger(x) && (x as number) >= min ? (x as number) : d)

/** Regole dal JSON: tappe con giorni crescenti e premi interi; se qualcosa non torna, i default. */
export function parseSerie(v: unknown): SerieRules {
    const o = isObj(v) ? v : {}
    let tappe = DEFAULT_SERIE.tappe
    if (Array.isArray(o.tappe) && o.tappe.length > 0) {
        const lette = o.tappe.map(t => (isObj(t) ? {
            giorni: intero(t.giorni, -1, 1),
            scintille: intero(t.scintille ?? 0, -1, 0),
            piume: intero(t.piume ?? 0, -1, 0),
        } : null))
        const valide = lette.every((t, i): t is TappaSerie => !!t && t.giorni > 0 && t.scintille >= 0 && t.piume >= 0
            && (i === 0 || t.giorni > (lette[i - 1]?.giorni ?? Infinity)))
        if (valide) tappe = lette as TappaSerie[]
    }
    return {
        tappe,
        scudiAlMese: intero(o.scudiAlMese, DEFAULT_SERIE.scudiAlMese, 0),
        scudiInTasca: intero(o.scudiInTasca, DEFAULT_SERIE.scudiInTasca, 1),
    }
}

// ── Lettura del registro ────────────────────────────────────────────────

/** Riga del registro della persona, quanto basta alla serie. */
export interface RigaSerie {
    idemKey: string
    reason: string
    amount: number
    createdAt: Date
    metadata: unknown
}

const STORNO = 'storno:'
const stornate = (righe: readonly RigaSerie[]) =>
    new Set(righe.filter(r => r.idemKey.startsWith(STORNO)).map(r => r.idemKey.slice(STORNO.length)))

/**
 * Giorni "fatti": quelli col primo scalino personale ancora attivo. Chiavi
 * 'S:scalino:<userId>:<giorno>:1', dopo uno storno ':1:2', ':1:3'...
 */
export function giorniFatti(righe: readonly RigaSerie[], userId: string): Set<DayStr> {
    const via = stornate(righe)
    const prefisso = `S:scalino:${userId}:`
    const out = new Set<DayStr>()
    for (const r of righe) {
        if (!r.idemKey.startsWith(prefisso) || r.amount <= 0 || via.has(r.idemKey)) continue
        const m = /^(\d{4}-\d{2}-\d{2}):1(?::\d+)?$/.exec(r.idemKey.slice(prefisso.length))
        if (m) out.add(m[1])
    }
    return out
}

export interface AcquistoScudo {
    purchaseId: string
    at: Date
    /** Giorno di Roma dell'acquisto. */
    giorno: DayStr
}

/** Scudi comprati (addebito del negozio con metadata.scudo), tolti quelli annullati e rimborsati. */
export function scudiComprati(righe: readonly RigaSerie[], giornoDi: (d: Date) => DayStr): AcquistoScudo[] {
    const rimborsati = new Set(righe.filter(r => r.idemKey.startsWith('refund:')).map(r => r.idemKey.slice('refund:'.length)))
    const out: AcquistoScudo[] = []
    for (const r of righe) {
        if (r.reason !== 'negozio' || r.amount >= 0 || !isObj(r.metadata) || r.metadata.scudo !== true) continue
        const id = r.metadata.purchaseId
        if (typeof id !== 'string' || rimborsati.has(id)) continue
        out.push({ purchaseId: id, at: r.createdAt, giorno: giornoDi(r.createdAt) })
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

// ── Calcolo della serie ─────────────────────────────────────────────────

export interface StatoSerie {
    /** Giorni della serie in corso, oggi compreso se è già fatto. */
    giorni: number
    /** Primo giorno della serie in corso (null = nessuna serie). */
    inizio: DayStr | null
    /** Oggi è lavorativo. */
    oggiLavorativo: boolean
    /** Oggi il primo scalino è già raggiunto. */
    oggiFatto: boolean
    /** Scudi comprati e non ancora usati. */
    scudiInTasca: number
    /** Giorni salvati da uno scudo, in ordine. */
    salvati: DayStr[]
}

/**
 * Ricostruisce la serie giorno per giorno, dal primo giorno fatto fino a oggi.
 * Ogni giorno lavorativo passato: fatto = +1; mancato = lo salva uno scudo in
 * tasca (comprato entro quel giorno) se c'è una serie da salvare, altrimenti
 * la serie riparte da zero. Oggi conta solo se è già fatto: finché il giorno
 * non è chiuso, non averlo ancora fatto non rompe niente. I giorni non
 * lavorativi si saltano, anche se qualcuno ha lavorato.
 */
export function calcolaSerie(i: {
    fatti: ReadonlySet<DayStr>
    scudi: readonly AcquistoScudo[]
    oggi: DayStr
    chiusi?: ReadonlySet<string>
}): StatoSerie {
    const { fatti, scudi, oggi, chiusi } = i
    const lavorativo = (d: DayStr) => isWorkingDay(d, chiusi)
    const primi = [...fatti].filter(d => d <= oggi).sort()
    const primoScudo = scudi.length ? scudi[0].giorno : null
    let d = [primi[0], primoScudo].filter((x): x is string => !!x).sort()[0] ?? oggi
    let giorni = 0
    let inizio: DayStr | null = null
    let tasca = 0
    let prossimoScudo = 0
    const salvati: DayStr[] = []

    for (; d < oggi; d = addDays(d, 1)) {
        // Gli scudi comprati entro la fine del giorno valgono per quel giorno.
        while (prossimoScudo < scudi.length && scudi[prossimoScudo].giorno <= d) { tasca++; prossimoScudo++ }
        if (!lavorativo(d)) continue
        if (fatti.has(d)) {
            if (giorni === 0) inizio = d
            giorni++
        } else if (giorni > 0 && tasca > 0) {
            tasca--
            salvati.push(d)
        } else {
            giorni = 0
            inizio = null
        }
    }
    while (prossimoScudo < scudi.length && scudi[prossimoScudo].giorno <= oggi) { tasca++; prossimoScudo++ }
    const oggiLavorativo = lavorativo(oggi)
    const oggiFatto = oggiLavorativo && fatti.has(oggi)
    if (oggiFatto) {
        if (giorni === 0) inizio = oggi
        giorni++
    }
    return { giorni, inizio, oggiLavorativo, oggiFatto, scudiInTasca: tasca, salvati }
}

/** La prossima tappa da raggiungere (null = tutte raggiunte). */
export function prossimaTappa(giorni: number, r: SerieRules): TappaSerie | null {
    return r.tappe.find(t => t.giorni > giorni) ?? null
}

// ── Premi delle tappe ───────────────────────────────────────────────────

/** Chiave della tappa: legata all'inizio della serie; dopo uno storno ':2', ':3'... */
export function tappaIdemKey(valuta: 'S' | 'P', userId: string, inizio: DayStr, giorni: number, generazione = 1): string {
    const base = `${valuta}:serie:${userId}:${inizio}:${giorni}`
    return generazione > 1 ? `${base}:${generazione}` : base
}

export interface PremioTappa {
    valuta: 'S' | 'P'
    amount: number
    giorni: number
    idemKey: string
}

/**
 * Cosa fare sul registro perché la serie in corso abbia un accredito attivo
 * per ogni tappa raggiunta e nessuno sopra. Le tappe di serie finite restano
 * come sono; si stornano solo gli accrediti nati oggi (`oggiDa`) che la serie
 * di adesso non giustifica più, cioè la tappa raggiunta oggi con uno scalino
 * poi stornato.
 */
export function pianoSerie(righe: readonly RigaSerie[], userId: string, stato: StatoSerie, r: SerieRules, oggiDa: Date): {
    accredita: PremioTappa[]
    storna: string[]
} {
    const via = stornate(righe)
    const attivi = righe.filter(x => x.amount > 0 && !via.has(x.idemKey)
        && (x.idemKey.startsWith(`S:serie:${userId}:`) || x.idemKey.startsWith(`P:serie:${userId}:`)))
    const dovute = new Set<string>()
    const accredita: PremioTappa[] = []
    if (stato.inizio) {
        for (const t of r.tappe) {
            if (t.giorni > stato.giorni) break
            for (const [valuta, amount] of [['S', t.scintille], ['P', t.piume]] as const) {
                if (amount <= 0) continue
                const base = tappaIdemKey(valuta, userId, stato.inizio, t.giorni)
                dovute.add(base)
                const proprie = righe.filter(x => x.amount > 0 && (x.idemKey === base || x.idemKey.startsWith(`${base}:`)))
                if (proprie.some(x => !via.has(x.idemKey))) continue
                accredita.push({ valuta, amount, giorni: t.giorni, idemKey: tappaIdemKey(valuta, userId, stato.inizio, t.giorni, proprie.length + 1) })
            }
        }
    }
    // '<valuta>:serie:<userId>:<inizio>:<giorni>[:<generazione>]': la base sono i primi cinque pezzi.
    const baseDi = (k: string) => k.split(':').slice(0, 5).join(':')
    const storna = attivi
        .filter(x => x.createdAt.getTime() >= oggiDa.getTime() && !dovute.has(baseDi(x.idemKey)))
        .map(x => x.idemKey)
    return { accredita, storna }
}

// ── Scudo ───────────────────────────────────────────────────────────────

export type ScudoNo = 'scudo_tasca' | 'scudo_mese'

/** Si può comprare uno scudo adesso? Al massimo `scudiInTasca` da parte e `scudiAlMese` nel mese. */
export function puoComprareScudo(i: {
    stato: Pick<StatoSerie, 'scudiInTasca'>
    scudi: readonly AcquistoScudo[]
    oggi: DayStr
    rules: SerieRules
}): { ok: true } | { ok: false; error: ScudoNo } {
    if (i.stato.scudiInTasca >= i.rules.scudiInTasca) return { ok: false, error: 'scudo_tasca' }
    const mese = i.oggi.slice(0, 7)
    if (i.scudi.filter(s => s.giorno.slice(0, 7) === mese).length >= i.rules.scudiAlMese) return { ok: false, error: 'scudo_mese' }
    return { ok: true }
}

/** Scudi comprati nel mese di `oggi`. */
export function scudiDelMese(scudi: readonly AcquistoScudo[], oggi: DayStr): number {
    const mese = oggi.slice(0, 7)
    return scudi.filter(s => s.giorno.slice(0, 7) === mese).length
}
