"use server"
import { createClient } from "@/utils/supabase/server"

import { db } from "@/db"
import { leads, callLogs, pipelineSnapshots, users, leadEvents } from "@/db/schema"
import { CONFERME_DISCARD_RESET } from "@/lib/confermeReset"
import { eq, and, ne, isNull, isNotNull, lt, or, lte, desc, gte, sql } from "drizzle-orm"
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
import { enqueueMarketingWebhook } from "@/lib/marketing-webhooks/enqueue"
import { notifyAppointmentToBot } from "@/lib/agendaBot"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"

// Controlla se il GDO ha un tasso di fissaggio < 14% negli ultimi 7 giorni
async function checkFourthCallEligibility(gdoId: string, companyId: string): Promise<boolean> {
    const sevenDaysAgo = subDays(new Date(), 7)

    const recentLogs = await db.select({
        leadId: callLogs.leadId,
        outcome: callLogs.outcome
    })
        .from(callLogs)
        .where(
            and(
                eq(callLogs.companyId, companyId),
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

    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const isGdo = session.user.role === 'GDO'
    const userId = session.user.id

    const now = new Date()

    // 1. Pipeline Calls (1, 2, 3) — tenant-scoped
    const pipelineBaseConditions = [
        eq(leads.companyId, ctx.companyId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNull(leads.recallDate),
        lt(leads.callCount, 3)
    ]
    if (isGdo) pipelineBaseConditions.push(eq(leads.assignedToId, userId))

    const pipelineLeads = await db.select()
        .from(leads)
        .where(and(...pipelineBaseConditions))
        .orderBy(desc(leads.createdAt), leads.id)  // più recenti in cima — `id` come tiebreaker per ordine stabile fra lead con stesso createdAt (es. bulk CSV import)


    const firstCall = pipelineLeads.filter(l => l.callCount === 0)
    const secondCall = pipelineLeads.filter(l => l.callCount === 1)
    const thirdCall = pipelineLeads.filter(l => l.callCount === 2)

    // 2ª/3ª chiamata: i lead fermi da più tempo in cima, quelli appena
    // richiamati in fondo (richiesta GDO 2026-06-11). Ordina per lastCallDate
    // crescente (mai chiamati/più vecchi prima), id come tiebreaker stabile.
    const byOldestCall = (a: { lastCallDate: Date | null; id: string }, b: { lastCallDate: Date | null; id: string }) => {
        const ta = a.lastCallDate ? new Date(a.lastCallDate).getTime() : 0
        const tb = b.lastCallDate ? new Date(b.lastCallDate).getTime() : 0
        if (ta !== tb) return ta - tb
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }
    secondCall.sort(byOldestCall)
    thirdCall.sort(byOldestCall)

    // DIAG: capture every pipeline fetch with detail to investigate "lead spariscono"
    if (isGdo) {
        const firstCallIds = firstCall.map(l => `${l.id.slice(0,8)}/${l.launchBucket ? 'LCH' : 'std'}`).join(',')
        console.log(`[PIPE] ${new Date().toISOString()} u=${session.user.email} 1ª=${firstCall.length} (lch=${firstCall.filter(l => l.launchBucket).length}) 2ª=${secondCall.length} ids1ª=[${firstCallIds}]`)
    }

    // 2. Recalls (In arrivo & Scaduti) — tenant-scoped
    const recallBaseConditions = [
        eq(leads.companyId, ctx.companyId),
        ne(leads.status, 'REJECTED'),
        ne(leads.status, 'APPOINTMENT'),
        isNotNull(leads.recallDate)
    ]
    if (isGdo) recallBaseConditions.push(eq(leads.assignedToId, userId))

    const recallsLeads = await db.select()
        .from(leads)
        .where(and(...recallBaseConditions))
        .orderBy(leads.recallDate, leads.id)

    // PIPELINE SNAPSHOT: scrive un record in pipelineSnapshots ogni volta che cambia
    // la composizione delle tab per un GDO. Serve per diagnosticare "lead spariti" confrontando
    // snapshot consecutivi (vedi project_pipeline_sort_stability).
    if (isGdo) {
        try {
            const firstIds = firstCall.map(l => l.id).sort()
            const secondIds = secondCall.map(l => l.id).sort()
            const thirdIds = thirdCall.map(l => l.id).sort()
            const fingerprint = crypto.createHash('sha1')
                .update(firstIds.join(',') + '|' + secondIds.join(',') + '|' + thirdIds.join(','))
                .digest('hex')

            const lastSnap = await db.select({
                fingerprint: pipelineSnapshots.fingerprint,
                firstCallCount: pipelineSnapshots.firstCallCount,
                secondCallCount: pipelineSnapshots.secondCallCount,
                thirdCallCount: pipelineSnapshots.thirdCallCount,
            })
                .from(pipelineSnapshots)
                .where(and(
                    eq(pipelineSnapshots.companyId, ctx.companyId),
                    eq(pipelineSnapshots.userId, userId),
                ))
                .orderBy(desc(pipelineSnapshots.timestamp))
                .limit(1)

            if (!lastSnap[0] || lastSnap[0].fingerprint !== fingerprint) {
                // Le liste ID servono solo per diagnosticare i "lead spariti": le salviamo
                // esclusivamente quando una tab si restringe rispetto allo snapshot precedente.
                const shrunk = !!lastSnap[0] && (
                    firstCall.length < lastSnap[0].firstCallCount ||
                    secondCall.length < lastSnap[0].secondCallCount ||
                    thirdCall.length < lastSnap[0].thirdCallCount
                )
                await db.insert(pipelineSnapshots).values({
                    id: crypto.randomUUID(),
                    userId,
                    firstCallCount: firstCall.length,
                    secondCallCount: secondCall.length,
                    thirdCallCount: thirdCall.length,
                    recallsCount: recallsLeads.length,
                    firstCallIds: shrunk ? firstIds : [],
                    secondCallIds: shrunk ? secondIds : [],
                    thirdCallIds: shrunk ? thirdIds : [],
                    fingerprint,
                    companyId: ctx.companyId,
                })
            }
        } catch (e) {
            console.error('[pipelineSnapshot] write failed', e)
        }
    }


    // 3. Appointments — tenant-scoped
    const apptBaseConditions = [
        eq(leads.companyId, ctx.companyId),
        eq(leads.status, 'APPOINTMENT')
    ]
    if (isGdo) apptBaseConditions.push(eq(leads.assignedToId, userId))

    const appointmentsLeads = await db.select()
        .from(leads)
        .where(and(...apptBaseConditions))
        .orderBy(desc(leads.appointmentCreatedAt), leads.id)


    // 4. Fourth Call "Recupero"
    let isFourthCallActive = false
    let fourthCall: typeof recallBaseConditions[] = [] // typing alias hack per array vuoto o tipato corr.
    let fourthCallLeads: any[] = []

    if (isGdo) {
        isFourthCallActive = await checkFourthCallEligibility(userId, ctx.companyId)

        if (isFourthCallActive) {
            const thirtyDaysAgo = subDays(now, 30)

            const fourthCallConditions = [
                eq(leads.companyId, ctx.companyId),
                eq(leads.status, 'REJECTED'),
                eq(leads.callCount, 3),
                // Il refuso storico "irriperebile" è stato corretto in "irreperibile"
                // (pipelineActions.ts, auto-scarto NON_RISPOSTO), ma i lead scartati
                // prima del fix restano nel DB con la vecchia grafia: matchiamo entrambe,
                // altrimenti la "quarta chiamata" smette di trovare candidati.
                or(
                    eq(leads.discardReason, "irreperibile (3 tentativi vuoti)"),
                    eq(leads.discardReason, "irriperebile (3 tentativi vuoti)"),
                ),
                gte(leads.updatedAt, thirtyDaysAgo)
            ]
            if (isGdo) fourthCallConditions.push(eq(leads.assignedToId, userId))

            fourthCallLeads = await db.select()
                .from(leads)
                .where(and(...fourthCallConditions))
                .orderBy(desc(leads.updatedAt))

        }
    }

    // Detector duplicati telefono (non bloccante): numeri normalizzati alle
    // ultime 9 cifre presenti su più lead della company. Le card mostrano un
    // badge; il dettaglio si carica on-demand con getLeadsWithSamePhone().
    let dupPhoneKeys = new Set<string>()
    try {
        const phoneKeyExpr = sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9)`
        const dupRows = await db.select({ key: phoneKeyExpr })
            .from(leads)
            .where(eq(leads.companyId, ctx.companyId))
            .groupBy(phoneKeyExpr)
            .having(sql`count(*) > 1`)
        dupPhoneKeys = new Set(dupRows.map(r => r.key).filter(k => !!k && k.length >= 6))
    } catch (e) {
        console.error('[dupPhones] detection failed', e)
    }
    const phoneKey = (p: string | null) => (p || '').replace(/\D/g, '').slice(-9)
    const withDupFlag = <T extends { phone: string }>(arr: T[]) =>
        arr.map(l => ({ ...l, duplicatePhone: dupPhoneKeys.has(phoneKey(l.phone)) }))

    return {
        firstCall: withDupFlag(firstCall),
        secondCall: withDupFlag(secondCall),
        thirdCall: withDupFlag(thirdCall),
        fourthCall: fourthCallLeads,
        isFourthCallActive,
        recalls: withDupFlag(recallsLeads),
        appointments: appointmentsLeads
    }
}

/**
 * Dettaglio duplicati: tutti gli ALTRI lead della company con lo stesso numero
 * (normalizzato alle ultime 9 cifre) del lead dato. Mostra chi li ha in carico,
 * l'ultimo esito e le date — così il GDO evita di richiamare numeri già gestiti
 * da un collega. Sola lettura, non bloccante.
 */
export async function getLeadsWithSamePhone(leadId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const [target] = await db.select({ id: leads.id, phone: leads.phone })
        .from(leads)
        .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId)))
        .limit(1)
    if (!target) return { success: false as const, error: 'Lead non trovato' }

    const key = (target.phone || '').replace(/\D/g, '').slice(-9)
    if (key.length < 6) return { success: true as const, duplicates: [] }

    const phoneKeyExpr = sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9)`
    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        funnel: leads.funnel,
        status: leads.status,
        callCount: leads.callCount,
        lastCallDate: leads.lastCallDate,
        recallDate: leads.recallDate,
        appointmentDate: leads.appointmentDate,
        salespersonOutcome: leads.salespersonOutcome,
        discardReason: leads.discardReason,
        assignedToName: users.displayName,
        assignedToRealName: users.name,
    })
        .from(leads)
        .leftJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            ne(leads.id, leadId),
            sql`${phoneKeyExpr} = ${key}`,
        ))
        .orderBy(desc(leads.updatedAt))
        .limit(10)

    return {
        success: true as const,
        duplicates: rows.map(r => ({
            id: r.id,
            name: r.name,
            funnel: r.funnel,
            status: r.status,
            callCount: r.callCount,
            lastCallDate: r.lastCallDate ? r.lastCallDate.toISOString() : null,
            recallDate: r.recallDate ? r.recallDate.toISOString() : null,
            appointmentDate: r.appointmentDate ? r.appointmentDate.toISOString() : null,
            salespersonOutcome: r.salespersonOutcome,
            discardReason: r.discardReason,
            assignedToName: r.assignedToRealName || r.assignedToName || 'Non assegnato',
        })),
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
    scriptCompleted?: boolean, // Script tracking
    serviceCtx?: { companyId: string; actorUserId: string; isBot: boolean } // Bot/service-account bypass
) {

    let ctx: { companyId: string }
    let effectiveUserId: string | undefined
    let isBotActor = false

    if (serviceCtx) {
        // Service account (bot fissatore): nessuna sessione Supabase, tenant esplicito.
        ctx = { companyId: serviceCtx.companyId }
        effectiveUserId = serviceCtx.actorUserId
        isBotActor = serviceCtx.isBot
    } else {
        const supabase = await createClient();
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;
        effectiveUserId = userId || session?.user?.id

        const tenant = await currentTenant()
        assertSalesArea(tenant)
        ctx = { companyId: tenant.companyId }
    }

    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
    )))[0]
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

    // Create Call Log (tenant-scoped)
    await db.insert(callLogs).values({
        id: crypto.randomUUID(),
        leadId,
        userId: effectiveUserId || null,
        outcome,
        note,
        discardReason: discardReason || null,
        scriptCompleted: scriptCompleted || false,
        createdAt: now,
        companyId: ctx.companyId,
    })

    if (outcome === 'DA_SCARTARE') {
        newStatus = 'REJECTED'
    }
    else if (outcome === 'NON_RISPOSTO') {
        if (newCallCount >= 4) {
            newStatus = 'REJECTED'
            discardReason = "irreperibile (4 tentativi vuoti)"
        } else if (newCallCount === 3) {
            newStatus = 'REJECTED'
            discardReason = "irreperibile (3 tentativi vuoti)"
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

    // Compute recallNote: preserve original recall note unless this outcome is RICHIAMO (then update it)
    // Clear it only when the lead transitions to a state without a recall (REJECTED, APPOINTMENT)
    let newRecallNote = lead.recallNote
    if (outcome === 'RICHIAMO') {
        newRecallNote = note || null
    } else if (outcome === 'DA_SCARTARE' || outcome === 'APPUNTAMENTO') {
        newRecallNote = null
    }

    // Badge "richiamo non risposto": NR su un lead che aveva un richiamo
    // programmato → marca recallMissedAt. Nuovo richiamo o uscita dalla
    // pipeline lo azzerano.
    let newRecallMissedAt = lead.recallMissedAt
    if (outcome === 'NON_RISPOSTO' && lead.recallDate) {
        newRecallMissedAt = now
    } else if (outcome === 'RICHIAMO' || outcome === 'DA_SCARTARE' || outcome === 'APPUNTAMENTO') {
        newRecallMissedAt = null
    }

    // Nuovo appuntamento su un lead scartato dalle Conferme: lo scarto
    // precedente viene azzerato (altrimenti resta nella lista scarti) e il
    // ciclo NR Conferme riparte da zero. Se invece era solo parcheggiato o
    // snoozato, risolve parcheggio/snooze (QA Conferme 2026-06-12).
    const confermeReset = outcome === 'APPUNTAMENTO'
        ? (lead.confirmationsOutcome === 'scartato'
            ? CONFERME_DISCARD_RESET
            : (lead.confNeedsReschedule || lead.confSnoozeAt
                ? { confNeedsReschedule: false as const, confSnoozeAt: null }
                : {}))
        : {}

    // Update lead record (atomic version check in WHERE prevents TOCTOU race)
    const updated = await db.update(leads)
        .set({
            ...confermeReset,
            status: newStatus,
            callCount: newCallCount,
            lastCallDate: now,
            lastCallNote: note,
            recallNote: newRecallNote,
            recallMissedAt: newRecallMissedAt,
            recallDate,
            appointmentDate,
            appointmentNote: outcome === 'APPUNTAMENTO' ? note : lead.appointmentNote,
            appointmentCreatedAt,
            discardReason: discardReason || lead.discardReason,
            version: lead.version + 1,
            updatedAt: now,
        })
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.id, leadId),
            eq(leads.version, lead.version),
        ))
        .returning({ id: leads.id })

    if (updated.length === 0) {
        return { success: false, error: 'CONCURRENCY_ERROR' }
    }

    // Team Goal trigger evaluation logic
    let rewardData = null;

    // Fenice Universe: chest progress for every call (chiamate) + boss attack
    if (effectiveUserId && !isBotActor) {
        incrementChestProgress(effectiveUserId, 'chiamate', 1).catch(e => console.error("Chest chiamate err:", e));
        attackBoss(effectiveUserId, 'chiamata').catch(e => console.error("Adventure chiamata err:", e));
        checkAndAdvanceStage(effectiveUserId).catch(e => console.error("Adventure stage check err:", e));
        maybeDropCreature(effectiveUserId).catch(e => console.error("Creature drop err:", e));
        incrementDuelScore(effectiveUserId, 'chiamate', 1).catch(e => console.error("Duel score chiamate err:", e));
    }

    if (outcome === 'APPUNTAMENTO') {
        // Traccia il reset dello scarto Conferme nella timeline del lead.
        if (lead.confirmationsOutcome === 'scartato') {
            try {
                await db.insert(leadEvents).values({
                    id: crypto.randomUUID(),
                    leadId,
                    eventType: 'conferme_scarto_reset',
                    userId: effectiveUserId || null,
                    timestamp: now,
                    metadata: {
                        previousDiscardReason: lead.confirmationsDiscardReason,
                        trigger: 'gdo_new_appointment',
                    },
                    companyId: ctx.companyId,
                })
            } catch (e) {
                console.error("conferme_scarto_reset event err:", e)
            }
        }

        // Marketing webhook: notify external CRM that an appointment was set
        await enqueueMarketingWebhook({
            eventType: 'appointment.set',
            leadId,
            actorUserId: effectiveUserId ?? null,
        }).catch((e: unknown) => console.error("Marketing webhook (appointment.set) err:", e));

        // Bot: data e ora dell'appuntamento, che quando è partita l'agenda non
        // esistevano ancora. Saltato se a fissare è il bot stesso — quella data
        // ce l'ha appena mandata lui.
        if (!isBotActor) {
            await notifyAppointmentToBot({
                lead: { id: leadId, phone: lead.phone, name: lead.name, funnel: lead.funnel, companyId: ctx.companyId },
                appointmentAt: appointmentDate,
                trigger: 'fissato',
            });
        }

        // Gamification: award XP for appointment set (tenant attribution)
        if (effectiveUserId && !isBotActor) {
            rewardData = await awardXpAndCoins(effectiveUserId, "FISSATO", leadId, ctx.companyId).catch(e => { console.error("GameEngine FISSATO err:", e); return null; });

            // Fenice Universe: chest progress for fissaggi + boss attack
            incrementChestProgress(effectiveUserId, 'fissaggi', 1).catch(e => console.error("Chest fissaggi err:", e));
            attackBoss(effectiveUserId, 'fissaggio').catch(e => console.error("Adventure fissaggio err:", e));
            checkAndAdvanceStage(effectiveUserId).catch(e => console.error("Adventure stage check fissaggio err:", e));
            incrementDuelScore(effectiveUserId, 'fissaggi', 1).catch(e => console.error("Duel score fissaggi err:", e));
        }
        if (!isBotActor) {
            await evaluateTeamGoals(leadId).catch((e: any) => {
                console.error("Team goal evaluation failed:", e)
            })
        }
        // Loot drop milestone check (every 10 appointments)
        if (effectiveUserId && !isBotActor) {
            await triggerLootDrop(effectiveUserId).catch((e: any) => {
                console.error("Loot drop trigger failed:", e)
            })
            // Boss battle contribution (fire-and-forget)
            contributeToBoss(effectiveUserId).catch((e: any) => {
                console.error("Boss battle contribution failed:", e)
            })
        }
    }

    // Marketing: il lead e' morto qui. Copre i tre casi che passano da questa
    // funzione — scarto a mano del GDO, auto-scarto al terzo tentativo vuoto,
    // e scarto del bot, che richiama updateLeadOutcome con serviceCtx.
    // Guardia lead.status !== 'REJECTED': senza, un secondo DA_SCARTARE su un
    // lead già scartato (es. il bot che ri-manda lo stesso esito senza lock
    // ottimistico) rimanderebbe l'evento. Uno scarto dopo una riapertura
    // (lo stato prima dell'update non era REJECTED) resta invece legittimo.
    if (newStatus === 'REJECTED' && lead.status !== 'REJECTED' && (outcome === 'DA_SCARTARE' || outcome === 'NON_RISPOSTO')) {
        await enqueueMarketingWebhook({
            eventType: 'lead.rejected',
            leadId,
            actorUserId: effectiveUserId ?? null,
            rejection: {
                stage: 'GDO',
                automatic: outcome === 'NON_RISPOSTO',
                byBot: isBotActor,
            },
        }).catch((e: unknown) => console.error("Marketing webhook (lead.rejected GDO) err:", e));
    }

    return { success: true, rewardData }
}
