"use server"

import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { callLogs, leadEvents, leads, users } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import {
    LANCIO_UMANI_COHORT,
    LANCIO_UMANI_EVENT_REASON,
    calcolaStatsLancioUmani,
    type LancioUmaniDati,
} from "@/lib/humanTestCohort"

/**
 * Pagina /lancio-umani (PO 06/10/2026): i 400 lead del lancio dati ai GDO 106
 * e 119. Un GDO vede solo i suoi; ADMIN/MANAGER tutti (o un GDO a scelta).
 * Due query in tutto (lead, chiamate), nessuna per lead.
 */
export async function getLancioUmani(gdoUserId?: string): Promise<LancioUmaniDati> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['GDO', 'ADMIN', 'MANAGER'].includes(role ?? '')) throw new Error('Unauthorized')
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // Il GDO non sceglie: vede solo i lead assegnati a lui.
    const filtroGdo = role === 'GDO' ? user.id : gdoUserId

    // Il lead resta del GDO a cui l'ha dato il test (toAssigneeId dell'evento),
    // anche se poi cambia assegnatario: i numeri del test non devono spostarsi.
    const perimetro = and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.humanTestCohort, LANCIO_UMANI_COHORT),
        filtroGdo ? sql`exists (select 1 from "leadEvents" e
            where e."leadId" = ${leads.id} and e."eventType" = 'REASSIGNED_ADMIN'
              and e.metadata->>'reason' = ${LANCIO_UMANI_EVENT_REASON}
              and e.metadata->>'toAssigneeId' = ${filtroGdo})` : undefined,
    )

    // Lead + assegnatario + evento di ingresso nel test (minuti di live e ora d'ingresso).
    const righe = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        assignedToId: sql<string | null>`coalesce(${leadEvents.metadata}->>'toAssigneeId', ${leads.assignedToId})`,
        status: leads.status,
        callCount: leads.callCount,
        lastCallDate: leads.lastCallDate,
        recallDate: leads.recallDate,
        appointmentDate: leads.appointmentDate,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        presentedAt: leads.presentedAt,
        confirmationsOutcome: leads.confirmationsOutcome,
        salespersonOutcome: leads.salespersonOutcome,
        closeAmountEur: leads.closeAmountEur,
        discardReason: leads.discardReason,
        gdoCode: users.gdoCode,
        gdoDisplayName: users.displayName,
        gdoName: users.name,
        zoomMinuti: sql<string | null>`${leadEvents.metadata}->>'zoomMinuti'`,
        cohortAt: leadEvents.timestamp,
    })
        .from(leads)
        .leftJoin(leadEvents, and(
            eq(leadEvents.leadId, leads.id),
            eq(leadEvents.eventType, 'REASSIGNED_ADMIN'),
            sql`${leadEvents.metadata}->>'reason' = ${LANCIO_UMANI_EVENT_REASON}`,
        ))
        .leftJoin(users, sql`${users.id} = coalesce(${leadEvents.metadata}->>'toAssigneeId', ${leads.assignedToId})`)
        .where(perimetro)

    // Chiamate sui lead del gruppo, col ruolo di chi ha chiamato: fuori bot e
    // venditori come su /kpi-gdo (kpiAdvancedActions.ts, isBotLog/isVenditoreLog).
    const logs = await db.select({
        leadId: callLogs.leadId,
        outcome: callLogs.outcome,
        discardReason: callLogs.discardReason,
        createdAt: callLogs.createdAt,
        callerRole: users.role,
        callerIsBot: users.isBot,
    })
        .from(callLogs)
        .innerJoin(leads, eq(leads.id, callLogs.leadId))
        .leftJoin(users, eq(users.id, callLogs.userId))
        .where(and(perimetro, eq(callLogs.companyId, ctx.companyId)))
    const chiamate = logs.filter(l => !l.callerIsBot && l.callerRole !== 'VENDITORE')

    // Un evento per lead (lo script lo scrive una volta sola): dedup difensivo.
    const visti = new Set<string>()
    const unici = righe.filter(r => (visti.has(r.id) ? false : (visti.add(r.id), true)))

    const nomeGdo = (r: (typeof unici)[number]) => r.gdoDisplayName || r.gdoName || null
    const { perGdo, totale } = calcolaStatsLancioUmani(
        unici.map(r => ({
            id: r.id,
            gdoUserId: r.assignedToId,
            gdoCode: r.gdoCode,
            gdoNome: nomeGdo(r),
            status: r.status,
            callCount: r.callCount,
            recallDate: r.recallDate,
            appointmentDate: r.appointmentDate,
            appointmentCreatedAt: r.appointmentCreatedAt,
            presentedAt: r.presentedAt,
            salespersonOutcome: r.salespersonOutcome,
            closeAmountEur: r.closeAmountEur,
            cohortAt: r.cohortAt,
        })),
        chiamate,
    )

    const iso = (d: Date | null) => (d ? d.toISOString() : null)
    return {
        perGdo,
        totale,
        leads: unici.map(r => {
            const minuti = r.zoomMinuti != null ? Number(r.zoomMinuti) : NaN
            return {
                id: r.id,
                nome: r.name,
                telefono: r.phone,
                gdoUserId: r.assignedToId,
                gdoCode: r.gdoCode,
                gdoNome: nomeGdo(r),
                status: r.status,
                callCount: r.callCount,
                lastCallDate: iso(r.lastCallDate),
                recallDate: iso(r.recallDate),
                appointmentDate: iso(r.appointmentDate),
                confirmationsOutcome: r.confirmationsOutcome,
                salespersonOutcome: r.salespersonOutcome,
                closeAmountEur: r.closeAmountEur,
                discardReason: r.discardReason,
                zoomMinuti: Number.isFinite(minuti) ? minuti : null,
            }
        }),
    }
}

/**
 * Voce di menu "Test lancio umani" per il GDO: solo se ha almeno un lead del
 * gruppo. Una query sola, chiamata dal layout (non a ogni cambio pagina).
 */
export async function hasLancioUmaniLeads(): Promise<boolean> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const ctx = await currentTenant()
    const [riga] = await db.select({ id: leads.id })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, user.id),
            eq(leads.humanTestCohort, LANCIO_UMANI_COHORT),
        ))
        .limit(1)
    return !!riga
}
