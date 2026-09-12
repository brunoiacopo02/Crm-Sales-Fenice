"use server"

import { db } from "@/db"
import {
    leads, users, salesAvailabilitySlots, salesSlotBlocks, salesWeekPlans, salesLatePenalties,
} from "@/db/schema"
import { and, eq, gte, lt, isNull, or, sql } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy"
import { toRomeDateStr } from "@/lib/dateUtils"
import {
    weekSlots, weekStartFor, weeklyDeadline, slotKey, slotStartFor, romeInstant,
} from "@/lib/venditore/calendarSlots"
import { manualBlockCheck, blockRefusalMessage } from "@/lib/venditore/calendarRules"
import { weekCoverage } from "@/lib/venditore/calendarQueries"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"
import { revalidatePath } from "next/cache"
import crypto from "crypto"

/**
 * Sessione sales minima. Nessun filtro di ruolo qui: ogni funzione esportata
 * decide da sé chi può fare cosa, questa serve solo a garantire un utente
 * autenticato e in area sales.
 */
async function requireSalesSession() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Unauthorized")

    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return { userId: ctx.userId, role: ctx.role, email: ctx.email, ctx }
}

/**
 * Venditori attivi visibili dal tenant corrente. Stesso pattern di
 * `getVenditoriAgenda` (confermeActions.ts): i venditori sono staff
 * condiviso, hanno `companyId='fenice'` e operano su altre aziende tramite
 * `allowedCompanies`. Filtrare sul solo `companyId` svuota la pagina su
 * Serenamente — bug già capitato e documentato lì.
 */
async function activeVenditori(ctx: TenantContext) {
    const rows = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        calendarExempt: users.calendarExempt,
    }).from(users).where(and(
        or(
            sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
        ),
        eq(users.role, 'VENDITORE'),
        eq(users.isActive, true),
    ))
    return rows.map(r => ({
        id: r.id,
        name: r.displayName || r.name || 'Venditore',
        calendarExempt: r.calendarExempt,
    }))
}

export interface CalendarWeekView {
    weekStartIso: string
    deadlineIso: string
    editable: boolean
    readOnlyReason: 'settimana_passata' | 'altro_venditore' | null
    isExempt: boolean
    mySlots: string[]
    myBlocks: Array<{ slotKey: string; kind: string; leadId: string | null; leadName: string | null }>
    myAppointments: Array<{ slotKey: string; leadId: string; leadName: string }>
    submittedAtIso: string | null
    slotCount: number
    late: boolean
    penaltyIso: string | null
    coverage: CoverageCell[]
    venditori: Array<{ id: string; name: string }>
}

/**
 * Vista completa della settimana: la propria (default) o quella di un altro
 * venditore per chi ha visibilità gestionale (ADMIN/MANAGER/CONFERME). La
 * copertura è sempre inclusa: è interna, non riservata al singolo venditore.
 */
