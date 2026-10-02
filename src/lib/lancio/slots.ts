/**
 * Ore libere della mattina del giorno dopo e round robin fra i venditori.
 * Puro: riceve fatti già letti (Task 5 li legge dal DB) e un `now` esplicito.
 *
 * "Libero in un'ora" = l'ha dichiarata nel calendario, non l'ha bloccata e non
 * ha già un appuntamento: la stessa lettura di checkBookingAllowed (Conferme).
 * Un esente (calendarExempt) NON dichiara ore nel calendario ma è comunque
 * prenotabile — il muro delle Conferme lo lascia passare sempre — quindi
 * `declaredHoursFor` gli dichiara d'ufficio tutte le ore del turno. Se lo si
 * lasciasse "uscire da solo" sparirebbe dagli slot mostrati al bot pur essendo
 * di turno e libero.
 */
import { romeInstant } from '@/lib/venditore/calendarSlots'
import { LANCIO_CONFERME_CAP_ORA, LANCIO_WEBDEV, MIN_LEAD_TIME_MS, ORIZZONTE_GIORNI, type LancioConfig } from './config'
import { giornoDopo, hourKey, oreConfermeDel } from './rules'

export interface ShiftMember {
    salesUserId: string
    lastAssignedAt: Date | null
}

export interface VenditoreDayFacts extends ShiftMember {
    declared: Set<string>
    blocked: Set<string>
    busy: Set<string>
}

export interface MattinaHour {
    hour: number
    liberi: number
    /**
     * Chi è libero in quell'ora, in ordine ALFABETICO di id: NON è l'ordine del
     * round robin. Per scegliere a chi assegnare passa questa lista (rimappata
     * sui rispettivi `VenditoreDayFacts`) a `pickRoundRobin`.
     */
    venditoriLiberi: string[]
}

export function isFreeAt(v: VenditoreDayFacts, key: string): boolean {
    return v.declared.has(key) && !v.blocked.has(key) && !v.busy.has(key)
}

/**
 * Le ore che valgono come DICHIARATE per un membro del turno.
 *
 * Normalmente sono quelle salvate sul calendario (`slotKeys`). Un esente
 * (`calendarExempt`) non compila il calendario ma resta prenotabile: per lui
 * contano dichiarate tutte le `hours` del turno, in unione con le eventuali ore
 * che avesse comunque salvato. Bloccati e occupati si applicano lo stesso: un
 * esente con un appuntamento alle 11 resta occupato alle 11.
 */
export function declaredHoursFor(
    member: { calendarExempt?: boolean | null },
    slotKeys: Iterable<string>,
    day: { dateStr: string; hours: number[] },
): Set<string> {
    const out = new Set(slotKeys)
    if (member.calendarExempt) for (const h of day.hours) out.add(hourKey(day.dateStr, h))
    return out
}

/**
 * Le ore tonde ancora prenotabili in quella data: stessa soglia che `classifyAt`
 * applica su `book` (MIN_LEAD_TIME_MS). È l'unico posto che la calcola, così
 * mattina e pomeriggio non possono divergere: offrire al bot un'ora che `book`
 * rifiuterebbe con `fuori_regole` gli farebbe promettere al lead un orario che
 * poi non esiste.
 */
export function orePrenotabili(dateStr: string, hours: readonly number[], now: Date): number[] {
    const cutoff = now.getTime() + MIN_LEAD_TIME_MS
    return hours.filter(h => romeInstant(dateStr, h).getTime() >= cutoff)
}

/**
 * Ore Conferme ancora prenotabili: preavviso (`orePrenotabili`, la stessa soglia di
 * `classifyAt`) e tetto per ora. Pura: gli occupati li legge `confermeOccupati`.
 */
export function confermeOre(input: {
    dateStr: string; hours: number[]; occupati: Map<number, number>; cap: number; now: Date
}): Array<{ hour: number; liberi: number }> {
    return orePrenotabili(input.dateStr, input.hours, input.now)
        .map(hour => ({ hour, liberi: Math.max(0, input.cap - (input.occupati.get(hour) ?? 0)) }))
        .filter(o => o.liberi > 0)
}

export interface PrimoGiornoConferme {
    conferme: { date: string; ore: Array<{ hour: number; liberi: number }> } | null
    /** Giorni lun-sab saltati perché pieni: il bot dice "siamo pieni". */
    saltati: string[]
}

