"use server"

import { db } from "@/db"
import { leads, users, salesAttempts, salesLatePenalties } from "@/db/schema"
import { and, eq, isNotNull, isNull, gte, lte, or, asc, desc, inArray, sql } from "drizzle-orm"
import { penaltyKey, lateHours, romeMonthKey, type PenaltyKind } from "@/lib/venditore/latePenalties"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy"
import { isConfermeTl } from "@/lib/confermeTl"

async function requireAdminOrManager(): Promise<{ id: string; role: string; ctx: TenantContext }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    // TL Conferme (Alberto, gating email) ammesso in lettura al Monitor Vendite
    // (swap PO 2026-07-17: sostituisce il suo accesso a Performance Venditori).
    const isTlConfermeViewer = role === "CONFERME" && isConfermeTl(user?.email)
    if (!user || !role || (!["ADMIN", "MANAGER"].includes(role) && !isTlConfermeViewer)) {
        throw new Error("Unauthorized")
    }
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return { id: user.id, role, ctx }
}

export interface VenditoreLite {
    id: string
    name: string
}

export interface AppointmentRow {
    leadId: string
    leadName: string
    leadPhone: string | null
    funnel: string | null
    appointmentDate: Date
    venditoreId: string
    venditoreName: string
    confirmationsOutcome: string | null
    salespersonOutcome: string | null
    appointmentNote: string | null
}

export interface FollowUpRow {
    leadId: string
    leadName: string
    leadPhone: string | null
    funnel: string | null
    followUpNumber: 1 | 2 | 3
    followUpDate: Date
    venditoreId: string
    venditoreName: string
    salespersonOutcome: string | null
    salespersonOutcomeNotes: string | null
}

/** Un ritardo a registro: scadenza mancata da un venditore. */
export interface LatePenaltyRow {
    id: string
    leadId: string
    leadName: string
    venditoreId: string
    venditoreName: string
    kind: PenaltyKind
    dueAt: Date
    resolvedAt: Date | null
    /** Ore trascorse fra la scadenza e l'esito (o adesso, se ancora scoperto). */
    hoursLate: number
    amountEur: number
}

export interface LatePenaltySummary {
    venditoreId: string
    venditoreName: string
    count: number
    /** Ritardi ancora senza esito: sono quelli che il manager deve sollecitare. */
    openCount: number
    totalEur: number
}

export interface InLavorazioneSummary {
    venditoreId: string
    venditoreName: string
    count: number
    maxDays: number
}

export interface VenditoriMonitorData {
    venditori: VenditoreLite[]
    appointments: AppointmentRow[]
    upcomingFollowUps: FollowUpRow[]
    overdueFollowUps: FollowUpRow[]
    inLavorazione: InLavorazioneSummary[]
    /** Ritardi del mese selezionato: le scadenze uscite dalle liste qui sopra. */
    latePenalties: LatePenaltyRow[]
    latePenaltySummary: LatePenaltySummary[]
    /** Mese di competenza dei ritardi mostrati ('YYYY-MM'). */
    penaltyMonthKey: string
}

