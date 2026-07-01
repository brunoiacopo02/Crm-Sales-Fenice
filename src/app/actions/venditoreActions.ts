"use server"
import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { leads, users, callLogs, notifications, leadEvents, salesAttempts } from "@/db/schema"
import { eq, and, desc, sql, gte, lte } from "drizzle-orm"
import crypto from "crypto"
import { enqueueMarketingWebhook } from "@/lib/marketing-webhooks/enqueue"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { EXCLUDED_FUNNEL } from "@/lib/surveys/questions"
import { getSalesSurveyByLead } from "@/app/actions/surveyActions"
import { validateOutcomeTransition } from "@/lib/venditorePerformance/guard"
// Gamification disabled for VENDITORE role — import removed

export async function getVenditoreAppointments(sellerId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
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
            version: leads.version,
            closeProduct: leads.closeProduct,
            closeAmountEur: leads.closeAmountEur,
            notClosedReason: leads.notClosedReason,
            negotiationStartedAt: leads.negotiationStartedAt,
        })
        .from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, sellerId),
        ))
        .orderBy(desc(leads.appointmentDate))

    // Conteggi tentativi per lead (per tetto follow-up e ciclo).
    const leadIds = assignedLeads.map(l => l.id);
    const attemptRows = leadIds.length
        ? await db.select({
            leadId: salesAttempts.leadId,
            outcome: salesAttempts.outcome,
            nextFollowUpDate: salesAttempts.nextFollowUpDate,
            createdAt: salesAttempts.createdAt,
        }).from(salesAttempts).where(and(
            eq(salesAttempts.companyId, ctx.companyId),
            eq(salesAttempts.salesUserId, sellerId),
        ))
        : [];

    const byLead = new Map<string, { attemptCount: number; priorNonClosedCount: number; nextFollowUpDate: Date | null; lastAt: number }>();
    for (const r of attemptRows) {
        const cur = byLead.get(r.leadId) ?? { attemptCount: 0, priorNonClosedCount: 0, nextFollowUpDate: null, lastAt: 0 };
        cur.attemptCount += 1;
        if (r.outcome === 'Non chiuso') cur.priorNonClosedCount += 1;
        const ts = r.createdAt ? new Date(r.createdAt).getTime() : 0;
        if (ts >= cur.lastAt) { cur.lastAt = ts; cur.nextFollowUpDate = r.outcome === 'Non chiuso' ? r.nextFollowUpDate : null; }
        byLead.set(r.leadId, cur);
    }

    // Phone must NOT reach the client before the venditore checks in via
    // "Inizia trattativa".  We null it here for unchecked-in leads so it
    // never travels over the wire; startNegotiation() returns the real phone
    // once the check-in is recorded, and the client consumers already use
    // `result.phone` from that action.
    return assignedLeads.map(r => {
        const agg = byLead.get(r.id);
        return {
            ...r,
            phone: r.negotiationStartedAt ? r.phone : null,
            attemptCount: agg?.attemptCount ?? 0,
            priorNonClosedCount: agg?.priorNonClosedCount ?? 0,
            nextFollowUpDate: agg?.nextFollowUpDate ?? null,
        };
    })
}

