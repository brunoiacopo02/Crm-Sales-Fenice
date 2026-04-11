"use server"

import { db } from "@/db"
import { leads, leadEvents, users } from "@/db/schema"
import { eq, desc, and } from "drizzle-orm"
import crypto from "crypto"

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
            agendaSentAt: leads.agendaSentAt,
            recallDate: leads.recallDate,
            appointmentDate: leads.appointmentDate,
            appointmentNote: leads.appointmentNote,
            appointmentCreatedAt: leads.appointmentCreatedAt,
            discardReason: leads.discardReason,
            version: leads.version,
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

export async function updateLeadContactInfo(
    leadId: string,
    currentVersion: number,
    data: {
        name: string
        phone: string
        email: string
        lastCallNote: string
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const name = data.name.trim()
        const phone = data.phone.trim()
        const email = data.email.trim()
        const lastCallNote = data.lastCallNote.trim()

        if (!name) return { success: false, error: "Il nome è obbligatorio." }
        if (phone.length < 5) return { success: false, error: "Il telefono deve avere almeno 5 cifre." }

        const updated = await db.update(leads).set({
            name,
            phone,
            email: email || null,
            lastCallNote: lastCallNote || null,
            version: currentVersion + 1,
            updatedAt: new Date(),
        }).where(
            and(eq(leads.id, leadId), eq(leads.version, currentVersion))
        ).returning({ id: leads.id })

        if (updated.length === 0) {
            return { success: false, error: "CONCURRENCY_ERROR" }
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "contact_info_edited",
            metadata: JSON.stringify({ note: "Dati contatto aggiornati dal ContactDrawer" }),
            timestamp: new Date(),
        })

        return { success: true }
    } catch (err: any) {
        if (err?.code === "23505") {
            return { success: false, error: "Questo numero di telefono è già associato a un altro lead." }
        }
        console.error("updateLeadContactInfo error:", err)
        return { success: false, error: "Errore durante il salvataggio." }
    }
}
