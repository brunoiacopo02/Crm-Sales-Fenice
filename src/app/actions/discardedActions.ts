"use server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { eq, isNotNull, and, inArray } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { leadVero } from "@/lib/prova/sql"

export type DiscardedLeadPayload = {
    id: string
    email: string
    funnel: string
    reason: string
    discardDate: Date
    discardedBy: string
    note: string
}

export async function getDiscardedLeadsForMarketing() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // We only care about leads that are REJECTED and have an email
    const condizioniLead = and(
        eq(leads.companyId, ctx.companyId),
        // I lead di prova (migr. 0050) non vanno al marketing.
        leadVero(),
        eq(leads.status, 'REJECTED'),
        isNotNull(leads.email)
    )
    // Solo le colonne che servono: sono decine di migliaia di righe.
    const rejectedLeads = await db.select({
        id: leads.id,
        email: leads.email,
        funnel: leads.funnel,
        discardReason: leads.discardReason,
        updatedAt: leads.updatedAt,
    }).from(leads).where(condizioniLead)

    if (rejectedLeads.length === 0) return []

    // Find the latest callLog for each of these leads that resulted in 'DA_SCARTARE'.
    // Gli id dei lead arrivano da una sottoquery, non da una lista di parametri:
    // con 75.242 scartati (collaudo del 25/10/2026) la lista superava il limite
    // di 65.535 parametri di Postgres e /scartati rispondeva 500.
    const logs = await db.select({
        leadId: callLogs.leadId,
        userId: callLogs.userId,
        discardReason: callLogs.discardReason,
        note: callLogs.note,
        createdAt: callLogs.createdAt,
    }).from(callLogs).where(
            and(
                eq(callLogs.companyId, ctx.companyId),
                eq(callLogs.outcome, 'DA_SCARTARE'),
                inArray(callLogs.leadId, db.select({ id: leads.id }).from(leads).where(condizioniLead))
            )
        )

    // Map logs to users for the 'discardedBy'
    const allUsers = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.companyId, ctx.companyId))
    const userMap = new Map(allUsers.map(u => [u.id, u.name || u.email]))

    // L'ultimo scarto di ogni lead, in un solo giro (prima un filter per lead: quadratico).
    const ultimoLog = new Map<string, (typeof logs)[number]>()
    for (const l of logs) {
        const prima = ultimoLog.get(l.leadId)
        if (!prima || l.createdAt.getTime() > prima.createdAt.getTime()) ultimoLog.set(l.leadId, l)
    }

    // Assemble payload
    const results: DiscardedLeadPayload[] = rejectedLeads.map(lead => {
        // Find the most recent discard log for this lead
        const latestLog = ultimoLog.get(lead.id)

        // Reason logic fallback
        const reason = latestLog?.discardReason || lead.discardReason || "Sconosciuto"
        const discardDate = latestLog?.createdAt || lead.updatedAt
        const discardedBy = latestLog && latestLog.userId ? (userMap.get(latestLog.userId) || "GDO Ignoto") : "Sistema"
        const note = latestLog?.note || ""

        return {
            id: lead.id,
            email: lead.email as string, // guaranteed by isNotNull
            funnel: lead.funnel || "Sconosciuto",
            reason,
            discardDate,
            discardedBy,
            note
        }
    })

    // Sort by most recently discarded first
    return results.sort((a, b) => b.discardDate.getTime() - a.discardDate.getTime())
}
