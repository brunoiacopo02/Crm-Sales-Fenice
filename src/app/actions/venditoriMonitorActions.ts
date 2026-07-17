"use server"

import { db } from "@/db"
import { leads, users, salesAttempts } from "@/db/schema"
import { and, eq, isNotNull, gte, lte, or, asc, inArray, sql } from "drizzle-orm"
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

export interface VenditoriMonitorData {
    venditori: VenditoreLite[]
    appointments: AppointmentRow[]
    upcomingFollowUps: FollowUpRow[]
    overdueFollowUps: FollowUpRow[]
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
}): Promise<VenditoriMonitorData> {
    const { ctx } = await requireAdminOrManager()

    const venditori = await listVenditori()
    const targetIds = filters.venditoreIds.length > 0
        ? filters.venditoreIds
        : venditori.map(v => v.id)

    if (targetIds.length === 0) {
        return { venditori, appointments: [], upcomingFollowUps: [], overdueFollowUps: [] }
    }

    const nameOf = new Map(venditori.map(v => [v.id, v.name]))

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

    const appointments: AppointmentRow[] = apptRows.map(r => ({
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
            overdue.push(row)
        } else if (date >= filters.startDate && date <= filters.endDate) {
            upcoming.push(row)
        }
    }

    upcoming.sort((a, b) => a.followUpDate.getTime() - b.followUpDate.getTime())
    overdue.sort((a, b) => a.followUpDate.getTime() - b.followUpDate.getTime())

    return { venditori, appointments, upcomingFollowUps: upcoming, overdueFollowUps: overdue }
}
