"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, callLogs } from "@/db/schema"
import { eq, and, ne, isNull, isNotNull, lt, or, lte, desc, gte } from "drizzle-orm"
import crypto from "crypto"
import { determineLeadSection } from "@/lib/eventLogger"
import { subDays } from "date-fns"
import { evaluateTeamGoals } from "@/app/actions/teamGoalActions"
import { awardXpAndCoins } from "@/lib/gamificationEngine"
import { triggerLootDrop } from "@/app/actions/lootDropActions"
import { contributeToBoss } from "@/app/actions/bossBattleActions"
import { incrementChestProgress } from "@/app/actions/chestActions"
import { attackBoss, checkAndAdvanceStage } from "@/app/actions/adventureActions"
import { maybeDropCreature } from "@/app/actions/creatureActions"
import { incrementDuelScore } from "@/app/actions/duelActions"

// Controlla se il GDO ha un tasso di fissaggio < 14% negli ultimi 7 giorni
async function checkFourthCallEligibility(gdoId: string): Promise<boolean> {
    const sevenDaysAgo = subDays(new Date(), 7)

    const recentLogs = await db.select({
        leadId: callLogs.leadId,
        outcome: callLogs.outcome
    })
        .from(callLogs)
        .where(
            and(
                eq(callLogs.userId, gdoId),
                gte(callLogs.createdAt, sevenDaysAgo)
            )
        )


    if (recentLogs.length === 0) return false // Nessuna chiamata -> nessuna quarta chiamata attivata per default

    // Tasso fissaggio: Appuntamenti / Contacted Leads (dove Contacted = almeno 1 log).
    // Usiamo lo stesso approccio di KpiAdvancedActions: 
    const uniqueContacted = new Set(recentLogs.map(l => l.leadId)).size
    const appointments = recentLogs.filter(l => l.outcome === 'APPUNTAMENTO').length

    if (uniqueContacted === 0) return false

    const apptRate = Math.round((appointments / uniqueContacted) * 100)
    return apptRate < 14
}

export async function getPipelineLeads() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    if (!session) throw new Error("Unauthorized")

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    const now = new Date()

    // 1. Pipeline Calls (1, 2, 3)
    const pipelineBaseConditions = [
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNull(leads.recallDate),
        lt(leads.callCount, 3)
    ]
    if (isGdo) pipelineBaseConditions.push(eq(leads.assignedToId, userId))

    const pipelineLeads = await db.select()
        .from(leads)
        .where(and(...pipelineBaseConditions))
        .orderBy(leads.createdAt)


    const firstCall = pipelineLeads.filter(l => l.callCount === 0)
    const secondCall = pipelineLeads.filter(l => l.callCount === 1)
    const thirdCall = pipelineLeads.filter(l => l.callCount === 2)

    // 2. Recalls (In arrivo & Scaduti)
    const recallBaseConditions = [
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNotNull(leads.recallDate)
    ]
    if (isGdo) recallBaseConditions.push(eq(leads.assignedToId, userId))

    const recallsLeads = await db.select()
        .from(leads)
        .where(and(...recallBaseConditions))
        .orderBy(leads.recallDate)


    // 3. Appointments
    const apptBaseConditions = [
        eq(leads.status, 'APPOINTMENT')
    ]
    if (isGdo) apptBaseConditions.push(eq(leads.assignedToId, userId))

    const appointmentsLeads = await db.select()
        .from(leads)
        .where(and(...apptBaseConditions))
        .orderBy(desc(leads.appointmentCreatedAt))


    // 4. Fourth Call "Recupero"
    let isFourthCallActive = false
    let fourthCall: typeof recallBaseConditions[] = [] // typing alias hack per array vuoto o tipato corr.
    let fourthCallLeads: any[] = []

    if (isGdo) {
        isFourthCallActive = await checkFourthCallEligibility(userId)

        if (isFourthCallActive) {
            const thirtyDaysAgo = subDays(now, 30)

            const fourthCallConditions = [
                eq(leads.status, 'REJECTED'),
                eq(leads.callCount, 3),
                eq(leads.discardReason, "irriperebile (3 tentativi vuoti)"),
                gte(leads.updatedAt, thirtyDaysAgo)
            ]
            if (isGdo) fourthCallConditions.push(eq(leads.assignedToId, userId))

            fourthCallLeads = await db.select()
                .from(leads)
                .where(and(...fourthCallConditions))
                .orderBy(desc(leads.updatedAt))

        }
    }

    return {
        firstCall,
        secondCall,
        thirdCall,
        fourthCall: fourthCallLeads,
        isFourthCallActive,
        recalls: recallsLeads,
        appointments: appointmentsLeads
    }
}

