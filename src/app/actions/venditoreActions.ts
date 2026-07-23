"use server"
import { createClient } from "@/utils/supabase/server"
import { revalidatePath } from "next/cache"

import { db } from "@/db"
import { leads, users, callLogs, notifications, leadEvents, salesAttempts } from "@/db/schema"
import { eq, and, desc, sql, gte, lte, isNotNull, or, isNull, ne, inArray, asc } from "drizzle-orm"
import crypto from "crypto"
import { enqueueMarketingWebhook } from "@/lib/marketing-webhooks/enqueue"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { dayBoundsRome } from "@/lib/dateUtils"
import { EXCLUDED_FUNNEL } from "@/lib/surveys/questions"
import { getSalesSurveyByLead } from "@/app/actions/surveyActions"
import { validateOutcomeTransition, countCycleNonClosed, findLastCycleNonClosed } from "@/lib/venditorePerformance/guard"
import { isConfermeTl } from "@/lib/confermeTl"
// Gamification disabled for VENDITORE role — import removed

async function resolveIsStaff() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role
    const email = user?.user_metadata?.email ?? user?.email
    return role === 'MANAGER' || role === 'ADMIN' || (role === 'CONFERME' && isConfermeTl(email))
}

export async function getVenditoreAppointments(sellerId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = await resolveIsStaff()
    if (!isStaff && sellerId !== ctx.userId) throw new Error('Forbidden')
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
            salesCycleStartAt: leads.salesCycleStartAt,
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
            outcomeAt: salesAttempts.outcomeAt,
        }).from(salesAttempts).where(and(
            eq(salesAttempts.companyId, ctx.companyId),
            eq(salesAttempts.salesUserId, sellerId),
        ))
        : [];

    const byLead = new Map<string, { attemptCount: number; nextFollowUpDate: Date | null; lastAt: number; attempts: { outcome: string; outcomeAt: Date | null }[] }>();
    for (const r of attemptRows) {
        const cur = byLead.get(r.leadId) ?? { attemptCount: 0, nextFollowUpDate: null, lastAt: 0, attempts: [] };
        cur.attemptCount += 1;
        cur.attempts.push({ outcome: r.outcome, outcomeAt: r.outcomeAt });
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
            priorNonClosedCount: countCycleNonClosed(agg?.attempts ?? [], r.salesCycleStartAt ?? null),
            nextFollowUpDate: agg?.nextFollowUpDate ?? null,
        };
    })
}