export async function getCalendarWeek(input?: {
    weekStartIso?: string
    salesUserId?: string
}): Promise<CalendarWeekView> {
    const { userId, role, ctx } = await requireSalesSession()

    const weekStart = input?.weekStartIso
        ? weekStartFor(new Date(input.weekStartIso))
        : weekStartFor(new Date())
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000)
    const weekStartStr = toRomeDateStr(weekStart)
    const deadline = weeklyDeadline(weekStart)

    // Solo lo staff gestionale può guardare il calendario di un altro
    // venditore; chiunque altro vede sempre e solo il proprio, a prescindere
    // da cosa arriva dal client.
    const canPickOthers = ['ADMIN', 'MANAGER', 'CONFERME'].includes(role)
    const targetUserId = (input?.salesUserId && canPickOthers) ? input.salesUserId : userId

    const isCurrentOrFuture = weekStart >= weekStartFor(new Date())
    const isSelf = targetUserId === userId
    const editable = isCurrentOrFuture && isSelf && role === 'VENDITORE'
    const readOnlyReason: CalendarWeekView['readOnlyReason'] = !isCurrentOrFuture
        ? 'settimana_passata'
        : (!isSelf ? 'altro_venditore' : null)

    const [availRows, blockRows, apptRows, planRows, penaltyRows, coverage, venditoriRows] = await Promise.all([
        db.select({ slotStart: salesAvailabilitySlots.slotStart })
            .from(salesAvailabilitySlots)
            .where(and(
                eq(salesAvailabilitySlots.companyId, ctx.companyId),
                eq(salesAvailabilitySlots.salesUserId, targetUserId),
                eq(salesAvailabilitySlots.weekStart, weekStartStr),
            )),
        db.select({
            slotStart: salesSlotBlocks.slotStart,
            kind: salesSlotBlocks.kind,
            leadId: salesSlotBlocks.leadId,
            leadName: leads.name,
        }).from(salesSlotBlocks)
            .leftJoin(leads, eq(salesSlotBlocks.leadId, leads.id))
            .where(and(
                eq(salesSlotBlocks.companyId, ctx.companyId),
                eq(salesSlotBlocks.salesUserId, targetUserId),
                gte(salesSlotBlocks.slotStart, weekStart),
                lt(salesSlotBlocks.slotStart, weekEnd),
            )),
        db.select({
            appointmentDate: leads.appointmentDate,
            leadId: leads.id,
            leadName: leads.name,
        }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, targetUserId),
            gte(leads.appointmentDate, weekStart),
            lt(leads.appointmentDate, weekEnd),
        )),
        db.select({
            submittedAt: salesWeekPlans.submittedAt,
            slotCount: salesWeekPlans.slotCount,
            late: salesWeekPlans.late,
        }).from(salesWeekPlans).where(and(
            eq(salesWeekPlans.companyId, ctx.companyId),
            eq(salesWeekPlans.salesUserId, targetUserId),
            eq(salesWeekPlans.weekStart, weekStartStr),
        )).limit(1),
        db.select({ dueAt: salesLatePenalties.dueAt })
            .from(salesLatePenalties)
            .where(and(
                eq(salesLatePenalties.companyId, ctx.companyId),
                eq(salesLatePenalties.salesUserId, targetUserId),
                eq(salesLatePenalties.kind, 'CALENDAR_MISSING'),
                eq(salesLatePenalties.dueAt, deadline),
                isNull(salesLatePenalties.voidedAt),
            )).limit(1),
        weekCoverage(ctx, weekStart),
        activeVenditori(ctx),
    ])

    const myAppointments = apptRows.flatMap(r => {
        if (!r.appointmentDate) return []
        const slot = slotStartFor(r.appointmentDate)
        if (!slot) return []
        return [{ slotKey: slotKey(slot), leadId: r.leadId, leadName: r.leadName }]
    })

    const plan = planRows[0]
    const penalty = penaltyRows[0]
    const targetInfo = venditoriRows.find(v => v.id === targetUserId)

    return {
        weekStartIso: weekStart.toISOString(),
        deadlineIso: deadline.toISOString(),
        editable,
        readOnlyReason,
        isExempt: targetInfo?.calendarExempt ?? false,
        mySlots: availRows.map(r => slotKey(r.slotStart)),
        myBlocks: blockRows.map(r => ({
            slotKey: slotKey(r.slotStart),
            kind: r.kind,
            leadId: r.leadId,
            leadName: r.leadName,
        })),
        myAppointments,
        submittedAtIso: plan?.submittedAt ? plan.submittedAt.toISOString() : null,
        slotCount: plan?.slotCount ?? 0,
        late: plan?.late ?? false,
        penaltyIso: penalty?.dueAt ? penalty.dueAt.toISOString() : null,
        coverage,
        venditori: venditoriRows.map(v => ({ id: v.id, name: v.name })),
    }
}

/**
 * Salva la disponibilità dichiarata per una settimana intera (sostituisce le
 * righe esistenti, non le somma) e registra/aggiorna `salesWeekPlans`.
 * `submittedAt`/`late` sono la prova del PRIMO salvataggio: il cron del
 * lunedì li legge per decidere le multe, quindi non si toccano più dopo.
 */