export async function listVenditori(): Promise<VenditoreLite[]> {
    const { ctx } = await requireAdminOrManager()
    const rows = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
    }).from(users).where(and(
        // Staff condiviso: venditori con companyId='fenice' operano anche su
        // Serenamente via allowedCompanies (fallback legacy su companyId).
        or(
            sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
        ),
        eq(users.role, 'VENDITORE'),
        eq(users.isActive, true),
    ))
    return rows
        .map(r => ({ id: r.id, name: r.displayName || r.name || 'Venditore' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

/**
 * Ritorna appuntamenti + follow-up (prossimi e scaduti) dei venditori
 * nell'intervallo richiesto. `venditoreIds` vuoto = tutti i venditori.
 */
export async function getVenditoriMonitor(filters: {
    startDate: Date
    endDate: Date
    venditoreIds: string[]
    /** Mese dei ritardi da mostrare ('YYYY-MM'); default = mese corrente Rome. */
    penaltyMonthKey?: string
}): Promise<VenditoriMonitorData> {
    const { ctx } = await requireAdminOrManager()

    const venditori = await listVenditori()
    const targetIds = filters.venditoreIds.length > 0
        ? filters.venditoreIds
        : venditori.map(v => v.id)

    const penaltyMonthKey = filters.penaltyMonthKey || romeMonthKey(new Date())

    if (targetIds.length === 0) {
        return {
            venditori, appointments: [], upcomingFollowUps: [], overdueFollowUps: [],
            inLavorazione: [], latePenalties: [], latePenaltySummary: [], penaltyMonthKey,
        }
    }

    const nameOf = new Map(venditori.map(v => [v.id, v.name]))

    // Ritardi a registro. Servono a due cose: escludere dalle liste le scadenze
    // già "uscite dal monitor" (decisione PO 2026-09-09) e alimentare la sezione
    // Ritardi del mese selezionato.
    const penaltyRows = await db.select({
        id: salesLatePenalties.id,
        leadId: salesLatePenalties.leadId,
        salesUserId: salesLatePenalties.salesUserId,
        kind: salesLatePenalties.kind,
        dueAt: salesLatePenalties.dueAt,
        resolvedAt: salesLatePenalties.resolvedAt,
        amountEur: salesLatePenalties.amountEur,
        monthKey: salesLatePenalties.monthKey,
        leadName: leads.name,
    }).from(salesLatePenalties)
      .innerJoin(leads, eq(leads.id, salesLatePenalties.leadId))
      .where(and(
          eq(salesLatePenalties.companyId, ctx.companyId),
          inArray(salesLatePenalties.salesUserId, targetIds),
      ))
      .orderBy(desc(salesLatePenalties.dueAt))

    // Chiavi delle scadenze penalizzate: una scadenza a registro non compare più
    // nelle liste operative, è già passata al conteggio dei ritardi.
    const penalisedKeys = new Set(penaltyRows.map(r => penaltyKey({
        leadId: r.leadId,
        kind: r.kind as PenaltyKind,
        dueAt: r.dueAt,
    })))

    // Appuntamenti nel range
    const apptRows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        funnel: leads.funnel,
        appointmentDate: leads.appointmentDate,
        salespersonUserId: leads.salespersonUserId,
        confirmationsOutcome: leads.confirmationsOutcome,
        salespersonOutcome: leads.salespersonOutcome,
        appointmentNote: leads.appointmentNote,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        isNotNull(leads.appointmentDate),
        isNotNull(leads.salespersonUserId),
        inArray(leads.salespersonUserId, targetIds),
        gte(leads.appointmentDate, filters.startDate),
        lte(leads.appointmentDate, filters.endDate),
    )).orderBy(asc(leads.appointmentDate))

    const appointments: AppointmentRow[] = apptRows.filter(r => !penalisedKeys.has(penaltyKey({
        leadId: r.id,
        kind: 'APPOINTMENT',
        dueAt: r.appointmentDate as Date,
    }))).map(r => ({
        leadId: r.id,
        leadName: r.name || 'Senza nome',
        leadPhone: r.phone ?? null,
        funnel: r.funnel ?? null,
        appointmentDate: r.appointmentDate as Date,
        venditoreId: r.salespersonUserId!,
        venditoreName: nameOf.get(r.salespersonUserId!) || '—',
        confirmationsOutcome: r.confirmationsOutcome ?? null,
        salespersonOutcome: r.salespersonOutcome ?? null,
        appointmentNote: r.appointmentNote ?? null,
    }))

    // Follow-up aperti: verità in salesAttempts.nextFollowUpDate (il nuovo
    // ciclo di follow-up scrive lì, non più su leads.followUp1Date/followUp2Date
    // che restano sempre null → prima query sempre vuota). Prendo TUTTI gli
    // attempt dei lead ancora 'Non chiuso': la scelta dell'ultimo tentativo va
    // fatta PRIMA di filtrare sulla data, altrimenti un ultimo attempt senza
    // data (staff che bypassa la UI) mostrerebbe la data stale di un attempt
    // precedente — mentre la vista venditore escluderebbe il lead.
    const attemptRows = await db.select({
        leadId: salesAttempts.leadId,
        attemptNumber: salesAttempts.attemptNumber,
        nextFollowUpDate: salesAttempts.nextFollowUpDate,
        name: leads.name,
        phone: leads.phone,
        funnel: leads.funnel,
        salespersonUserId: leads.salespersonUserId,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
    }).from(salesAttempts)
      .innerJoin(leads, eq(leads.id, salesAttempts.leadId))
      .where(and(
          eq(leads.companyId, ctx.companyId),
          inArray(leads.salespersonUserId, targetIds),
          eq(leads.salespersonOutcome, 'Non chiuso'),
          isNull(leads.inLavorazioneAt),
      ))

    // Tengo, per ogni lead, solo il tentativo con attemptNumber massimo
    // (il follow-up "corrente"); il lead conta solo se QUEL tentativo ha
    // una nextFollowUpDate — stesso criterio di getVenditoreFollowUps.
    const latestByLead = new Map<string, typeof attemptRows[number]>()
    for (const r of attemptRows) {
        const cur = latestByLead.get(r.leadId)
        if (!cur || r.attemptNumber > cur.attemptNumber) latestByLead.set(r.leadId, r)
    }

    const now = new Date()
    const upcoming: FollowUpRow[] = []
    const overdue: FollowUpRow[] = []

    for (const r of latestByLead.values()) {
        if (!r.nextFollowUpDate) continue // ultimo attempt senza follow-up pendente
        const date = r.nextFollowUpDate
        const row: FollowUpRow = {
            leadId: r.leadId,
            leadName: r.name || 'Senza nome',
            leadPhone: r.phone ?? null,
            funnel: r.funnel ?? null,
            followUpNumber: Math.min(r.attemptNumber + 1, 3) as 1 | 2 | 3,
            followUpDate: date,
            venditoreId: r.salespersonUserId!,
            venditoreName: nameOf.get(r.salespersonUserId!) || '—',
            salespersonOutcome: r.salespersonOutcome ?? null,
            salespersonOutcomeNotes: r.salespersonOutcomeNotes ?? null,
        }
        if (date < now) {
            // Un follow-up già passato al conteggio ritardi non torna in lista.
            if (!penalisedKeys.has(penaltyKey({ leadId: r.leadId, kind: 'FOLLOWUP', dueAt: date }))) {
                overdue.push(row)
            }
        } else if (date >= filters.startDate && date <= filters.endDate) {
            upcoming.push(row)
        }
    }

    upcoming.sort((a, b) => a.followUpDate.getTime() - b.followUpDate.getTime())
    overdue.sort((a, b) => a.followUpDate.getTime() - b.followUpDate.getTime())

    // Lead parcheggiati "In lavorazione" (senza data follow-up) per venditore.
    const parkedRows = await db.select({
        salespersonUserId: leads.salespersonUserId,
        inLavorazioneAt: leads.inLavorazioneAt,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        inArray(leads.salespersonUserId, targetIds),
        isNotNull(leads.inLavorazioneAt),
    ))

    const parkedByVenditore = new Map<string, { count: number; maxDays: number }>()
    for (const r of parkedRows) {
        if (!r.salespersonUserId || !r.inLavorazioneAt) continue
        const days = Math.floor((now.getTime() - r.inLavorazioneAt.getTime()) / 86_400_000)
        const cur = parkedByVenditore.get(r.salespersonUserId) ?? { count: 0, maxDays: 0 }
        cur.count += 1
        cur.maxDays = Math.max(cur.maxDays, days)
        parkedByVenditore.set(r.salespersonUserId, cur)
    }
    const inLavorazione: InLavorazioneSummary[] = [...parkedByVenditore.entries()]
        .map(([venditoreId, v]) => ({
            venditoreId,
            venditoreName: nameOf.get(venditoreId) || '—',
            count: v.count,
            maxDays: v.maxDays,
        }))
        .sort((a, b) => b.maxDays - a.maxDays)

    // Ritardi del mese selezionato + riepilogo per venditore.
    const monthPenalties = penaltyRows.filter(r => r.monthKey === penaltyMonthKey)
    const latePenalties: LatePenaltyRow[] = monthPenalties.map(r => ({
        id: r.id,
        leadId: r.leadId,
        leadName: r.leadName || 'Senza nome',
        venditoreId: r.salesUserId,
        venditoreName: nameOf.get(r.salesUserId) || '—',
        kind: r.kind as PenaltyKind,
        dueAt: r.dueAt,
        resolvedAt: r.resolvedAt ?? null,
        hoursLate: lateHours(r.dueAt, r.resolvedAt ?? null, now),
        amountEur: r.amountEur,
    }))

    const summaryMap = new Map<string, LatePenaltySummary>()
    for (const p of latePenalties) {
        const cur = summaryMap.get(p.venditoreId) ?? {
            venditoreId: p.venditoreId,
            venditoreName: p.venditoreName,
            count: 0,
            openCount: 0,
            totalEur: 0,
        }
        cur.count += 1
        if (!p.resolvedAt) cur.openCount += 1
        cur.totalEur += p.amountEur
        summaryMap.set(p.venditoreId, cur)
    }
    const latePenaltySummary = [...summaryMap.values()].sort((a, b) => b.count - a.count)

    return {
        venditori,
        appointments,
        upcomingFollowUps: upcoming,
        overdueFollowUps: overdue,
        inLavorazione,
        latePenalties,
        latePenaltySummary,
        penaltyMonthKey,
    }
}

/**
 * Ritardi del venditore loggato nel mese corrente: alimenta il badge sulla sua
 * dashboard. Ognuno vede solo i propri (staff incluso, per il proprio account).
 */
export async function getMyLatePenalties(monthKey?: string): Promise<{
    monthKey: string
    count: number
    openCount: number
    totalEur: number
}> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { monthKey: monthKey || romeMonthKey(new Date()), count: 0, openCount: 0, totalEur: 0 }

    const ctx = await currentTenant()
    const mk = monthKey || romeMonthKey(new Date())

    const rows = await db.select({
        resolvedAt: salesLatePenalties.resolvedAt,
        amountEur: salesLatePenalties.amountEur,
    }).from(salesLatePenalties).where(and(
        eq(salesLatePenalties.companyId, ctx.companyId),
        eq(salesLatePenalties.salesUserId, user.id),
        eq(salesLatePenalties.monthKey, mk),
    ))

    return {
        monthKey: mk,
        count: rows.length,
        openCount: rows.filter(r => !r.resolvedAt).length,
        totalEur: rows.reduce((s, r) => s + (r.amountEur || 0), 0),
    }
}