export async function updateLeadOutcome(
    leadId: string,
    outcome: 'DA_SCARTARE' | 'NON_RISPOSTO' | 'RICHIAMO' | 'APPUNTAMENTO',
    note: string,
    date?: Date, // recallDate or appointmentDate
    userId?: string,
    discardReason?: string, // New field
    currentVersion?: number, // Optimistic locking
    scriptCompleted?: boolean // Script tracking
) {

    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
    const effectiveUserId = userId || session?.user?.id

    const lead = (await db.select().from(leads).where(eq(leads.id, leadId)))[0]
    if (!lead) throw new Error("Lead non trovato")

    // Optimistic locking check
    if (currentVersion !== undefined && lead.version !== currentVersion) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    const fromSection = determineLeadSection(lead)

    const now = new Date()
    let newCallCount = lead.callCount + 1 // INCREMENTO ASSOLUTO PER OGNI OUTCOME
    let newStatus = lead.status
    let recallDate: Date | null = null
    let appointmentDate: Date | null = null
    let appointmentCreatedAt: Date | null = null

    // Create Call Log
    await db.insert(callLogs).values({
        id: crypto.randomUUID(),
        leadId,
        userId: effectiveUserId || null,
        outcome,
        note,
        discardReason: discardReason || null,
        scriptCompleted: scriptCompleted || false,
        createdAt: now,
    })

    if (outcome === 'DA_SCARTARE') {
        newStatus = 'REJECTED'
    }
    else if (outcome === 'NON_RISPOSTO') {
        if (newCallCount >= 4) {
            newStatus = 'REJECTED'
            discardReason = "irriperebile (4 tentativi vuoti)"
        } else if (newCallCount === 3) {
            newStatus = 'REJECTED'
            discardReason = "irriperebile (3 tentativi vuoti)"
        } else {
            newStatus = 'IN_PROGRESS'
        }
    }
    else if (outcome === 'RICHIAMO') {
        newStatus = 'IN_PROGRESS'
        recallDate = date || null
    }
    else if (outcome === 'APPUNTAMENTO') {
        newStatus = 'APPOINTMENT'
        appointmentDate = date || null
        appointmentCreatedAt = now
    }

    // Update lead record (atomic version check in WHERE prevents TOCTOU race)
    const updated = await db.update(leads)
        .set({
            status: newStatus,
            callCount: newCallCount,
            lastCallDate: now,
            lastCallNote: note,
            recallDate,
            appointmentDate,
            appointmentNote: outcome === 'APPUNTAMENTO' ? note : lead.appointmentNote,
            appointmentCreatedAt,
            discardReason: discardReason || lead.discardReason,
            version: lead.version + 1,
            updatedAt: now,
        })
        .where(and(eq(leads.id, leadId), eq(leads.version, lead.version)))
        .returning({ id: leads.id })

    if (updated.length === 0) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    // Team Goal trigger evaluation logic
    let rewardData = null;

    // Fenice Universe: chest progress for every call (chiamate) + boss attack
    if (effectiveUserId) {
        incrementChestProgress(effectiveUserId, 'chiamate', 1).catch(e => console.error("Chest chiamate err:", e));
        attackBoss(effectiveUserId, 'chiamata').catch(e => console.error("Adventure chiamata err:", e));
        checkAndAdvanceStage(effectiveUserId).catch(e => console.error("Adventure stage check err:", e));
        maybeDropCreature(effectiveUserId).catch(e => console.error("Creature drop err:", e));
        incrementDuelScore(effectiveUserId, 'chiamate', 1).catch(e => console.error("Duel score chiamate err:", e));
    }

    if (outcome === 'APPUNTAMENTO') {
        // Gamification: award XP for appointment set
        if (effectiveUserId) {
            rewardData = await awardXpAndCoins(effectiveUserId, "FISSATO", leadId).catch(e => { console.error("GameEngine FISSATO err:", e); return null; });

            // Fenice Universe: chest progress for fissaggi + boss attack
            incrementChestProgress(effectiveUserId, 'fissaggi', 1).catch(e => console.error("Chest fissaggi err:", e));
            attackBoss(effectiveUserId, 'fissaggio').catch(e => console.error("Adventure fissaggio err:", e));
            checkAndAdvanceStage(effectiveUserId).catch(e => console.error("Adventure stage check fissaggio err:", e));
            incrementDuelScore(effectiveUserId, 'fissaggi', 1).catch(e => console.error("Duel score fissaggi err:", e));
        }
        await evaluateTeamGoals(leadId).catch((e: any) => {
            console.error("Team goal evaluation failed:", e)
        })
        // Loot drop milestone check (every 10 appointments)
        if (effectiveUserId) {
            await triggerLootDrop(effectiveUserId).catch((e: any) => {
                console.error("Loot drop trigger failed:", e)
            })
            // Boss battle contribution (fire-and-forget)
            contributeToBoss(effectiveUserId).catch((e: any) => {
                console.error("Boss battle contribution failed:", e)
            })
        }
    }

    return { success: true, rewardData }
}
