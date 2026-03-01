"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, users, confirmationsNotes, leadEvents, notifications } from "@/db/schema"
import { eq, asc, desc, and, or, like, between, isNull } from "drizzle-orm"
import crypto from "crypto"
import { createGoogleCalendarEvent } from "@/lib/googleCalendar"
import { addHours } from "date-fns"

export async function getConfermeAppointments(filters: {
    startDate?: Date;
    endDate?: Date;
    timeSlot?: "mattina" | "pomeriggio" | "tutto";
    searchQuery?: string;
    confermeStatus?: "da_lavorare" | "confermati" | "scartati" | "tutti";
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const conditions = [
        eq(leads.status, 'APPOINTMENT')
    ]

    if (filters.searchQuery) {
        const q = `%${filters.searchQuery}%`
        conditions.push(
            or(
                like(leads.name, q),
                like(leads.email, q),
                like(leads.phone, q)
            )!
        )
    }

    if (filters.confermeStatus) {
        if (filters.confermeStatus === "da_lavorare") {
            conditions.push(isNull(leads.confirmationsOutcome))
        } else if (filters.confermeStatus === "confermati") {
            conditions.push(eq(leads.confirmationsOutcome, "confermato"))
        } else if (filters.confermeStatus === "scartati") {
            conditions.push(eq(leads.confirmationsOutcome, "scartato"))
        }
    } else {
        // default "da_lavorare" se non passano status
        conditions.push(isNull(leads.confirmationsOutcome))
    }

    if (filters.startDate && filters.endDate) {
        conditions.push(between(leads.appointmentDate, filters.startDate, filters.endDate))
    }

    const query = await db.select({
            lead: leads,
            gdo: users,
        }).from(leads)
            .leftJoin(users, eq(leads.assignedToId, users.id))
            .where(and(...conditions))
            .orderBy(asc(leads.appointmentDate))

    let results = await query;

    // Filter time slot in JS to handle timezone easily
    if (filters.timeSlot && filters.timeSlot !== "tutto") {
        results = results.filter(row => {
            if (!row.lead.appointmentDate) return false;
            if (row.lead.appointmentDate) {
                // Get hour in Europe/Rome
                const d = new Date(row.lead.appointmentDate);
                const hourStr = new Intl.DateTimeFormat('it-IT', {
                    hour: 'numeric',
                    timeZone: 'Europe/Rome',
                    hour12: false
                }).format(d);
                const hour = parseInt(hourStr, 10);

                if (filters.timeSlot === "mattina") {
                    return hour >= 8 && hour < 15;
                } else if (filters.timeSlot === "pomeriggio") {
                    return hour >= 15 && hour <= 23;
                }
            }
            return true;
        })
    }

    return results;
}

export async function updateLeadDataConferme(leadId: string, currentVersion: number, data: { name: string, email: string, appointmentDate: Date, appointmentNote: string }) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    // fetch old
    const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
    if (!oldLead) throw new Error("Lead not found")

    // Concurrency Check
    if (oldLead.version !== currentVersion) {
        throw new Error("CONCURRENCY_ERROR")
    }

    await db.update(leads).set({
        name: data.name,
        email: data.email,
        appointmentDate: data.appointmentDate,
        appointmentNote: data.appointmentNote,
        version: oldLead.version + 1,
        updatedAt: new Date()
    }).where(eq(leads.id, leadId))

    // Audit Log
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "conferme_edited_lead",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: {
            old: { name: oldLead.name, email: oldLead.email, appointmentDate: oldLead.appointmentDate, appointmentNote: oldLead.appointmentNote },
            new: data
        }
    })

    return { success: true }
}

export async function getConfermeNotes(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    return await db.select({
            note: confirmationsNotes,
            author: users
        }).from(confirmationsNotes)
            .leftJoin(users, eq(confirmationsNotes.authorId, users.id))
            .where(eq(confirmationsNotes.leadId, leadId))
            .orderBy(desc(confirmationsNotes.createdAt))
        
}

export async function addConfermeNote(leadId: string, text: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized")
    }

    const newNote = {
        id: crypto.randomUUID(),
        leadId,
        authorId: session.user.id,
        text,
        createdAt: new Date()
    }

    await db.insert(confirmationsNotes).values(newNote)
    return newNote
}