// Lead con follow-up pendente (fonte di verità: leads.followUp1Date, mirrorata
// da saveVenditoreOutcome/rescheduleFollowUp) + lead parcheggiati "In lavorazione"
// (inLavorazioneAt valorizzato, bucket 'parked'). Righe nella stessa forma di
// getVenditoreAppointments così il VenditoreDrawer si riusa identico.
export async function getVenditoreFollowUps(sellerId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = await resolveIsStaff()
    if (!isStaff && sellerId !== ctx.userId) throw new Error('Forbidden')

    const rows = await db.select({
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
        appointmentNote: leads.appointmentNote,
        version: leads.version,
        closeProduct: leads.closeProduct,
        closeAmountEur: leads.closeAmountEur,
        notClosedReason: leads.notClosedReason,
        negotiationStartedAt: leads.negotiationStartedAt,
        inLavorazioneAt: leads.inLavorazioneAt,
        salesCycleStartAt: leads.salesCycleStartAt,
    })
        .from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, sellerId),
            or(
                isNotNull(leads.inLavorazioneAt),
                and(eq(leads.salespersonOutcome, 'Non chiuso'), isNotNull(leads.followUp1Date)),
                // Ciclo riaperto senza esito ancora registrato: salespersonOutcome è
                // stato azzerato da reopenNegotiation ma è già stata fissata una data
                // di follow-up. Senza questo ramo il lead non matcha nessun altro caso
                // e sparisce da tutte le viste (C1).
                and(isNull(leads.salespersonOutcome), isNotNull(leads.salesCycleStartAt), isNotNull(leads.followUp1Date)),
            ),
        ))

    // attemptCount globale (storia completa) + priorNonClosedCount sul ciclo corrente.
    const leadIds = rows.map(r => r.id)
    const attemptRows = leadIds.length
        ? await db.select({
            leadId: salesAttempts.leadId,
            outcome: salesAttempts.outcome,
            outcomeAt: salesAttempts.outcomeAt,
        }).from(salesAttempts).where(and(
            eq(salesAttempts.companyId, ctx.companyId),
            inArray(salesAttempts.leadId, leadIds),
        ))
        : []

    const attemptsByLead = new Map<string, { outcome: string; outcomeAt: Date | null }[]>()
    for (const r of attemptRows) {
        const list = attemptsByLead.get(r.leadId) ?? []
        list.push({ outcome: r.outcome, outcomeAt: r.outcomeAt })
        attemptsByLead.set(r.leadId, list)
    }

    const now = new Date()
    const { start: todayStart, end: todayEnd } = dayBoundsRome(now)

    return rows
        .map(r => {
            const attempts = attemptsByLead.get(r.id) ?? []
            const parked = !!r.inLavorazioneAt
            const fu = parked ? null : r.followUp1Date
            return {
                ...r,
                phone: r.negotiationStartedAt ? r.phone : null,
                attemptCount: attempts.length,
                priorNonClosedCount: countCycleNonClosed(attempts, r.salesCycleStartAt ?? null),
                nextFollowUpDate: fu,
                parkedDays: parked ? Math.floor((now.getTime() - r.inLavorazioneAt!.getTime()) / 86_400_000) : null,
                bucket: (parked
                    ? 'parked'
                    : (fu! < todayStart ? 'overdue' : (fu! < todayEnd ? 'today' : 'upcoming'))
                ) as 'overdue' | 'today' | 'upcoming' | 'parked',
            }
        })
        .sort((x, y) => {
            if (x.bucket === 'parked' && y.bucket === 'parked') return (y.parkedDays ?? 0) - (x.parkedDays ?? 0)
            if (x.bucket === 'parked') return 1
            if (y.bucket === 'parked') return -1
            return x.nextFollowUpDate!.getTime() - y.nextFollowUpDate!.getTime()
        })
}

