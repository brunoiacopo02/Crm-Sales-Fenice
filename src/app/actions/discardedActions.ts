"use server"

import { db } from "@/db"
import { callLogs, leads, users } from "@/db/schema"
import { eq, isNotNull, and, inArray } from "drizzle-orm"

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
    // We only care about leads that are REJECTED and have an email
    const rejectedLeads = await db.select().from(leads).where(
            and(
                eq(leads.status, 'REJECTED'),
                isNotNull(leads.email)
            )
        )

    if (rejectedLeads.length === 0) return []

    const rejectedLeadIds = rejectedLeads.map(l => l.id)

    // Find the latest callLog for each of these leads that resulted in 'DA_SCARTARE'
    const logs = await db.select().from(callLogs).where(
            and(
                eq(callLogs.outcome, 'DA_SCARTARE'),
                inArray(callLogs.leadId, rejectedLeadIds)
            )
        )

    // Map logs to users for the 'discardedBy'
    const allUsers = await db.select().from(users)
    const userMap = new Map(allUsers.map(u => [u.id, u.name || u.email]))

    // Assemble payload
    const results: DiscardedLeadPayload[] = rejectedLeads.map(lead => {
        // Find the most recent discard log for this lead
        const leadLogs = logs.filter(l => l.leadId === lead.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        const latestLog = leadLogs[0]

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
