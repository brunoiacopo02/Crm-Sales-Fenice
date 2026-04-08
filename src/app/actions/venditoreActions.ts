"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, users, callLogs, notifications, leadEvents } from "@/db/schema"
import { eq, and, desc, sql, gte, lte } from "drizzle-orm"
import crypto from "crypto"
import { awardXpAndCoins } from "@/lib/gamificationEngine"

export async function getVenditoreAppointments(sellerId: string) {
    // Ritorna i lead assegnati a questo venditore che hanno un appuntamento
    const assignedLeads = await db
        .select({
            id: leads.id,
            name: leads.name,
            email: leads.email,
            phone: leads.phone,
            funnel: leads.funnel,
            appointmentDate: leads.appointmentDate,
            appointmentCreatedAt: leads.appointmentCreatedAt,
            salespersonOutcome: leads.salespersonOutcome,
            salespersonOutcomeAt: leads.salespersonOutcomeAt,
            salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
            followUp1Date: leads.followUp1Date,
            followUp2Date: leads.followUp2Date,
            gdoUserId: leads.assignedToId,
            gdoName: users.displayName,
            gdoCode: users.gdoCode,
            // Recuperiamo l'ultima nota dal GDO o Conferme (approssimata con subquery se fosse SQL, qui usiamo query extra o un campo)
            appointmentNote: leads.appointmentNote,
            // We'll also return other fields needed
        })
        .from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(
            eq(leads.salespersonUserId, sellerId)
        )
        .orderBy(desc(leads.appointmentDate))
        

    return assignedLeads
}

// Funzione per registrare l'esito
export async function saveVenditoreOutcome(leadId: string, payload: {
    outcome: string, // "Chiuso" | "Non chiuso" | "Sparito"
    notes?: string,
    closeProduct?: string,
    closeAmountEur?: number,
    notClosedReason?: string,
    followUp1Date?: Date | null,
    followUp2Date?: Date | null
}, currentVersion?: number) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || session.user.role !== 'VENDITORE') {
        throw new Error("Unauthorized")
    }

    const oldLead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
    if (!oldLead) throw new Error("Lead non trovato")

    // Optimistic locking check
    if (currentVersion !== undefined && oldLead.version !== currentVersion) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    const updated = await db.update(leads)
        .set({
            salespersonOutcome: payload.outcome,
            salespersonOutcomeNotes: payload.notes || null,
            closeProduct: payload.closeProduct || null,
            closeAmountEur: payload.closeAmountEur || null,
            notClosedReason: payload.notClosedReason || null,
            followUp1Date: payload.followUp1Date || null,
            followUp2Date: payload.followUp2Date || null,
            salespersonOutcomeAt: new Date(),
            version: oldLead.version + 1,
        })
        .where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version)))
        .returning({ id: leads.id })

    if (updated.length === 0) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }
        

    // Gamification: award XP/coins to Venditore on deal close (first outcome only)
    let rewardData = null;
    if (!oldLead.salespersonOutcome && payload.outcome === 'Chiuso') {
        rewardData = await awardXpAndCoins(session.user.id, "DEAL_CHIUSO", leadId).catch(e => { console.error("GameEngine DEAL_CHIUSO err:", e); return null; });
    }

    // 1. Audit Log per la cronologia completa (Timeline)
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "salesperson_outcome_set",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: payload
    })

    // 2. Propagazione Notifiche Live a GDO e Conferme
    const isClosed = payload.outcome === "Chiuso"
    const notifyTitle = isClosed ? 'Vendita Chiusa! 🚀' : 'Esito Vendita Aggiornato'
    const notifyBody = isClosed
        ? `L'appuntamento con ${oldLead.name} si è concluso con successo! (Prodotto: ${payload.closeProduct || 'N/D'})`
        : `Il venditore ha registrato l'esito "${payload.outcome}" per il lead ${oldLead.name}.`

    const targets = new Set<string>()
    if (oldLead.assignedToId) targets.add(oldLead.assignedToId)
    if (oldLead.confirmationsUserId) targets.add(oldLead.confirmationsUserId)

    for (const userId of targets) {
        await db.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: userId,
            type: 'sales_outcome_set',
            title: notifyTitle,
            body: notifyBody,
            metadata: { leadId },
            status: 'unread',
            createdAt: new Date()
        })
    }

    return { success: true, rewardData }
}