// Funzione per registrare l'esito
export async function saveVenditoreOutcome(leadId: string, payload: {
    outcome: string, // "Chiuso" | "Non chiuso" | "Sparito" ("Perso" rimosso 2026-07-08: doppione di Non chiuso)
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
    // Il tetto conta solo il ciclo corrente: dopo una riapertura dallo Storico
    // (salesCycleStartAt) i 3 follow-up ripartono da zero.
    const priorAttempts = await db.select({ outcome: salesAttempts.outcome, outcomeAt: salesAttempts.outcomeAt })
        .from(salesAttempts)
        .where(and(eq(salesAttempts.companyId, ctx.companyId), eq(salesAttempts.leadId, leadId)));
    const attemptNumber = priorAttempts.length;
    const priorNonClosedCount = countCycleNonClosed(priorAttempts, oldLead.salesCycleStartAt ?? null);

    // GUARDIA 3: follow-up obbligatorio dopo "Non chiuso" + tetto a 3 (solo VENDITORE).
    if (!isStaff) {
        const check = validateOutcomeTransition({
            outcome: payload.outcome,
            nextFollowUpDate: payload.nextFollowUpDate ?? null,
            priorNonClosedCount,
        });
        if (!check.ok) return { success: false, error: check.error };
    }

    // GUARDIA 4: motivo obbligatorio su esito Non chiuso.
    if (!isStaff && payload.outcome === 'Non chiuso' && !payload.notClosedReason) {
        return { success: false, error: 'Seleziona una motivazione per un esito Non chiuso.' };
    }

    // Scrittura atomica: update leads + insert salesAttempts + insert leadEvents.
    // Se l'update version-guarded non trova righe (conflitto concorrente), non
    // inseriamo lo storico: la transazione va in rollback ed emerge CONCURRENCY_ERROR.
    let effectiveOutcomeAt = payload.outcomeAt instanceof Date && !isNaN(payload.outcomeAt.getTime()) ? payload.outcomeAt : new Date();
    // Un esito retrodatato di un ciclo riaperto non può precedere la riapertura,
    // altrimenti sfugge al conteggio del tetto del nuovo ciclo (countCycleNonClosed
    // filtra su outcomeAt >= cycleStartAt).
    if (oldLead.salesCycleStartAt && effectiveOutcomeAt < oldLead.salesCycleStartAt) {
        effectiveOutcomeAt = oldLead.salesCycleStartAt;
    }
    const txResult = await db.transaction(async (tx) => {
        const updated = await tx.update(leads)
            .set({
                salespersonOutcome: payload.outcome,
                salespersonOutcomeNotes: payload.notes || null,
                closeProduct: payload.closeProduct || null,
                closeAmountEur: payload.closeAmountEur || null,
                notClosedReason: payload.notClosedReason || null,
                followUp1Date: payload.outcome === 'Non chiuso' ? (payload.nextFollowUpDate || null) : null,
                followUp2Date: null,
                // Qualunque esito toglie il lead da "In lavorazione".
                inLavorazioneAt: null,
                salespersonOutcomeAt: effectiveOutcomeAt,
                // Latch presenza (PO 2026-07-17): prima presenza → giorno dell'appuntamento;
                // mai sovrascritto. "Sparito" a un follow-up NON toglie la presenza.
                presentedAt: oldLead.presentedAt ?? (
                    (payload.outcome === 'Chiuso' || payload.outcome === 'Non chiuso')
                        ? (oldLead.appointmentDate ?? effectiveOutcomeAt)
                        : null
                ),
                version: oldLead.version + 1,
            })
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.id, leadId),
                eq(leads.version, oldLead.version),
            ))
            .returning({ id: leads.id })

        if (updated.length === 0) {
            return { success: false as const, error: 'CONCURRENCY_ERROR' as const }
        }

        // Storia: registra questo tentativo/esito.
        await tx.insert(salesAttempts).values({
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

        // 1. Audit Log per la cronologia completa (Timeline)
        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "salesperson_outcome_set",
            userId: session.user.id,
            timestamp: new Date(),
            metadata: { ...payload, attemptNumber },
            companyId: ctx.companyId,
        })

        return { success: true as const }
    })

    if (!txResult.success) {
        return { success: false, error: txResult.error }
    }

    // Marketing webhook: deal closed (won/lost based on outcome)
    const closedEventType = payload.outcome === 'Chiuso' ? 'deal.closed_won' : 'deal.closed_lost';
    await enqueueMarketingWebhook({
        eventType: closedEventType,
        leadId,
        actorUserId: session.user.id,
    }).catch((e: unknown) => console.error(`Marketing webhook (${closedEventType}) err:`, e));

    // Gamification disabled for VENDITORE role
    const rewardData: any = null;

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

// ── Follow-up lifecycle (spec 2026-07-23) ────────────────────────────────────

// Auth comune alle azioni sul singolo lead: il venditore opera solo sui propri
// lead; MANAGER/ADMIN senza vincolo. Ritorna lead + userId o un errore.
async function requireOwnLead(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role)) {
        return { ok: false as const, error: 'Unauthorized' };
    }
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
    )))[0];
    if (!lead) return { ok: false as const, error: 'Lead non trovato' };
    const isStaff = role === 'MANAGER' || role === 'ADMIN';
    if (!isStaff && lead.salespersonUserId !== supabaseUser.id) {
        return { ok: false as const, error: 'Lead non assegnato' };
    }
    return { ok: true as const, lead, ctx, userId: supabaseUser.id };
}

