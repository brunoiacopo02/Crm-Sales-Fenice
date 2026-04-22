"use server"

import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { and, eq, isNull, isNotNull, gte, lte, or, asc, inArray } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"

async function requireAdminOrManager() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !role || !["ADMIN", "MANAGER"].includes(role)) {
        throw new Error("Unauthorized")
    }
    return { id: user.id, role }
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
    followUpNumber: 1 | 2
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
    await requireAdminOrManager()
    const rows = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
    }).from(users).where(and(eq(users.role, 'VENDITORE'), eq(users.isActive, true)))
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
    await requireAdminOrManager()

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

    // Follow-up: leads con followUp1Date o followUp2Date valorizzato
    // e salespersonOutcome null (pratica ancora aperta). Prendo tutti i
    // lead con fu valorizzato del venditore per poi filtrare in JS per
    // range date (le due date sono su colonne diverse, query
    // più pulita in JS che in SQL).
    const fuRows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        funnel: leads.funnel,
        followUp1Date: leads.followUp1Date,
        followUp2Date: leads.followUp2Date,
        salespersonUserId: leads.salespersonUserId,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
    }).from(leads).where(and(
        inArray(leads.salespersonUserId, targetIds),
        isNull(leads.salespersonOutcome),
        or(isNotNull(leads.followUp1Date), isNotNull(leads.followUp2Date))!,
    ))

    const now = new Date()
    const upcoming: FollowUpRow[] = []
    const overdue: FollowUpRow[] = []

    for (const r of fuRows) {
        const common = {
            leadId: r.id,
            leadName: r.name || 'Senza nome',
            leadPhone: r.phone ?? null,
            funnel: r.funnel ?? null,
            venditoreId: r.salespersonUserId!,
            venditoreName: nameOf.get(r.salespersonUserId!) || '—',
            salespersonOutcome: r.salespersonOutcome ?? null,
            salespersonOutcomeNotes: r.salespersonOutcomeNotes ?? null,
        }
        const pushOne = (date: Date, n: 1 | 2) => {
            if (date < now) {
                overdue.push({ ...common, followUpNumber: n, followUpDate: date })
            } else if (date >= filters.startDate && date <= filters.endDate) {
                upcoming.push({ ...common, followUpNumber: n, followUpDate: date })
            }
        }
        if (r.followUp1Date) pushOne(r.followUp1Date as Date, 1)
        if (r.followUp2Date) pushOne(r.followUp2Date as Date, 2)
    }

    upcoming.sort((a, b) => a.followUpDate.getTime() - b.followUpDate.getTime())
    overdue.sort((a, b) => a.followUpDate.getTime() - b.followUpDate.getTime())

    return { venditori, appointments, upcomingFollowUps: upcoming, overdueFollowUps: overdue }
}
