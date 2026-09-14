/**
 * Pause lunghe per persona, al netto delle tre falle note della scheda
 * /monitor-pause (verificate il 2026-09-05).
 *
 *   npx tsx --env-file=.env scripts/cdr-pause-corrette.ts [YYYY-MM ...]
 *
 * Sola lettura. Rispetto a `cdr-pause-mensili.ts` (che riproduce la scheda
 * cosi' com'e') qui ogni buco oltre i 10 minuti viene classificato prima di
 * essere addebitato:
 *
 *   1. ENTRANTE  — dentro il buco c'e' una chiamata in arrivo a quell'interno
 *                  con conversazione: e' lavoro, non pausa. L'import scrive
 *                  `userId` solo sulle uscite e non conserva l'interno di
 *                  destinazione delle entranti, quindi vanno rilette dai CSV.
 *   2. COLLETTIVO — almeno meta' degli operatori in turno e' ferma nello
 *                  stesso momento: briefing, riunione, centralino giu'.
 *   3. LAVORO CRM — dentro il buco ci sono azioni nel CRM a ritmo sostenuto
 *                  (>= 1 ogni 4 minuti). ATTENZIONE: valgono solo le azioni
 *                  su lead effettivamente telefonati quel giorno. Le raffiche
 *                  di esiti su numeri mai chiamati NON comprano tempo, se no
 *                  proprio chi timbra esiti a vuoto risulterebbe il piu'
 *                  operoso.
 *
 * Quello che resta e' fermata individuale. Il confronto e' con i 30 minuti di
 * pausa concessi dal contratto; la colonna "fuori orario" isola le fermate che
 * non cadono nelle due fasce in cui la squadra va in pausa davvero.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { db } from '../src/db'
import { pbxCalls, users, leads, callLogs } from '../src/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { computeDayMetrics, type DayCall } from '../src/lib/cdr/dayMetrics'
import { shiftBoundsFor } from '../src/lib/cdr/shift'
import { toRomeDateStr } from '../src/lib/dateUtils'
import { mappaAttribuzione, chiaveGiorno } from '../src/lib/cdr/attribuzione'

const MIN_CALLS_PER_DAY = 40
const LONG_PAUSE_SEC = 10 * 60
const PAUSA_CONTRATTO_MIN = 30
const QUORUM_COLLETTIVO = 0.5
const SOVRAPPOSIZIONE_MIN_SEC = 8 * 60
const RITMO_CRM_SEC = 4 * 60          // un'azione ogni 4 minuti = lavoro
const CDR_DIR = 'data/cdr'

/** Le due fasce in cui la squadra prende le pause ufficiali (minuti da mezzanotte, ora di Roma). */
const FASCE_PAUSA_FERIALI = [[15 * 60, 16 * 60 + 30], [17 * 60 + 15, 18 * 60 + 45]]
const FASCE_PAUSA_SABATO = [[11 * 60 + 30, 13 * 60], [14 * 60, 15 * 60 + 30]]

const m = (sec: number) => Math.round(sec / 60)
const isExt = (s: string) => /^\d{3,4}$/.test(s)

/** Entranti per (interno, giorno): rilette dai CSV, dove `dst` e' ancora l'interno. */
function entrantiDaiCsv(): Map<string, { da: number; a: number }[]> {
    const out = new Map<string, { da: number; a: number }[]>()
    for (const f of readdirSync(CDR_DIR).filter(f => f.endsWith('.csv'))) {
        const recs: Record<string, string>[] = parse(readFileSync(`${CDR_DIR}/${f}`), {
            columns: true, skip_empty_lines: true, relax_column_count: true,
        })
        for (const r of recs) {
            const src = (r.src || '').trim(), dst = (r.dst || '').trim()
            if (!src || !dst || isExt(src) || !isExt(dst)) continue   // teniamo solo le entranti
            if ((Number(r.billsec) || 0) <= 0) continue               // squillo senza risposta: non e' lavoro
            const t = new Date(`${(r.calldate || '').replace(' ', 'T')}Z`)
            if (isNaN(t.getTime())) continue
            const k = `${dst}|${toRomeDateStr(t)}`
            const list = out.get(k) ?? []
            list.push({ da: t.getTime(), a: t.getTime() + (Number(r.duration) || 0) * 1000 })
            out.set(k, list)
        }
    }
    return out
}

type Fermata = { userId: string; da: number; a: number; sec: number }

/** Minuti da mezzanotte, ora di Roma, di un istante. */
function minutiRoma(ms: number): number {
    const [h, mm] = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false })
        .format(new Date(ms)).split(':')
    return Number(h) * 60 + Number(mm)
}

