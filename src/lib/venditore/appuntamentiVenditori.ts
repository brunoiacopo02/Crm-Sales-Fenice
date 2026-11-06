// Lettura degli appuntamenti dei venditori, condivisa fra Monitor Vendite
// (/monitor-vendite) e centro di controllo della Diretta (/admin/diretta,
// PO 06/11/2026: "tutti gli app del giorno, come in monitor vendite").
// Un solo criterio: venditori attivi dell'azienda, lead con appuntamento nel
// periodo e un venditore fra quelli scelti, fuori le scadenze già passate al
// registro dei ritardi. Qualunque esito Conferme (confermato, scartato, in
// attesa, autofissato).

import { db } from "@/db"
import { leads, users, salesLatePenalties } from "@/db/schema"
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm"
import { penaltyKey } from "@/lib/venditore/latePenalties"

export interface VenditoreAttivo {
    id: string
    name: string
}

/** Venditori attivi che lavorano sull'azienda (staff condiviso via allowedCompanies). */
export async function venditoriAttivi(companyId: string): Promise<VenditoreAttivo[]> {
    const rows = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
    }).from(users).where(and(
        // Staff condiviso: venditori con companyId='fenice' operano anche su
        // Serenamente via allowedCompanies (fallback legacy su companyId).
        or(
            sql`${companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, companyId)),
        ),
        eq(users.role, 'VENDITORE'),
        eq(users.isActive, true),
    ))
    return rows
        .map(r => ({ id: r.id, name: r.displayName || r.name || 'Venditore' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

/**
 * Chiavi delle scadenze penalizzate (APPOINTMENT e FOLLOWUP, senza limite di
 * mese): una scadenza a registro non compare più nelle liste operative.
 */
export async function chiaviPenalizzate(companyId: string, salesIds: string[]): Promise<Set<string>> {
    if (salesIds.length === 0) return new Set()
    const rows = await db.select({
        leadId: salesLatePenalties.leadId,
        kind: salesLatePenalties.kind,
        dueAt: salesLatePenalties.dueAt,
    }).from(salesLatePenalties).where(and(
        eq(salesLatePenalties.companyId, companyId),
        inArray(salesLatePenalties.salesUserId, salesIds),
        inArray(salesLatePenalties.kind, ['APPOINTMENT', 'FOLLOWUP']),
    ))
    return new Set(rows
        .filter((r): r is typeof r & { leadId: string; kind: 'APPOINTMENT' | 'FOLLOWUP' } =>
            !!r.leadId && (r.kind === 'APPOINTMENT' || r.kind === 'FOLLOWUP'))
        .map(r => penaltyKey({ leadId: r.leadId, kind: r.kind, dueAt: r.dueAt })))
}

/** Appuntamenti dei venditori nel periodo [startDate, endDate], in ordine di appuntamento. */
export async function appuntamentiVenditori(params: {
    companyId: string
    salesIds: string[]
    startDate: Date
    endDate: Date
    penalisedKeys: Set<string>
}) {
    if (params.salesIds.length === 0) return []
    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        funnel: leads.funnel,
        isTest: leads.isTest,
        appointmentDate: leads.appointmentDate,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        salespersonUserId: leads.salespersonUserId,
        confirmationsOutcome: leads.confirmationsOutcome,
        confirmationsTimestamp: leads.confirmationsTimestamp,
        confirmationsUserId: leads.confirmationsUserId,
        salespersonOutcome: leads.salespersonOutcome,
        appointmentNote: leads.appointmentNote,
        assignedToId: leads.assignedToId,
        assignedAt: leads.assignedAt,
        gdoCode: users.gdoCode,
        gdoDisplayName: users.displayName,
        gdoName: users.name,
        gdoFirstName: users.firstName,
    }).from(leads)
        .leftJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            eq(leads.companyId, params.companyId),
            isNotNull(leads.appointmentDate),
            isNotNull(leads.salespersonUserId),
            inArray(leads.salespersonUserId, params.salesIds),
            gte(leads.appointmentDate, params.startDate),
            lte(leads.appointmentDate, params.endDate),
        )).orderBy(asc(leads.appointmentDate))

    return rows.filter(r => !params.penalisedKeys.has(penaltyKey({
        leadId: r.id,
        kind: 'APPOINTMENT',
        dueAt: r.appointmentDate as Date,
    })))
}