// Funzione per registrare l'esito
export async function saveVenditoreOutcome(leadId: string, payload: {
    outcome: string, // "Chiuso" | "Non chiuso" | "Perso" | "Sparito"
    notes?: string,
    closeProduct?: string,
    closeAmountEur?: number,
    // Data effettiva di chiusura. Se passata, sovrascrive il default "now()".
    // Serve quando il venditore registra l'esito in un giorno diverso dalla
    // firma effettiva (es. firma sabato, registrazione lunedì): senza questo
    // campo i KPI settimanali (chiusure/fatturato) finirebbero nella settimana
    // sbagliata.
    outcomeAt?: Date,
    notClosedReason?: string,
    followUp1Date?: Date | null,
    followUp2Date?: Date | null,
    nextFollowUpDate?: Date | null
}, currentVersion?: number) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(session.user.role)) {
        throw new Error("Unauthorized")
    }

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const oldLead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
    )))[0]
    if (!oldLead) throw new Error("Lead non trovato")

    // Optimistic locking check
    if (currentVersion !== undefined && oldLead.version !== currentVersion) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    // MANAGER/ADMIN sono esentati da ogni blocco (operano senza limiti).
    const isStaff = session.user.role === 'MANAGER' || session.user.role === 'ADMIN';

    // GUARDIA 1: niente esito senza check-in "Inizia trattativa".
    if (!isStaff && !oldLead.negotiationStartedAt) {
        return { success: false, error: "Avvia la trattativa (Inizia trattativa) prima di registrare l'esito." };
    }

    // GUARDIA 2: sondaggio obbligatorio su Chiuso/Non chiuso (funnel ≠ database).
    // Normalize to lowercase to match AC webhooks that may store funnel uppercased
    // (e.g. 'DATABASE' vs 'database') — mirrors the client-side check in VenditoreDrawer.
    const needsSurvey = !isStaff
        && (payload.outcome === 'Chiuso' || payload.outcome === 'Non chiuso')
        && (oldLead.funnel || '').trim().toLowerCase() !== EXCLUDED_FUNNEL;
    if (needsSurvey) {
        const survey = await getSalesSurveyByLead(leadId);
        if (!survey || survey.suspicious) {
            return { success: false, error: "Compila il sondaggio lead (3 blocchi) prima di salvare l'esito." };
        }
    }

    // Conteggio tentativi pregressi sul lead (per attemptNumber e tetto follow-up).
    const priorAttempts = await db.select({ outcome: salesAttempts.outcome })
        .from(salesAttempts)
        .where(and(eq(salesAttempts.companyId, ctx.companyId), eq(salesAttempts.leadId, leadId)));
    const attemptNumber = priorAttempts.length;
    const priorNonClosedCount = priorAttempts.filter(a => a.outcome === 'Non chiuso').length;

    // GUARDIA 3: follow-up obbligatorio dopo "Non chiuso" + tetto a 3 (solo VENDITORE).
    if (!isStaff) {
        const check = validateOutcomeTransition({
            outcome: payload.outcome,
            nextFollowUpDate: payload.nextFollowUpDate ?? null,
            priorNonClosedCount,
        });
        if (!check.ok) return { success: false, error: check.error };
    }

    const updated = await db.update(leads)
        .set({
            salespersonOutcome: payload.outcome,
            salespersonOutcomeNotes: payload.notes || null,
            closeProduct: payload.closeProduct || null,
            closeAmountEur: payload.closeAmountEur || null,
            notClosedReason: payload.notClosedReason || null,
            followUp1Date: payload.outcome === 'Non chiuso' ? (payload.nextFollowUpDate || null) : null,
            followUp2Date: null,
            salespersonOutcomeAt: payload.outcomeAt instanceof Date && !isNaN(payload.outcomeAt.getTime()) ? payload.outcomeAt : new Date(),
            version: oldLead.version + 1,
        })
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, oldLead.version),
        ))
        .returning({ id: leads.id })

    if (updated.length === 0) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    // Storia: registra questo tentativo/esito.
    const effectiveOutcomeAt = payload.outcomeAt instanceof Date && !isNaN(payload.outcomeAt.getTime()) ? payload.outcomeAt : new Date();
    await db.insert(salesAttempts).values({
        id: crypto.randomUUID(),
        leadId,
        salesUserId: oldLead.salespersonUserId ?? session.user.id,
        attemptNumber,
        outcome: payload.outcome,
        notClosedReason: payload.notClosedReason || null,
        nextFollowUpDate: payload.outcome === 'Non chiuso' ? (payload.nextFollowUpDate || null) : null,
        closeProduct: payload.closeProduct || null,
        closeAmountEur: payload.closeAmountEur || null,
        outcomeAt: effectiveOutcomeAt,
        companyId: ctx.companyId,
    });

    // Marketing webhook: deal closed (won/lost based on outcome)
    const closedEventType = payload.outcome === 'Chiuso' ? 'deal.closed_won' : 'deal.closed_lost';
    await enqueueMarketingWebhook({
        eventType: closedEventType,
        leadId,
        actorUserId: session.user.id,
    }).catch((e: unknown) => console.error(`Marketing webhook (${closedEventType}) err:`, e));

    // Gamification disabled for VENDITORE role
    const rewardData: any = null;

    // 1. Audit Log per la cronologia completa (Timeline)
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "salesperson_outcome_set",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: { ...payload, attemptNumber },
        companyId: ctx.companyId,
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
            createdAt: new Date(),
            companyId: ctx.companyId,
        })
    }

    // Esito venditore (chiusura/non-chiusura/sparito) impatta tutti i KPI:
    // /kpi-venditori, /kpi-conferme, /manager-targets, /panoramica-generale.
    revalidatePath('/', 'layout')

    return { success: true, rewardData }
}

export async function startNegotiation(leadId: string): Promise<{ success: boolean; error?: string; phone?: string }> {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role)) {
        return { success: false, error: "Unauthorized" };
    }
    const ctx = await currentTenant();
    assertSalesArea(ctx);

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
        eq(leads.salespersonUserId, supabaseUser.id),
    )))[0];
    if (!lead) return { success: false, error: "Lead non assegnato" };

    if (!lead.negotiationStartedAt) {
        await db.update(leads).set({ negotiationStartedAt: new Date() })
            .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId)));
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "negotiation_started",
            userId: supabaseUser.id,
            timestamp: new Date(),
            metadata: null,
            companyId: ctx.companyId,
        });
    }
    revalidatePath('/venditore');
    return { success: true, phone: lead.phone };
}

export async function getLeadBriefing(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role)) {
        return null;
    }
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const lead = (await db.select({ botReport: leads.botReport }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId), eq(leads.id, leadId),
    )))[0];
    const { getConfermeSurveyByLead } = await import("@/app/actions/surveyActions");
    const scheda = await getConfermeSurveyByLead(leadId);
    const { normalizeBriefing } = await import("@/lib/briefing/normalize");
    return normalizeBriefing(scheda as any, lead?.botReport);
}
