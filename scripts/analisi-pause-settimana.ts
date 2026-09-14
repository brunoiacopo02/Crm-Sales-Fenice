/**
 * Scheda "Tempo al telefono" esplosa GIORNO PER GIORNO.
 *
 * La scheda di /monitor-pause dà medie di periodo: con metà squadra in
 * mutua o in permesso le medie non dicono cosa è successo. Qui si vede la
 * singola giornata di ogni operatore, comprese quelle a zero chiamate
 * (assenze), che nella scheda non esistono perché non hanno tabulati.
 *
 *   npx tsx --env-file=.env scripts/analisi-pause-settimana.ts 2026-08-24 2026-09-04
 */
import { db } from '../src/db'
import { pbxCalls, users, leads, callLogs } from '../src/db/schema'
import { and, gte, lte, eq, isNotNull } from 'drizzle-orm'
import { computeDayMetrics, type DayCall } from '../src/lib/cdr/dayMetrics'
import {
    shiftBoundsFor, lateAndEarly, trainingAllowanceSec, isCollectiveTrainingDay, romeDowOf,
    WEEKDAY_DAYS_SHORT_THRESHOLD_MIN, SATURDAY_DAYS_SHORT_THRESHOLD_MIN,
} from '../src/lib/cdr/shift'
import { dayBoundsRome, toRomeDateStr } from '../src/lib/dateUtils'

const MIN_CALLS_PER_DAY = 40
const PAUSE_EVENT_MIN_SEC = 60
const LONG_PAUSE_THRESHOLD_SEC = 10 * 60

const from = process.argv[2]
const to = process.argv[3]
if (!from || !to) { console.error('Uso: ... <YYYY-MM-DD> <YYYY-MM-DD>'); process.exit(1) }

const hhmm = (d: Date) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(d)
const m = (sec: number) => Math.round(sec / 60)