// Sposta SOLO data/ora del follow-up (il lead ha spostato la chiamata): nessun
// nuovo salesAttempt, il tetto dei 3 follow-up non viene toccato. Serve anche
// da "Fissa follow-up" per i lead In lavorazione e per quelli appena riaperti.
export async function rescheduleFollowUp(leadId: string, newDate: Date): Promise<{ success: boolean; error?: string }> {
    const auth = await requireOwnLead(leadId);
    if (!auth.ok) return { success: false, error: auth.error };
    const { lead, ctx, userId } = auth;

    if (!(newDate instanceof Date) || isNaN(newDate.getTime())) {
        return { success: false, error: 'Data follow-up non valida.' };
    }
    if (!lead.followUp1Date && !lead.inLavorazioneAt) {
        return { success: false, error: 'Nessun follow-up pendente da spostare per questo lead.' };
    }

    const txResult = await db.transaction(async (tx) => {
        // Ultimo attempt 'Non chiuso' del ciclo corrente: teniamo coerente anche la
        // storia (nextFollowUpDate) usata da analytics e Monitor Vendite. Scelta
        // deterministica per attemptNumber massimo (findLastCycleNonClosed), stesso
        // criterio del Monitor Vendite, anche con outcomeAt retrodatati o null.
        const attempts = await tx.select({
            id: salesAttempts.id,
            outcome: salesAttempts.outcome,
            outcomeAt: salesAttempts.outcomeAt,
            attemptNumber: salesAttempts.attemptNumber,
        }).from(salesAttempts)
            .where(and(eq(salesAttempts.companyId, ctx.companyId), eq(salesAttempts.leadId, leadId)));
        const cycleStart = lead.salesCycleStartAt ?? null;
        const lastNonClosed = findLastCycleNonClosed(attempts, cycleStart);

        const updated = await tx.update(leads)
            .set({ followUp1Date: newDate, inLavorazioneAt: null, version: lead.version + 1 })
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.id, leadId),
                eq(leads.version, lead.version),
            ))
            .returning({ id: leads.id });

        if (updated.length === 0) {
            return { success: false as const, error: 'Il lead è stato modificato da un altro utente: ricarica la pagina e riprova.' as const };
        }

        if (lastNonClosed) {
            await tx.update(salesAttempts)
                .set({ nextFollowUpDate: newDate })
                .where(eq(salesAttempts.id, lastNonClosed.id));
        }
        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'followup_rescheduled',
            userId,
            timestamp: new Date(),
            metadata: { oldDate: lead.followUp1Date, newDate },
            companyId: ctx.companyId,
        });

        return { success: true as const };
    });

    if (!txResult.success) {
        return { success: false, error: txResult.error };
    }

    revalidatePath('/venditore');
    return { success: true };
}

// Parcheggia un lead con follow-up pendente in "In lavorazione" (niente data
// precisa). Non consuma tentativi e non registra esiti.
export async function parkLead(leadId: string): Promise<{ success: boolean; error?: string }> {
    const auth = await requireOwnLead(leadId);
    if (!auth.ok) return { success: false, error: auth.error };
    const { lead, ctx, userId } = auth;

    if (lead.inLavorazioneAt) return { success: false, error: 'Lead già in lavorazione.' };
    if (!lead.followUp1Date) {
        return { success: false, error: 'Solo un lead con follow-up pendente può andare in lavorazione.' };
    }

    const txResult = await db.transaction(async (tx) => {
        const updated = await tx.update(leads)
            .set({ inLavorazioneAt: new Date(), version: lead.version + 1 })
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.id, leadId),
                eq(leads.version, lead.version),
            ))
            .returning({ id: leads.id });

        if (updated.length === 0) {
            return { success: false as const, error: 'Il lead è stato modificato da un altro utente: ricarica la pagina e riprova.' as const };
        }

        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'lead_parked',
            userId,
            timestamp: new Date(),
            metadata: { previousFollowUpDate: lead.followUp1Date },
            companyId: ctx.companyId,
        });

        return { success: true as const };
    });

    if (!txResult.success) {
        return { success: false, error: txResult.error };
    }

    revalidatePath('/venditore');
    return { success: true };
}