export async function saveCalendarWeek(
    weekStartIso: string,
    slotKeys: string[],
): Promise<{ success: boolean; error?: string; late?: boolean }> {
    const { userId, role, ctx } = await requireSalesSession()
    if (role !== 'VENDITORE') {
        return { success: false, error: 'Solo i venditori compilano il proprio calendario.' }
    }

    const weekStart = weekStartFor(new Date(weekStartIso))
    if (weekStart < weekStartFor(new Date())) {
        return { success: false, error: 'Le settimane passate non si modificano.' }
    }

    // Ricostruisce ogni chiave ricevuta dal client e la scarta se non
    // appartiene alla griglia di questa settimana: un client può mandare
    // qualunque cosa, non ci fidiamo delle chiavi in ingresso.
    const validKeys = new Set(weekSlots(weekStart).map(s => slotKey(s)))
    const valid = slotKeys
        .map(key => {
            const [dateStr, h] = key.split('@')
            if (!dateStr || !h) return null
            const instant = romeInstant(dateStr, Number(h))
            return validKeys.has(slotKey(instant)) ? instant : null
        })
        .filter((d): d is Date => d !== null)

    // Il client puo' mandare la stessa ora due volte: senza questa deduplica
    // l'insert violerebbe l'unique (salesUserId, slotStart) dentro la transazione.
    const perChiave = new Map<string, Date>()
    for (const slot of valid) perChiave.set(slotKey(slot), slot)
    const unici = [...perChiave.values()]

    const now = new Date()
    const weekStartStr = toRomeDateStr(weekStart)
    const late = now > weeklyDeadline(weekStart)

    try {
        await db.transaction(async (tx) => {
            await tx.delete(salesAvailabilitySlots).where(and(
                eq(salesAvailabilitySlots.companyId, ctx.companyId),
                eq(salesAvailabilitySlots.salesUserId, userId),
                eq(salesAvailabilitySlots.weekStart, weekStartStr),
            ))

            if (unici.length > 0) {
                await tx.insert(salesAvailabilitySlots).values(unici.map(slotStart => ({
                    id: crypto.randomUUID(),
                    companyId: ctx.companyId,
                    salesUserId: userId,
                    slotStart,
                    weekStart: weekStartStr,
                })))
            }

            await tx.insert(salesWeekPlans).values({
                id: crypto.randomUUID(),
                companyId: ctx.companyId,
                salesUserId: userId,
                weekStart: weekStartStr,
                submittedAt: now,
                updatedAt: now,
                slotCount: unici.length,
                late,
            }).onConflictDoUpdate({
                target: [salesWeekPlans.salesUserId, salesWeekPlans.weekStart],
                // submittedAt e late NON si toccano: sono la prova del primo
                // salvataggio, letta dal cron delle multe.
                set: { slotCount: unici.length, updatedAt: now },
            })
        })
    } catch (e) {
        console.error('saveCalendarWeek:', e)
        return { success: false, error: 'Salvataggio non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/mio-calendario')
    return { success: true, late }
}

/**
 * Blocca uno slot già dichiarato disponibile per un imprevisto (preavviso
 * minimo di un'ora, niente se c'è già un appuntamento: vedi `manualBlockCheck`).
 */
export async function blockSlot(
    slotIso: string,
    note?: string,
): Promise<{ success: boolean; error?: string }> {
    const { userId, role, ctx } = await requireSalesSession()
    if (role !== 'VENDITORE') {
        return { success: false, error: 'Solo i venditori bloccano il proprio calendario.' }
    }

    const slot = slotStartFor(new Date(slotIso))
    if (!slot) return { success: false, error: 'Ora fuori dal calendario.' }
    const slotEnd = new Date(slot.getTime() + 60 * 60_000)

    try {
        const [availRows, blockRows, apptRows] = await Promise.all([
            db.select({ slotStart: salesAvailabilitySlots.slotStart })
                .from(salesAvailabilitySlots)
                .where(and(
                    eq(salesAvailabilitySlots.companyId, ctx.companyId),
                    eq(salesAvailabilitySlots.salesUserId, userId),
                    eq(salesAvailabilitySlots.slotStart, slot),
                )).limit(1),
            db.select({ id: salesSlotBlocks.id })
                .from(salesSlotBlocks)
                .where(and(
                    eq(salesSlotBlocks.companyId, ctx.companyId),
                    eq(salesSlotBlocks.salesUserId, userId),
                    eq(salesSlotBlocks.slotStart, slot),
                )).limit(1),
            db.select({ id: leads.id })
                .from(leads)
                .where(and(
                    eq(leads.companyId, ctx.companyId),
                    eq(leads.salespersonUserId, userId),
                    gte(leads.appointmentDate, slot),
                    lt(leads.appointmentDate, slotEnd),
                )).limit(1),
        ])

        const decision = manualBlockCheck({
            slotStart: slot,
            now: new Date(),
            declared: availRows.length > 0,
            hasAppointment: apptRows.length > 0,
            alreadyBlocked: blockRows.length > 0,
        })
        if (!decision.ok) {
            return { success: false, error: blockRefusalMessage(decision.reason, slot) }
        }

        // Il doppio click e' un no-op, non un errore: la guardia vera e' l'indice
        // parziale a DB sales_slot_blocks_manual_uq (salesUserId, slotStart) WHERE
        // kind='MANUAL' (Task 2) — niente transazione qui, basta il conflitto.
        await db.insert(salesSlotBlocks).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            salesUserId: userId,
            slotStart: slot,
            kind: 'MANUAL',
            createdBy: userId,
            note: note ?? null,
        }).onConflictDoNothing()
    } catch (e) {
        console.error('blockSlot:', e)
        return { success: false, error: 'Blocco non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/mio-calendario')
    return { success: true }
}

/**
 * Toglie un blocco manuale. I blocchi `FOLLOWUP` non si toccano da qui: si
 * liberano spostando il follow-up o registrandone l'esito.
 */
export async function unblockSlot(slotIso: string): Promise<{ success: boolean; error?: string }> {
    const { userId, role, ctx } = await requireSalesSession()
    if (role !== 'VENDITORE') {
        return { success: false, error: 'Solo i venditori sbloccano il proprio calendario.' }
    }

    const slot = slotStartFor(new Date(slotIso))
    if (!slot) return { success: false, error: 'Ora fuori dal calendario.' }

    try {
        const [existing] = await db.select({ id: salesSlotBlocks.id, kind: salesSlotBlocks.kind })
            .from(salesSlotBlocks)
            .where(and(
                eq(salesSlotBlocks.companyId, ctx.companyId),
                eq(salesSlotBlocks.salesUserId, userId),
                eq(salesSlotBlocks.slotStart, slot),
            ))
            .limit(1)

        if (!existing) return { success: true }
        if (existing.kind === 'FOLLOWUP') {
            return { success: false, error: "Questo slot è occupato da un follow-up: spostalo o registrane l'esito." }
        }

        await db.delete(salesSlotBlocks).where(and(
            eq(salesSlotBlocks.companyId, ctx.companyId),
            eq(salesSlotBlocks.id, existing.id),
        ))
    } catch (e) {
        console.error('unblockSlot:', e)
        return { success: false, error: 'Sblocco non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/mio-calendario')
    return { success: true }
}