async function getSalespersonName(userId?: string) {
    if (!userId) return null;
    const user = (await db.select().from(users).where(eq(users.id, userId)))[0];
    return user ? (user.displayName || user.name || userId) : userId;
}

export async function setConfermeOutcome(leadId: string, currentVersion: number, outcome: "scartato" | "confermato", reason?: string, salespersonAssigned?: string) {
    try {
        const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" }
        }

        const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
        if (!oldLead) return { success: false, error: "Lead not found" }
        if (oldLead.version !== currentVersion) {
            console.error(`@@@ VERSION MISMATCH @@@ DB version: ${oldLead.version}, Client version: ${currentVersion}`);
            return { success: false, error: `CONCURRENCY_ERROR: DB è alla versione ${oldLead.version} ma il client ha inviato la versione ${currentVersion}` }
        }

        await db.update(leads).set({
            confirmationsOutcome: outcome,
            confirmationsDiscardReason: reason || null,
            confirmationsUserId: session.user.id,
            confirmationsTimestamp: new Date(),
            salespersonAssigned: await getSalespersonName(salespersonAssigned) || salespersonAssigned || null,
            salespersonUserId: salespersonAssigned || null,
            salespersonAssignedAt: salespersonAssigned ? new Date() : null,
            version: oldLead.version + 1,
            updatedAt: new Date()
        }).where(eq(leads.id, leadId))

        // Handle Calendar Event Creation
        if (outcome === "confermato" && salespersonAssigned && oldLead.appointmentDate) {
            const apptDate = new Date(oldLead.appointmentDate);
            // Appuntamento durerà di default 1 ora
            await createGoogleCalendarEvent(
                salespersonAssigned,
                {
                    summary: `Appuntamento CRM: ${oldLead.name}`,
                    description: `Lead: ${oldLead.name}\nTelefono: ${oldLead.phone}\nEmail: ${oldLead.email || 'N/A'}\nFunnel: ${oldLead.funnel || 'N/A'}\n\nLink CRM: http://localhost:3000/venditore`,
                    startTime: apptDate,
                    endTime: addHours(apptDate, 1)
                },
                leadId,
                "appointment"
            ).then(res => console.log("Google Event Result:", res)).catch(err => {
                console.error("Could not create calendar event:", err.message)
                if (err.response) console.error("Google Auth Response:", err.response.data);
            })
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_outcome_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { outcome, reason, salespersonAssigned }
        })

        // Notifica Live per GDO Target (Pilota E2E)
        if (outcome === "confermato" && salespersonAssigned && oldLead.assignedToId) {
            const spName = await getSalespersonName(salespersonAssigned) || salespersonAssigned
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: oldLead.assignedToId,
                type: 'appointment_confirmed',
                title: 'Appuntamento Confermato! 🎉',
                body: `Ottimo lavoro! Il tuo appuntamento per ${oldLead.name} è stato confermato e assegnato a ${spName}.`,
                metadata: { leadId },
                status: 'unread',
                createdAt: new Date()
            })
        }

        return { success: true }
    } catch (error: any) {
        console.error("@@@ CRITICAL ERROR IN setConfermeOutcome @@@", error);
        return { success: false, error: `INTERNAL_ERROR: ${error.message}` };
    }
}

export async function setSalespersonOutcome(leadId: string, currentVersion: number, outcome: "Chiuso" | "Non chiuso" | "Lead non presenziato", notes?: string) {
    try {
        const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
            return { success: false, error: "Unauthorized" }
        }

        const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
        if (!oldLead) return { success: false, error: "Lead not found" }
        if (oldLead.version !== currentVersion) return { success: false, error: `CONCURRENCY_ERROR` }

        await db.update(leads).set({
            salespersonOutcome: outcome,
            salespersonOutcomeNotes: notes || null,
            salespersonOutcomeAt: new Date(),
            version: oldLead.version + 1,
            updatedAt: new Date()
        }).where(eq(leads.id, leadId))

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "salesperson_outcome_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { outcome, notes }
        })

        return { success: true }
    } catch (error: any) {
        console.error("@@@ ERR IN setSalespersonOutcome @@@", error);
        return { success: false, error: error.message };
    }
}
