"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, leadEvents } from "@/db/schema"
import { eq, asc, desc, and } from "drizzle-orm"
import crypto from "crypto"
export async function getAppointments() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    const conditions = [
        eq(leads.status, 'APPOINTMENT')
    ]
    if (isGdo) conditions.push(eq(leads.assignedToId, userId))

    // Fetch only leads with status = APPOINTMENT
    const allAppointments = await db.select()
            .from(leads)
            .where(and(...conditions))
            .orderBy(desc(leads.appointmentCreatedAt)) // default order by newest booked
        

    const now = new Date()

    // We can split them into Upcoming and Past
    const upcoming = allAppointments.filter(l => l.appointmentDate && l.appointmentDate >= now)
    const past = allAppointments.filter(l => l.appointmentDate && l.appointmentDate < now)

    // Sort upcoming by appointmentDate ascending (closest first)
    upcoming.sort((a, b) => {
        if (!a.appointmentDate || !b.appointmentDate) return 0
        return a.appointmentDate.getTime() - b.appointmentDate.getTime()
    })

    // Sort past by appointmentDate descending (most recent first)
    past.sort((a, b) => {
        if (!a.appointmentDate || !b.appointmentDate) return 0
        return b.appointmentDate.getTime() - a.appointmentDate.getTime()
    })

    return { upcoming, past }
}

export async function updateGdoAppointment(leadId: string, appointmentDate: Date, note: string, currentVersion?: number) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    if (!supabaseUser || supabaseUser.user_metadata?.role !== 'GDO') throw new Error("Unauthorized");

    // Fetch the lead first to make sure it's theirs
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.assignedToId, supabaseUser.id)));
    if (!lead) throw new Error("Lead not found or unassigned");

    // Optimistic locking check
    if (currentVersion !== undefined && lead.version !== currentVersion) {
        return { success: false, error: 'CONCURRENCY_ERROR' };
    }

    // Assicurarsi che appointmentDate sia un oggetto Date valido se Next lo passasse come stringa in JSON
    const dateObj = new Date(appointmentDate);

    const updated = await db.update(leads).set({
        appointmentDate: dateObj,
        appointmentNote: note,
        version: lead.version + 1,
        updatedAt: new Date(),
    }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version)))
    .returning({ id: leads.id });

    if (updated.length === 0) {
        return { success: false, error: 'CONCURRENCY_ERROR' };
    }

    return { success: true };
}

/**
 * Cancella SOLO l'appuntamento di un lead (azione admin/manager).
 * Reset di tutti i campi appointment-related ma il lead resta nel CRM
 * con stato IN_PROGRESS — il GDO può eventualmente richiamarlo.
 * NON cancella il lead, NON tocca chiamate / esiti precedenti.
 */
export async function cancelLeadAppointment(leadId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const role = user?.user_metadata?.role as string | undefined;
        if (!user || !role || !["ADMIN", "MANAGER"].includes(role)) {
            return { success: false, error: "Unauthorized — solo admin/manager possono cancellare appuntamenti" };
        }

        const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
        if (!lead) return { success: false, error: "Lead non trovato" };

        const previousState = {
            appointmentDate: lead.appointmentDate,
            appointmentNote: lead.appointmentNote,
            appointmentCreatedAt: lead.appointmentCreatedAt,
            salespersonAssigned: lead.salespersonAssigned,
            salespersonUserId: lead.salespersonUserId,
            confirmationsOutcome: lead.confirmationsOutcome,
            confirmationsDiscardReason: lead.confirmationsDiscardReason,
        };

        await db.update(leads).set({
            appointmentDate: null,
            appointmentNote: null,
            appointmentCreatedAt: null,
            salespersonAssigned: null,
            salespersonUserId: null,
            salespersonAssignedAt: null,
            // Reset esiti conferme/vendita perché senza appuntamento non hanno senso
            confirmationsOutcome: null,
            confirmationsDiscardReason: null,
            confirmationsUserId: null,
            confirmationsTimestamp: null,
            salespersonOutcome: null,
            salespersonOutcomeNotes: null,
            salespersonOutcomeAt: null,
            // Rimette il lead in pipeline come "in lavorazione" (callCount preservato)
            status: lead.callCount > 0 ? 'IN_PROGRESS' : 'NEW',
            version: lead.version + 1,
            updatedAt: new Date(),
        }).where(eq(leads.id, leadId));

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'appointment_cancelled_admin',
            userId: user.id,
            timestamp: new Date(),
            metadata: { previousState, cancelledBy: role },
        });

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
    }
}

/**
 * Cancella DEFINITIVAMENTE un lead (azione admin only). Cascade su
 * leadEvents, callLogs, confirmationsNotes, calendarEvents, ecc tramite
 * FK ON DELETE CASCADE. Rischio: irreversibile. Da usare solo per
 * pulire test/duplicati.
 */
export async function deleteLeadCompletely(leadId: string): Promise<{ success: boolean; error?: string; deletedName?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const role = user?.user_metadata?.role as string | undefined;
        if (!user || role !== "ADMIN") {
            return { success: false, error: "Unauthorized — solo admin può cancellare lead" };
        }

        const [lead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, leadId));
        if (!lead) return { success: false, error: "Lead non trovato" };

        await db.delete(leads).where(eq(leads.id, leadId));
        return { success: true, deletedName: lead.name ?? undefined };
    } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
    }
}