// Riapre una trattativa non-Chiusa dallo Storico: nuovo ciclo, tetto 3 pieno.
// La storia salesAttempts resta intatta; il lead torna in "In lavorazione".
// Il check-in trattativa NON va rifatto (negotiationStartedAt resta).
export async function reopenNegotiation(leadId: string): Promise<{ success: boolean; error?: string }> {
    const auth = await requireOwnLead(leadId);
    if (!auth.ok) return { success: false, error: auth.error };
    const { lead, ctx, userId } = auth;

    if (!lead.salespersonOutcome) return { success: false, error: 'La trattativa è già aperta.' };
    if (lead.salespersonOutcome === 'Chiuso') {
        return { success: false, error: 'Un lead Chiuso non è riapribile.' };
    }

    const now = new Date();
    const txResult = await db.transaction(async (tx) => {
        const updated = await tx.update(leads)
            .set({
                salesCycleStartAt: now,
                inLavorazioneAt: now,
                salespersonOutcome: null,
                salespersonOutcomeNotes: null,
                notClosedReason: null,
                followUp1Date: null,
                followUp2Date: null,
                version: lead.version + 1,
            })
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.id, leadId),
                eq(leads.version, lead.version),
            ))
            .returning({ id: leads.id });

        if (updated.length === 0) {
            return { success: false as const, error: 'Il lead è stato modificato da un altro utente: ricarica la pagina e riprova.' as const };
        }

        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'negotiation_reopened',
            userId,
            timestamp: now,
            metadata: { previousOutcome: lead.salespersonOutcome, previousNotClosedReason: lead.notClosedReason },
            companyId: ctx.companyId,
        });

        return { success: true as const };
    });

    if (!txResult.success) {
        return { success: false, error: txResult.error };
    }

    revalidatePath('/venditore');
    return { success: true };
}

// Storico trattative: lead del venditore con esito finale, usciti dalle viste
// operative (niente follow-up pendente, non in lavorazione). Include la storia
// completa dei tentativi per il dettaglio espandibile.
export async function getVenditoreStorico(sellerId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = await resolveIsStaff()
    if (!isStaff && sellerId !== ctx.userId) throw new Error('Forbidden')

    const rows = await db.select({
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
            isNotNull(leads.salespersonOutcome),
            isNull(leads.inLavorazioneAt),
            // 'Non chiuso' CON follow-up pendente sta nella tab Follow-up, non qui.
            or(ne(leads.salespersonOutcome, 'Non chiuso'), isNull(leads.followUp1Date)),
        ))
        .orderBy(desc(leads.salespersonOutcomeAt))

    const leadIds = rows.map(r => r.id)
    const attemptRows = leadIds.length
        ? await db.select({
            id: salesAttempts.id,
            leadId: salesAttempts.leadId,
            attemptNumber: salesAttempts.attemptNumber,
            outcome: salesAttempts.outcome,
            notClosedReason: salesAttempts.notClosedReason,
            closeProduct: salesAttempts.closeProduct,
            closeAmountEur: salesAttempts.closeAmountEur,
            outcomeAt: salesAttempts.outcomeAt,
            nextFollowUpDate: salesAttempts.nextFollowUpDate,
        }).from(salesAttempts)
            .where(and(
                eq(salesAttempts.companyId, ctx.companyId),
                inArray(salesAttempts.leadId, leadIds),
            ))
            .orderBy(asc(salesAttempts.attemptNumber))
        : []

    const byLead = new Map<string, typeof attemptRows>()
    for (const a of attemptRows) {
        const list = byLead.get(a.leadId) ?? []
        list.push(a)
        byLead.set(a.leadId, list)
    }

    return rows.map(r => ({
        ...r,
        phone: r.negotiationStartedAt ? r.phone : null,
        attempts: byLead.get(r.id) ?? [],
    }))
}
