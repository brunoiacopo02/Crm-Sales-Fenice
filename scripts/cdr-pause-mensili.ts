/**
 * Interruzioni per persona, per mese — con l'attribuzione delle postazioni
 * ricavata dai dati invece che da `pbxExtensions`.
 *
 *   npx tsx --env-file=.env scripts/cdr-pause-mensili.ts [--vecchia]
 *
 * Sola lettura. Stesse regole della scheda "Tempo al telefono" di
 * /monitor-pause e di analisi-pause-settimana.ts: turni, abbuono di lavoro per
 * esito, interruzioni brevi (buchi <= 10 min oltre l'abbuono) e pause lunghe.
 * Il numero da portare e' l'ultima colonna: quanto le interruzioni superano i
 * 30 minuti di pausa concessi da contratto.
 *
 * Con `--vecchia` usa `pbxCalls.userId` com'e' scritto adesso, per confronto.
 */
import { db } from '../src/db'
import { pbxCalls, users, leads, callLogs } from '../src/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { computeDayMetrics, type DayCall } from '../src/lib/cdr/dayMetrics'
import { shiftBoundsFor, lateAndEarly, romeDowOf } from '../src/lib/cdr/shift'
import { toRomeDateStr } from '../src/lib/dateUtils'
import { mappaAttribuzione, chiaveGiorno } from '../src/lib/cdr/attribuzione'

const MIN_CALLS_PER_DAY = 40
const PAUSE_EVENT_MIN_SEC = 60
const LONG_PAUSE_THRESHOLD_SEC = 10 * 60
const PAUSA_CONTRATTO_MIN = 30

const VECCHIA = process.argv.includes('--vecchia')
const m = (sec: number) => Math.round(sec / 60)

async function main() {
    const mappa = VECCHIA ? null : await mappaAttribuzione()

    const raw = await db.select({
        userId: pbxCalls.userId, src: pbxCalls.src, dateLocal: pbxCalls.dateLocal, calldate: pbxCalls.calldate,
        duration: pbxCalls.duration, billsec: pbxCalls.billsec, disposition: pbxCalls.disposition, dstKey: pbxCalls.dstKey,
    }).from(pbxCalls).where(and(eq(pbxCalls.companyId, 'fenice'), eq(pbxCalls.direction, 'out')))

    const nomi = new Map<string, string>()
    for (const u of await db.select({ id: users.id, name: users.name, displayName: users.displayName }).from(users))
        nomi.set(u.id, u.displayName || u.name || u.id)

    const outcomeRows = await db.select({ userId: callLogs.userId, outcome: callLogs.outcome, createdAt: callLogs.createdAt, phone: leads.phone })
        .from(callLogs).innerJoin(leads, eq(leads.id, callLogs.leadId))
        .where(and(eq(callLogs.companyId, 'fenice'), isNotNull(callLogs.userId)))
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

    const byDay = new Map<string, { userId: string; dateLocal: string; calls: DayCall[] }>()
    for (const r of raw) {
        const uid = VECCHIA ? r.userId : (mappa!.get(chiaveGiorno(r.src, r.dateLocal)) ?? null)
        if (!uid) continue
        const k = `${uid}|${r.dateLocal}`
        let slot = byDay.get(k)
        if (!slot) { slot = { userId: uid, dateLocal: r.dateLocal, calls: [] }; byDay.set(k, slot) }
        slot.calls.push({
            outcome: outcomeFor(uid, r.dateLocal, r.dstKey, r.calldate.getTime()),
            calldate: r.calldate, duration: r.duration, billsec: r.billsec, disposition: r.disposition,
        })
    }

    type Acc = { giornate: number; short: number; long: number; talk: number; calls: number }
    const perMese = new Map<string, Acc>()
    for (const slot of byDay.values()) {
        if (slot.calls.length < MIN_CALLS_PER_DAY) continue
        const shift = shiftBoundsFor(slot.dateLocal)
        if (!shift) continue
        const met = computeDayMetrics(slot.calls)
        if (!met) continue
        let shortPauseSec = 0, longPauseSec = 0
        for (const g of met.gapDetails) {
            const a = Math.max(g.startsAt.getTime(), shift.start.getTime())
            const b = Math.min(g.startsAt.getTime() + g.seconds * 1000, shift.end.getTime())
            const inShiftSec = Math.max(0, Math.round((b - a) / 1000))
            if (!inShiftSec) continue
            const excess = inShiftSec - Math.min(inShiftSec, g.allowanceSec)
            if (excess <= 0) continue
            if (inShiftSec <= LONG_PAUSE_THRESHOLD_SEC) { if (excess >= PAUSE_EVENT_MIN_SEC) shortPauseSec += excess }
            else longPauseSec += excess
        }
        const k = `${slot.userId}|${slot.dateLocal.slice(0, 7)}`
        const cur = perMese.get(k) ?? { giornate: 0, short: 0, long: 0, talk: 0, calls: 0 }
        cur.giornate++; cur.short += shortPauseSec; cur.long += longPauseSec
        cur.talk += met.talkSeconds; cur.calls += met.calls
        perMese.set(k, cur)
    }

    console.log(VECCHIA ? '>>> attribuzione ATTUALE (pbxExtensions)\n' : '>>> attribuzione CORRETTA (ricavata dai dati)\n')
    console.log('mese     persona     giornate  min voce/gg  brevi/gg  lunghe/gg  interruzioni/gg  oltre i 30\' da contratto')
    console.log('-'.repeat(108))
    const chiavi = [...perMese.keys()].sort((a, b) => {
        const [ua, ma] = a.split('|'); const [ub, mb] = b.split('|')
        return ma === mb ? (nomi.get(ua) ?? '').localeCompare(nomi.get(ub) ?? '') : ma.localeCompare(mb)
    })
    let mesePrec = ''
    for (const k of chiavi) {
        const [uid, mese] = k.split('|')
        const a = perMese.get(k)!
        if (a.giornate < 3) continue
        if (mese !== mesePrec) { if (mesePrec) console.log(''); mesePrec = mese }
        const brevi = m(a.short / a.giornate), lunghe = m(a.long / a.giornate)
        const tot = brevi + lunghe
        console.log(
            `${mese}  ${(nomi.get(uid) ?? uid).padEnd(10)} ${String(a.giornate).padStart(8)} ` +
            `${String(m(a.talk / a.giornate)).padStart(12)} ${String(brevi).padStart(9)} ${String(lunghe).padStart(10)} ` +
            `${String(tot).padStart(16)} ${String(Math.max(0, tot - PAUSA_CONTRATTO_MIN)).padStart(24)}`
        )
    }
    await (db as any).$client?.end?.()
}

main().catch(async (e) => { console.error(e); await (db as any).$client?.end?.(); process.exit(1) })
