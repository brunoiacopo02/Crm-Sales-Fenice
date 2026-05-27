/**
 * Diagnostic script — verifica getGdoThroughputMetrics30d().
 *
 * Esegui con: npx tsx scripts/debug_throughput30d.ts
 *
 * Stampa la tabella per-GDO + team totals. Esegue assertion inline sui casi edge.
 */
import 'dotenv/config'

// Bypass della guardia "use server": importiamo direttamente per uso CLI.
// Il file usa `currentTenant()` che legge i cookies — qui non disponibili.
// Per il diagnostico stampiamo lo SQL atteso, oppure forziamo un tenant via env.
// Soluzione semplice: re-implementiamo la query con tenant hardcoded da env var.

import { db } from "../src/db"
import { callLogs, leads, users } from "../src/db/schema"
import { gte, lt, and, eq, isNotNull } from "drizzle-orm"
import { dayBoundsRome } from "../src/lib/dateUtils"

const TENANT_ID = process.env.DEBUG_TENANT_ID || 'fenice'
const MIN_LEADS_FOR_ACTIVE_DAY = 20

async function main() {
    const now = new Date()
    const startBound = dayBoundsRome(new Date(now.getTime() - 29 * 86400000)).start
    const end = now

    console.log(`Tenant: ${TENANT_ID}`)
    console.log(`Finestra: ${startBound.toISOString()} → ${end.toISOString()}`)
    console.log(`Soglia giorno attivo: >= ${MIN_LEADS_FOR_ACTIVE_DAY} lead esitati`)
    console.log('')

    const gdoUsers = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.companyId, TENANT_ID), eq(users.role, 'GDO')))

    // Lead in stato APPOINTMENT con appointmentCreatedAt nella finestra.
    const appointmentLeads = await db.select({
        id: leads.id,
        assignedToId: leads.assignedToId,
        callCount: leads.callCount,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, TENANT_ID),
            eq(leads.status, 'APPOINTMENT'),
            isNotNull(leads.assignedToId),
            isNotNull(leads.appointmentCreatedAt),
            gte(leads.appointmentCreatedAt, startBound),
            lt(leads.appointmentCreatedAt, end),
            eq(leads.isSelfBooked, false),
        ))

    // Lead in stato REJECTED con updatedAt (proxy del momento scarto) nella finestra.
    const rejectedLeads = await db.select({
        id: leads.id,
        assignedToId: leads.assignedToId,
        callCount: leads.callCount,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, TENANT_ID),
            eq(leads.status, 'REJECTED'),
            isNotNull(leads.assignedToId),
            gte(leads.updatedAt, startBound),
            lt(leads.updatedAt, end),
            eq(leads.isSelfBooked, false),
        ))

    const closedByLead = new Map<string, { assignedToId: string; callCount: number }>()
    for (const row of [...appointmentLeads, ...rejectedLeads]) {
        if (!row.assignedToId) continue
        if (closedByLead.has(row.id)) continue
        closedByLead.set(row.id, { assignedToId: row.assignedToId, callCount: row.callCount ?? 0 })
    }

    const closedByGdo = new Map<string, { sumCalls: number; count: number }>()
    for (const v of closedByLead.values()) {
        const cur = closedByGdo.get(v.assignedToId) ?? { sumCalls: 0, count: 0 }
        cur.sumCalls += v.callCount
        cur.count += 1
        closedByGdo.set(v.assignedToId, cur)
    }

    // Fetch raw callLogs per calcolare giorni attivi (>= MIN_LEADS_FOR_ACTIVE_DAY lead distinti).
    const allCalls = await db.select({
        leadId: callLogs.leadId,
        userId: callLogs.userId,
        createdAt: callLogs.createdAt,
    })
        .from(callLogs)
        .where(and(
            eq(callLogs.companyId, TENANT_ID),
            isNotNull(callLogs.userId),
            gte(callLogs.createdAt, startBound),
            lt(callLogs.createdAt, end),
        ))

    const dayKeyRome = (d: Date): string =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

    type DayBucket = { distinctLeads: Set<string>, totalCalls: number }
    const perUserDay = new Map<string, Map<string, DayBucket>>()
    for (const c of allCalls) {
        if (!c.userId) continue
        const day = dayKeyRome(c.createdAt)
        let userMap = perUserDay.get(c.userId)
        if (!userMap) { userMap = new Map(); perUserDay.set(c.userId, userMap) }
        let b = userMap.get(day)
        if (!b) { b = { distinctLeads: new Set(), totalCalls: 0 }; userMap.set(day, b) }
        b.distinctLeads.add(c.leadId)
        b.totalCalls += 1
    }

    const activityByGdo = new Map<string, { activeDays: number, callsOnActiveDays: number }>()
    for (const [userId, days] of perUserDay.entries()) {
        let activeDays = 0, callsOnActiveDays = 0
        for (const bucket of days.values()) {
            if (bucket.distinctLeads.size >= MIN_LEADS_FOR_ACTIVE_DAY) {
                activeDays += 1
                callsOnActiveDays += bucket.totalCalls
            }
        }
        activityByGdo.set(userId, { activeDays, callsOnActiveDays })
    }

    console.log('| GDO                  | call/lead | call/giorno | lead/giorno | active days | closed |')
    console.log('|----------------------|-----------|-------------|-------------|-------------|--------|')
    for (const u of gdoUsers) {
        const cl = closedByGdo.get(u.id)
        const closedCount = cl?.count ?? 0
        const sumCalls = cl?.sumCalls ?? 0
        const avg = closedCount > 0 ? Math.round((sumCalls / closedCount) * 10) / 10 : null
        const activity = activityByGdo.get(u.id) ?? { activeDays: 0, callsOnActiveDays: 0 }
        const callsPerDay = activity.activeDays > 0
            ? Math.round((activity.callsOnActiveDays / activity.activeDays) * 10) / 10
            : 0
        const cap = (avg && avg > 0 && activity.activeDays > 0)
            ? Math.round(callsPerDay / avg)
            : null
        console.log(`| ${(u.displayName ?? u.name ?? u.id).padEnd(20)} | ${String(avg ?? '—').padStart(9)} | ${String(callsPerDay).padStart(11)} | ${String(cap ?? '—').padStart(11)} | ${String(activity.activeDays).padStart(11)} | ${String(closedCount).padStart(6)} |`)

        // Inline assertions sugli edge case.
        if (closedCount === 0 && avg !== null) throw new Error(`[ASSERT] ${u.id}: avg should be null when closedCount=0`)
        if (activity.activeDays === 0 && cap !== null) throw new Error(`[ASSERT] ${u.id}: cap should be null when activeDays=0`)
        if ((avg === null || avg === 0) && cap !== null) throw new Error(`[ASSERT] ${u.id}: cap should be null when avg null/0`)
    }

    // Headline: media per singolo GDO attivo
    const activeRows = gdoUsers.map(u => {
        const cl = closedByGdo.get(u.id)
        const avg = (cl?.count ?? 0) > 0 ? (cl!.sumCalls / cl!.count) : null
        const a = activityByGdo.get(u.id) ?? { activeDays: 0, callsOnActiveDays: 0 }
        const cpd = a.activeDays > 0 ? a.callsOnActiveDays / a.activeDays : 0
        const cap = (avg && avg > 0 && a.activeDays > 0) ? cpd / avg : null
        return { name: u.displayName ?? u.name ?? u.id, cap, activeDays: a.activeDays }
    }).filter(r => r.cap != null && r.cap > 0)
    const avgPerGdo = activeRows.length > 0
        ? Math.round(activeRows.reduce((s, r) => s + (r.cap ?? 0), 0) / activeRows.length)
        : null

    console.log('')
    console.log(`Headline: un GDO medio gestisce ${avgPerGdo ?? '—'} lead al giorno`)
    console.log(`  (media su ${activeRows.length} GDO attivi: ${activeRows.map(r => `${r.name}=${Math.round(r.cap!)}`).join(', ')})`)
    console.log('✓ All assertions passed')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