async function main() {
    const mesi = process.argv.slice(2).filter(a => /^\d{4}-\d{2}$/.test(a))
    const mappa = await mappaAttribuzione()
    const entranti = entrantiDaiCsv()

    const raw = await db.select({
        src: pbxCalls.src, dateLocal: pbxCalls.dateLocal, calldate: pbxCalls.calldate,
        duration: pbxCalls.duration, billsec: pbxCalls.billsec, disposition: pbxCalls.disposition, dstKey: pbxCalls.dstKey,
    }).from(pbxCalls).where(and(eq(pbxCalls.companyId, 'fenice'), eq(pbxCalls.direction, 'out')))

    const nomi = new Map<string, string>()
    for (const u of await db.select({ id: users.id, name: users.name, displayName: users.displayName }).from(users))
        nomi.set(u.id, u.displayName || u.name || u.id)

    // Esiti: servono tre volte — per l'abbuono di lavoro, per il ritmo delle
    // azioni CRM dentro un buco, e per sapere se quelle azioni sono su lead
    // davvero telefonati quel giorno.
    const outcomeRows = await db.select({ userId: callLogs.userId, outcome: callLogs.outcome, createdAt: callLogs.createdAt, phone: leads.phone })
        .from(callLogs).innerJoin(leads, eq(leads.id, callLogs.leadId))
        .where(and(eq(callLogs.companyId, 'fenice'), isNotNull(callLogs.userId)))

    // Numeri effettivamente composti da qualcuno, giorno per giorno.
    const compostiNelGiorno = new Set<string>()
    for (const r of raw) if (r.dstKey) compostiNelGiorno.add(`${r.dateLocal}|${r.dstKey}`)

    const outcomesByCall = new Map<string, { outcome: string; atMs: number }[]>()
    const azioniPerGiorno = new Map<string, { atMs: number; coperto: boolean }[]>()
    for (const r of outcomeRows) {
        const key10 = (r.phone ?? '').replace(/\D/g, '').slice(-10)
        if (key10.length < 10 || !r.userId) continue
        const d = toRomeDateStr(r.createdAt)
        const k = `${r.userId}|${d}|${key10}`
        const list = outcomesByCall.get(k)
        if (list) list.push({ outcome: r.outcome, atMs: r.createdAt.getTime() })
        else outcomesByCall.set(k, [{ outcome: r.outcome, atMs: r.createdAt.getTime() }])

        const ka = `${r.userId}|${d}`
        const la = azioniPerGiorno.get(ka) ?? []
        la.push({ atMs: r.createdAt.getTime(), coperto: compostiNelGiorno.has(`${d}|${key10}`) })
        azioniPerGiorno.set(ka, la)
    }
    for (const l of azioniPerGiorno.values()) l.sort((a, b) => a.atMs - b.atMs)

    const outcomeFor = (userId: string, dateLocal: string, dstKey: string | null, atMs: number) => {
        if (!dstKey) return null
        const list = outcomesByCall.get(`${userId}|${dateLocal}|${dstKey}`)
        if (!list?.length) return null
        let best = list[0]
        for (const o of list) if (Math.abs(o.atMs - atMs) < Math.abs(best.atMs - atMs)) best = o
        return best.outcome
    }

    // Giornate (persona, giorno) con le loro chiamate.
    const byDay = new Map<string, { userId: string; src: string; dateLocal: string; calls: DayCall[] }>()
    for (const r of raw) {
        const uid = mappa.get(chiaveGiorno(r.src, r.dateLocal))
        if (!uid) continue
        const k = `${uid}|${r.dateLocal}`
        let slot = byDay.get(k)
        if (!slot) { slot = { userId: uid, src: r.src, dateLocal: r.dateLocal, calls: [] }; byDay.set(k, slot) }
        slot.calls.push({
            outcome: outcomeFor(uid, r.dateLocal, r.dstKey, r.calldate.getTime()),
            calldate: r.calldate, duration: r.duration, billsec: r.billsec, disposition: r.disposition,
        })
    }

    // Primo giro: raccolgo tutte le fermate lunghe, servono per il quorum collettivo.
    const fermatePerGiorno = new Map<string, Fermata[]>()
    const operatoriPerGiorno = new Map<string, Set<string>>()
    const giornateValide: { key: string; slot: NonNullable<ReturnType<typeof byDay.get>> }[] = []

    for (const [key, slot] of byDay) {
        if (slot.calls.length < MIN_CALLS_PER_DAY) continue
        const shift = shiftBoundsFor(slot.dateLocal)
        if (!shift) continue
        const met = computeDayMetrics(slot.calls)
        if (!met) continue
        giornateValide.push({ key, slot })
        const set = operatoriPerGiorno.get(slot.dateLocal) ?? new Set<string>()
        set.add(slot.userId); operatoriPerGiorno.set(slot.dateLocal, set)

        const list = fermatePerGiorno.get(slot.dateLocal) ?? []
        for (const g of met.gapDetails) {
            const da = Math.max(g.startsAt.getTime(), shift.start.getTime())
            const a = Math.min(g.startsAt.getTime() + g.seconds * 1000, shift.end.getTime())
            const sec = Math.round((a - da) / 1000)
            if (sec <= LONG_PAUSE_SEC) continue
            list.push({ userId: slot.userId, da, a, sec })
        }
        fermatePerGiorno.set(slot.dateLocal, list)
    }

    type Acc = {
        giornate: number
        lorde: number; entranti: number; collettive: number; crm: number
        individuali: number; inFascia: number; fuoriFascia: number
        brevi: number; calls: number
    }
    const perMese = new Map<string, Acc>()

    for (const { slot } of giornateValide) {
        const shift = shiftBoundsFor(slot.dateLocal)!
        const met = computeDayMetrics(slot.calls)!
        const entrantiGiorno = entranti.get(`${slot.src}|${slot.dateLocal}`) ?? []
        const azioni = azioniPerGiorno.get(`${slot.userId}|${slot.dateLocal}`) ?? []
        const altri = fermatePerGiorno.get(slot.dateLocal) ?? []
        const nOperatori = operatoriPerGiorno.get(slot.dateLocal)?.size ?? 1
        const sabato = new Date(`${slot.dateLocal}T12:00:00Z`).getUTCDay() === 6
        const fasce = sabato ? FASCE_PAUSA_SABATO : FASCE_PAUSA_FERIALI

        const acc = (() => {
            const k = `${slot.userId}|${slot.dateLocal.slice(0, 7)}`
            const cur = perMese.get(k) ?? { giornate: 0, lorde: 0, entranti: 0, collettive: 0, crm: 0, individuali: 0, inFascia: 0, fuoriFascia: 0, brevi: 0, calls: 0 }
            perMese.set(k, cur); return cur
        })()
        acc.giornate++; acc.calls += met.calls

        for (const g of met.gapDetails) {
            const da = Math.max(g.startsAt.getTime(), shift.start.getTime())
            const a = Math.min(g.startsAt.getTime() + g.seconds * 1000, shift.end.getTime())
            const sec = Math.round((a - da) / 1000)
            if (sec <= 0) continue
            const eccesso = sec - Math.min(sec, g.allowanceSec)
            if (eccesso <= 0) continue

            if (sec <= LONG_PAUSE_SEC) { if (eccesso >= 60) acc.brevi += eccesso; continue }
            acc.lorde += eccesso

            // 1. entrante dentro il buco
            if (entrantiGiorno.some(e => e.a > da && e.da < a)) { acc.entranti += eccesso; continue }

            // 2. fermi collettivi: quanti altri sono fermi nello stesso momento
            const insieme = new Set<string>()
            for (const f of altri) {
                if (f.userId === slot.userId) continue
                const ov = Math.min(f.a, a) - Math.max(f.da, da)
                if (ov >= SOVRAPPOSIZIONE_MIN_SEC * 1000) insieme.add(f.userId)
            }
            if (nOperatori >= 3 && (insieme.size + 1) / nOperatori >= QUORUM_COLLETTIVO) { acc.collettive += eccesso; continue }

            // 3. lavoro nel CRM: azioni dense E su lead davvero telefonati
            const dentro = azioni.filter(x => x.atMs >= da && x.atMs <= a)
            const coperte = dentro.filter(x => x.coperto).length
            if (coperte >= Math.max(2, Math.floor(sec / RITMO_CRM_SEC))) { acc.crm += eccesso; continue }

            acc.individuali += eccesso
            const romaMin = minutiRoma(da)
            if (fasce.some(([x, y]) => romaMin >= x && romaMin < y)) acc.inFascia += eccesso
            else acc.fuoriFascia += eccesso
        }
    }

    console.log('Pause lunghe (>10 min) al netto di entranti, fermi collettivi e lavoro CRM verificato.')
    console.log('Tutte le colonne sono minuti al giorno sulle giornate intere (>= 40 chiamate).\n')
    console.log('mese     persona     gg   lorde  entranti  collettive  lavoroCRM  INDIVIDUALI  di cui fuori fascia  oltre i 30\'  brevi 2-10\'')
    console.log('-'.repeat(126))
    const chiavi = [...perMese.keys()]
        .filter(k => mesi.length === 0 || mesi.includes(k.split('|')[1]))
        .sort((a, b) => {
            const [ua, ma] = a.split('|'); const [ub, mb] = b.split('|')
            return ma === mb ? (nomi.get(ua) ?? '').localeCompare(nomi.get(ub) ?? '') : ma.localeCompare(mb)
        })
    let mesePrec = ''
    for (const k of chiavi) {
        const [uid, mese] = k.split('|')
        const a = perMese.get(k)!
        if (a.giornate < 3) continue
        if (mese !== mesePrec) { if (mesePrec) console.log(''); mesePrec = mese }
        const p = (x: number, w: number) => String(m(x / a.giornate)).padStart(w)
        const ind = m(a.individuali / a.giornate)
        console.log(
            `${mese}  ${(nomi.get(uid) ?? uid).padEnd(10)} ${String(a.giornate).padStart(3)} ${p(a.lorde, 7)} ${p(a.entranti, 9)} ${p(a.collettive, 11)} ` +
            `${p(a.crm, 10)} ${String(ind).padStart(12)} ${p(a.fuoriFascia, 20)} ${String(Math.max(0, ind - PAUSA_CONTRATTO_MIN)).padStart(12)} ${p(a.brevi, 12)}`
        )
    }
    await (db as any).$client?.end?.()
}

main().catch(async (e) => { console.error(e); await (db as any).$client?.end?.(); process.exit(1) })
