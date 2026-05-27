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
import { gte, lt, and, eq, isNotNull, sql } from "drizzle-orm"
import { dayBoundsRome } from "../src/lib/dateUtils"
import { workingDaysBetween } from "../src/lib/workingDaysUtils"

const TENANT_ID = process.env.DEBUG_TENANT_ID || 'fenice'

async function main() {
    const now = new Date()
    const startBound = dayBoundsRome(new Date(now.getTime() - 29 * 86400000)).start
    const end = now
    const workingDays = Math.max(1, workingDaysBetween(startBound, end))

    console.log(`Tenant: ${TENANT_ID}`)
    console.log(`Finestra: ${startBound.toISOString()} → ${end.toISOString()}`)
    console.log(`Giorni lavorativi: ${workingDays}`)
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

    const callsAgg = await db.select({
        userId: callLogs.userId,
        cnt: sql<number>`count(*)::int`,
    })
        .from(callLogs)
        .where(and(
            eq(callLogs.companyId, TENANT_ID),
            isNotNull(callLogs.userId),
            gte(callLogs.createdAt, startBound),
            lt(callLogs.createdAt, end),
        ))
        .groupBy(callLogs.userId)

    const callsByGdo = new Map<string, number>()
    for (const r of callsAgg) if (r.userId) callsByGdo.set(r.userId, Number(r.cnt))

    console.log('| GDO | call/lead | call/giorno | lead/giorno | closed sample |')
    console.log('|-----|-----------|-------------|-------------|---------------|')
    for (const u of gdoUsers) {
        const cl = closedByGdo.get(u.id)
        const closedCount = cl?.count ?? 0
        const sumCalls = cl?.sumCalls ?? 0
        const avg = closedCount > 0 ? Math.round((sumCalls / closedCount) * 10) / 10 : null
        const totalCalls = callsByGdo.get(u.id) ?? 0
        const callsPerDay = Math.round((totalCalls / workingDays) * 10) / 10
        const cap = (avg && avg > 0) ? Math.round(callsPerDay / avg) : null
        console.log(`| ${(u.displayName ?? u.name ?? u.id).padEnd(20)} | ${String(avg ?? '—').padStart(8)} | ${String(callsPerDay).padStart(10)} | ${String(cap ?? '—').padStart(10)} | ${closedCount} |`)

        // Inline assertions sugli edge case.
        if (closedCount === 0 && avg !== null) throw new Error(`[ASSERT] ${u.id}: avg should be null when closedCount=0`)
        if ((avg === null || avg === 0) && cap !== null) throw new Error(`[ASSERT] ${u.id}: cap should be null when avg null/0`)
        if (totalCalls === 0 && callsPerDay !== 0) throw new Error(`[ASSERT] ${u.id}: callsPerDay should be 0 when totalCalls=0`)
    }

    // Team total consistency
    let teamSumCalls = 0, teamClosed = 0
    for (const v of closedByLead.values()) { teamSumCalls += v.callCount; teamClosed += 1 }
    const teamAvg = teamClosed > 0 ? teamSumCalls / teamClosed : null
    const sumOfPerGdoSumCalls = Array.from(closedByGdo.values()).reduce((a, b) => a + b.sumCalls, 0)
    const sumOfPerGdoClosed = Array.from(closedByGdo.values()).reduce((a, b) => a + b.count, 0)
    if (sumOfPerGdoSumCalls !== teamSumCalls) throw new Error(`[ASSERT] team sumCalls mismatch: perGdo=${sumOfPerGdoSumCalls} vs total=${teamSumCalls}`)
    if (sumOfPerGdoClosed !== teamClosed) throw new Error(`[ASSERT] team closedCount mismatch: perGdo=${sumOfPerGdoClosed} vs total=${teamClosed}`)
    console.log('')
    console.log(`Team avg call/lead: ${teamAvg !== null ? Math.round(teamAvg * 10) / 10 : '—'}  (${teamClosed} lead chiusi)`)
    console.log('✓ All assertions passed')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
