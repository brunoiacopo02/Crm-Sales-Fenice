"use server"

/**
 * Mini-riassunto per azienda per lo switcher in topbar (QA Conferme
 * 2026-06-12): numeri chiave dell'altra azienda sempre visibili, così spesso
 * non serve nemmeno cambiare. Per ogni azienda consentita:
 * - apptToday: appuntamenti schedulati oggi (Europe/Rome)
 * - richiamiDue: richiami scaduti o entro 30 min (CONFERME → snooze team;
 *   GDO → propri richiami pipeline; manager/admin → entrambi, a livello azienda)
 */

import { db } from "@/db"
import { leads } from "@/db/schema"
import { eq, and, ne, gte, lte, isNull, isNotNull, sql } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

export type CompanySwitchSummary = {
    companyId: string
    apptToday: number
    richiamiDue: number
}

export async function getCompanySwitchSummary(): Promise<CompanySwitchSummary[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.allowedCompanies.length < 2) return []

    const romeDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    const [y, m, d] = romeDateStr.split('-').map(Number)
    const todayStart = new Date(y, m - 1, d, 0, 0, 0, 0)
    const todayEnd = new Date(y, m - 1, d, 23, 59, 59, 999)
    const soon = new Date(Date.now() + 30 * 60 * 1000)

    const results: CompanySwitchSummary[] = []
    for (const companyId of ctx.allowedCompanies) {
        const [apptRow] = await db.select({ c: sql<number>`count(*)::int` })
            .from(leads)
            .where(and(
                eq(leads.companyId, companyId),
                eq(leads.status, 'APPOINTMENT'),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, todayStart),
                lte(leads.appointmentDate, todayEnd),
            ))

        // Richiami in scadenza, per ruolo.
        const snoozeCond = and(
            eq(leads.companyId, companyId),
            isNull(leads.confirmationsOutcome),
            isNotNull(leads.confSnoozeAt),
            lte(leads.confSnoozeAt, soon),
        )
        const gdoRecallConds = [
            eq(leads.companyId, companyId),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
            isNotNull(leads.recallDate),
            lte(leads.recallDate, soon),
        ]
        if (ctx.role === 'GDO') gdoRecallConds.push(eq(leads.assignedToId, ctx.userId))

        let richiamiDue = 0
        if (ctx.role === 'CONFERME') {
            const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(leads).where(snoozeCond)
            richiamiDue = r?.c || 0
        } else if (ctx.role === 'GDO') {
            const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(...gdoRecallConds))
            richiamiDue = r?.c || 0
        } else {
            const [[r1], [r2]] = await Promise.all([
                db.select({ c: sql<number>`count(*)::int` }).from(leads).where(snoozeCond),
                db.select({ c: sql<number>`count(*)::int` }).from(leads).where(and(...gdoRecallConds)),
            ])
            richiamiDue = (r1?.c || 0) + (r2?.c || 0)
        }

        results.push({ companyId, apptToday: apptRow?.c || 0, richiamiDue })
    }
    return results
}