async function main() {
    const raw = await db.select({
        userId: pbxCalls.userId, dateLocal: pbxCalls.dateLocal, calldate: pbxCalls.calldate,
        duration: pbxCalls.duration, billsec: pbxCalls.billsec, disposition: pbxCalls.disposition,
        dstKey: pbxCalls.dstKey, name: users.name, displayName: users.displayName,
    })
        .from(pbxCalls).innerJoin(users, eq(users.id, pbxCalls.userId))
        .where(and(
            eq(pbxCalls.companyId, 'fenice'), eq(pbxCalls.direction, 'out'),
            isNotNull(pbxCalls.userId), eq(users.phoneTimeTracked, true),
            gte(pbxCalls.dateLocal, from), lte(pbxCalls.dateLocal, to),
        ))

    const outcomeRows = await db.select({
        userId: callLogs.userId, outcome: callLogs.outcome, createdAt: callLogs.createdAt, phone: leads.phone,
    })
        .from(callLogs).innerJoin(leads, eq(leads.id, callLogs.leadId))
        .where(and(
            eq(callLogs.companyId, 'fenice'), isNotNull(callLogs.userId),
            gte(callLogs.createdAt, dayBoundsRome(new Date(`${from}T12:00:00Z`)).start),
            lte(callLogs.createdAt, dayBoundsRome(new Date(`${to}T12:00:00Z`)).end),
        ))
    const outcomesByCall = new Map<string, { outcome: string; atMs: number }[]>()
    for (const r of outcomeRows) {
        const key10 = (r.phone ?? '').replace(/\D/g, '').slice(-10)
        if (key10.length < 10 || !r.userId) continue
        const k = `${r.userId}|${toRomeDateStr(r.createdAt)}|${key10}`
        const list = outcomesByCall.get(k)
        if (list) list.push({ outcome: r.outcome, atMs: r.createdAt.getTime() })
        else outcomesByCall.set(k, [{ outcome: r.outcome, atMs: r.createdAt.getTime() }])
    }
    const outcomeFor = (userId: string, dateLocal: string, dstKey: string | null, atMs: number) => {
        if (!dstKey) return null
        const list = outcomesByCall.get(`${userId}|${dateLocal}|${dstKey}`)
        if (!list?.length) return null
        let best = list[0]
        for (const o of list) if (Math.abs(o.atMs - atMs) < Math.abs(best.atMs - atMs)) best = o
        return best.outcome
    }

    const byDay = new Map<string, { userId: string; gdo: string; dateLocal: string; calls: DayCall[] }>()
    for (const r of raw) {
        const k = `${r.userId}|${r.dateLocal}`
        let slot = byDay.get(k)
        if (!slot) { slot = { userId: r.userId!, gdo: r.displayName || r.name || r.userId!, dateLocal: r.dateLocal, calls: [] }; byDay.set(k, slot) }
        slot.calls.push({
            outcome: outcomeFor(r.userId!, r.dateLocal, r.dstKey, r.calldate.getTime()),
            calldate: r.calldate, duration: r.duration, billsec: r.billsec, disposition: r.disposition,
        })
    }

    let lastImportedMs = 0
    for (const r of raw) lastImportedMs = Math.max(lastImportedMs, r.calldate.getTime() + r.duration * 1000)

    function mk(slot: { userId: string; gdo: string; dateLocal: string; calls: DayCall[] }) {
        const shift = shiftBoundsFor(slot.dateLocal)!
        const met = computeDayMetrics(slot.calls)!
        const { startLateSec, endEarlySec } = lateAndEarly(met.firstAt, met.lastAt, shift)
        let workRhythmSec = 0, shortPauseSec = 0, shortPauseCount = 0, shortAfterRing = 0
        let longPauseSecRaw = 0, longPauseCount = 0
        const longPauses: { at: string; min: number }[] = []
        for (const g of met.gapDetails) {
            const a = Math.max(g.startsAt.getTime(), shift.start.getTime())
            const b = Math.min(g.startsAt.getTime() + g.seconds * 1000, shift.end.getTime())
            const inShiftSec = Math.max(0, Math.round((b - a) / 1000))
            if (!inShiftSec) continue
            const workSec = Math.min(inShiftSec, g.allowanceSec)
            workRhythmSec += workSec
            const excess = inShiftSec - workSec
            if (excess <= 0) continue
            if (inShiftSec <= LONG_PAUSE_THRESHOLD_SEC) {
                shortPauseSec += excess
                if (excess >= PAUSE_EVENT_MIN_SEC) { shortPauseCount++; if (g.afterUnanswered) shortAfterRing++ }
            } else {
                longPauseSecRaw += excess; longPauseCount++
                longPauses.push({ at: hhmm(new Date(a)), min: m(inShiftSec) })
            }
        }
        return {
            userId: slot.userId, gdo: slot.gdo, dateLocal: slot.dateLocal,
            dow: romeDowOf(slot.dateLocal), shiftMin: shift.minutes,
            calls: met.calls, unanswered: met.unansweredCalls, talkSec: met.talkSeconds, occupiedSec: met.occupiedSeconds,
            first: hhmm(met.firstAt), last: hhmm(met.lastAt),
            startLateSec, endEarlySec,
            workRhythmSec, shortPauseSec, shortPauseCount, shortAfterRing,
            longPauseSecRaw, longPauseCount, longPauses,
            lowVolume: slot.calls.length < MIN_CALLS_PER_DAY,
            notImported: shift.end.getTime() > lastImportedMs,
        }
    }
    type Rec = ReturnType<typeof mk>

    const recs: Rec[] = []
    for (const slot of byDay.values()) {
        if (!shiftBoundsFor(slot.dateLocal)) continue
        if (!computeDayMetrics(slot.calls)) continue
        recs.push(mk(slot))
    }

    const endEarlyByDate = new Map<string, number[]>()
    for (const d of recs) {
        if (d.lowVolume || d.notImported) continue
        const l = endEarlyByDate.get(d.dateLocal)
        if (l) l.push(d.endEarlySec); else endEarlyByDate.set(d.dateLocal, [d.endEarlySec])
    }
    const training = new Set<string>()
    for (const [dl, arr] of endEarlyByDate) if (isCollectiveTrainingDay(dl, arr)) training.add(dl)

    const roster = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users).where(and(
            eq(users.companyId, 'fenice'), eq(users.role, 'GDO'),
            eq(users.isActive, true), eq(users.isBot, false), eq(users.phoneTimeTracked, true),
        ))
    const rosterName = new Map(roster.map(r => [r.id, r.displayName || r.name || r.id]))

    const days: string[] = []
    for (let t = new Date(`${from}T12:00:00Z`); toRomeDateStr(t) <= to; t = new Date(t.getTime() + 86400000)) {
        const dl = toRomeDateStr(t)
        if (romeDowOf(dl) !== 0) days.push(dl)
    }

    const kk = (u: string, d: string) => `${u}|${d}`
    const byKey = new Map(recs.map(r => [kk(r.userId, r.dateLocal), r]))

    const out: Record<string, unknown>[] = []
    for (const d of days) {
        for (const [uid, nome] of rosterName) {
            const r = byKey.get(kk(uid, d))
            const soglia = romeDowOf(d) === 6 ? SATURDAY_DAYS_SHORT_THRESHOLD_MIN : WEEKDAY_DAYS_SHORT_THRESHOLD_MIN
            if (!r) { out.push({ giorno: d, gdo: nome, stato: 'ASSENTE', calls: 0 }); continue }
            const trainingAllow = trainingAllowanceSec(training.has(d), r.endEarlySec)
            const residuo = Math.max(0, trainingAllow - r.endEarlySec)
            const longPauseSec = Math.max(0, r.longPauseSecRaw - residuo)
            const interruzioni = m(r.shortPauseSec) + m(longPauseSec)
            const stato = r.notImported ? 'TABULATI-INCOMPLETI'
                : r.lowVolume ? 'POCHE-CHIAMATE'
                    : (m(r.startLateSec) > soglia || m(r.endEarlySec) > soglia) ? 'GIORNATA-CORTA'
                        : 'intera'
            out.push({
                giorno: d, gdo: nome, stato,
                calls: r.calls, senzaRisposta: r.unanswered, dalle: r.first, alle: r.last,
                ritardo: m(r.startLateSec), anticipo: m(r.endEarlySec),
                telefono: m(r.talkSec), occupato: m(r.occupiedSec), esiti: m(r.workRhythmSec),
                brevi: m(r.shortPauseSec), nBrevi: r.shortPauseCount, dopoSquillo: r.shortAfterRing,
                pause: m(longPauseSec), nPause: r.longPauseCount,
                interruzioni, oltre30: Math.max(0, interruzioni - 30),
                dettaglio: r.longPauses.map(p => `${p.at}(${p.min}')`).join(' '),
            })
        }
    }
    console.log(JSON.stringify({ training: [...training], days, rows: out }))
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
