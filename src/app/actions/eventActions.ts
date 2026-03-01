"use server"

import { db } from "@/db"
import { leads, leadEvents, users } from "@/db/schema"
import { eq, desc } from "drizzle-orm"

export async function getLeadProfile(leadId: string) {
    const lead = (await db.select({
            id: leads.id,
            name: leads.name,
            email: leads.email,
            phone: leads.phone,
            funnel: leads.funnel,
            status: leads.status,
            callCount: leads.callCount,
            assignedToId: leads.assignedToId,
            assignedToName: users.name,
            lastCallDate: leads.lastCallDate,
            lastCallNote: leads.lastCallNote,
            recallDate: leads.recallDate,
            appointmentDate: leads.appointmentDate,
            appointmentNote: leads.appointmentNote,
            appointmentCreatedAt: leads.appointmentCreatedAt,
            discardReason: leads.discardReason,
            createdAt: leads.createdAt,
            updatedAt: leads.updatedAt,
        })
            .from(leads)
            .leftJoin(users, eq(leads.assignedToId, users.id))
            .where(eq(leads.id, leadId)))
        [0]

    if (!lead) return null

    const events = await db.select({
            id: leadEvents.id,
            eventType: leadEvents.eventType,
            userId: leadEvents.userId,
            userName: users.name,
            fromSection: leadEvents.fromSection,
            toSection: leadEvents.toSection,
            metadata: leadEvents.metadata,
            timestamp: leadEvents.timestamp,
        })
            .from(leadEvents)
            .leftJoin(users, eq(leadEvents.userId, users.id))
            .where(eq(leadEvents.leadId, leadId))
            .orderBy(desc(leadEvents.timestamp))
        

    return {
        lead,
        events: events.map(e => ({
            ...e,
            metadata: e.metadata || null
        }))
    }
}