/**
 * Il primo giorno >= `from` (e >= del giorno dopo del lancio) con posto alle Conferme.
 * La domenica si salta senza contarla fra i pieni; un giorno passato per anticipo
 * (oggi alle 20:30) non e' "pieno" e non va in `saltati`. `occupatiDel` e' iniettato:
 * in produzione legge il DB, nei test una Map.
 */
export async function primoGiornoConferme(input: {
    from: string
    now: Date
    cfg?: LancioConfig
    occupatiDel: (date: string) => Promise<Map<number, number>>
}): Promise<PrimoGiornoConferme> {
    const cfg = input.cfg ?? LANCIO_WEBDEV
    const saltati: string[] = []
    let d = input.from < cfg.giornoDopo ? cfg.giornoDopo : input.from
    for (let i = 0; i < ORIZZONTE_GIORNI; i++, d = giornoDopo(d)) {
        const hours = oreConfermeDel(d, cfg)
        if (hours.length === 0) continue
        const ore = confermeOre({ dateStr: d, hours, occupati: await input.occupatiDel(d), cap: LANCIO_CONFERME_CAP_ORA, now: input.now })
        if (ore.length > 0) return { conferme: { date: d, ore }, saltati }
        if (orePrenotabili(d, hours, input.now).length > 0) saltati.push(d)
    }
    return { conferme: null, saltati }
}

export function mattinaSlots(input: {
    dateStr: string
    hours: number[]
    venditori: VenditoreDayFacts[]
    now: Date
}): { mattina: MattinaHour[]; mattinaEsaurita: boolean } {
    const mattina: MattinaHour[] = []
    for (const hour of orePrenotabili(input.dateStr, input.hours, input.now)) {
        const key = hourKey(input.dateStr, hour)
        const liberi = input.venditori.filter(v => isFreeAt(v, key)).map(v => v.salesUserId).sort()
        mattina.push({ hour, liberi: liberi.length, venditoriLiberi: liberi })
    }
    return { mattina, mattinaEsaurita: mattina.every(m => m.liberi === 0) }
}

/** `coalesce(lastAssignedAt,'epoch'), salesUserId` — la stessa regola dell'ORDER BY della spec. */
export function pickRoundRobin<T extends ShiftMember>(candidati: T[]): T | null {
    if (candidati.length === 0) return null
    return [...candidati].sort((a, b) => {
        const ta = a.lastAssignedAt?.getTime() ?? 0
        const tb = b.lastAssignedAt?.getTime() ?? 0
        if (ta !== tb) return ta - tb
        return a.salesUserId < b.salesUserId ? -1 : a.salesUserId > b.salesUserId ? 1 : 0
    })[0]
}

export interface CoperturaRow {
    salesUserId: string
    name: string
    calendarExempt: boolean
    /** Calendario della settimana consegnato (o esente: non lo compila mai). */
    compilato: boolean
    oreDichiarate: number[]
    oreLibere: number[]
}

/**
 * Riga per riga la copertura del giorno dopo mostrata su /lancio: puro, riceve
 * i fatti gia' letti. Un membro senza fatti (nessuna riga di calendario) resta
 * in tabella a zero ore: sparire dalla griglia nasconderebbe proprio il caso
 * che l'avviso rosso deve gridare.
 */
export function coperturaRows(input: {
    dateStr: string
    hours: number[]
    membri: Array<{ salesUserId: string; name: string; calendarExempt: boolean }>
    facts: VenditoreDayFacts[]
    compilati: ReadonlySet<string>
}): CoperturaRow[] {
    const byId = new Map(input.facts.map(f => [f.salesUserId, f]))
    return input.membri.map(m => {
        const f = byId.get(m.salesUserId)
        return {
            salesUserId: m.salesUserId,
            name: m.name,
            calendarExempt: m.calendarExempt,
            compilato: input.compilati.has(m.salesUserId) || m.calendarExempt,
            oreDichiarate: f ? input.hours.filter(h => f.declared.has(hourKey(input.dateStr, h))) : [],
            oreLibere: f ? input.hours.filter(h => isFreeAt(f, hourKey(input.dateStr, h))) : [],
        }
    })
}
