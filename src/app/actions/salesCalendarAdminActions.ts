"use server"

/**
 * Azioni sul calendario venditori per chi lo GUARDA da fuori (Conferme,
 * Direzione, Admin) invece di compilarlo (quello è `salesCalendarActions.ts`,
 * ad uso dei venditori stessi).
 *
 * Il Task 9 aggiunge `reportSalesAbsence`. Il Task 10 aggiungerà altre
 * funzioni per la vista Direzione e per l'annullamento delle multe
 * (`voidCalendarPenalty`): questo file è pensato per crescere, non per
 * restare a una funzione sola.
 */

import { db } from "@/db"
import { leads, users, salesAvailabilitySlots, salesSlotBlocks, salesLatePenalties, notifications } from "@/db/schema"
import { and, eq, gte, lt } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { slotStartFor } from "@/lib/venditore/calendarSlots"
import { absenceReportCheck, absenceRefusalMessage, CALENDAR_PENALTY_EUR } from "@/lib/venditore/calendarRules"
import { romeMonthKey } from "@/lib/venditore/latePenalties"
import { formatRomeAppointmentLabel } from "@/lib/dateUtils"
import { revalidatePath } from "next/cache"

/**
 * "Il venditore aveva lo slot libero e non c'era": multa da 50 €, subito.
 * L'admin può annullarla (voidCalendarPenalty): attrito zero per chi segnala,
 * controllo a posteriori per chi decide.
 */
export async function reportSalesAbsence(
    salesUserId: string,
    slotIso: string,
    note?: string,
): Promise<{ success: boolean; error?: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !role || !["CONFERME", "ADMIN"].includes(role)) {
        return { success: false, error: "Non autorizzato." }
    }
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const slot = slotStartFor(new Date(slotIso))
    if (!slot) return { success: false, error: "Ora fuori dal calendario." }
    const slotEnd = new Date(slot.getTime() + 3_600_000)

    const [venditore] = await db.select({ calendarExempt: users.calendarExempt, name: users.name })
        .from(users).where(eq(users.id, salesUserId))
    if (!venditore) return { success: false, error: "Venditore non trovato." }

    const [declared] = await db.select({ id: salesAvailabilitySlots.id })
        .from(salesAvailabilitySlots).where(and(
            eq(salesAvailabilitySlots.salesUserId, salesUserId),
            eq(salesAvailabilitySlots.slotStart, slot),
        ))
    const [blocked] = await db.select({ id: salesSlotBlocks.id })
        .from(salesSlotBlocks).where(and(
            eq(salesSlotBlocks.salesUserId, salesUserId),
            eq(salesSlotBlocks.slotStart, slot),
        ))
    const [reported] = await db.select({ id: salesLatePenalties.id })
        .from(salesLatePenalties).where(and(
            eq(salesLatePenalties.salesUserId, salesUserId),
            eq(salesLatePenalties.kind, 'ABSENT_SLOT'),
            eq(salesLatePenalties.dueAt, slot),
        ))

    const decision = absenceReportCheck({
        slotStart: slot,
        now: new Date(),
        declared: !!declared,
        blocked: !!blocked,
        exempt: venditore.calendarExempt,
        alreadyReported: !!reported,
    })
    if (!decision.ok) return { success: false, error: absenceRefusalMessage(decision.reason) }

    // Il lead dell'eventuale appuntamento in quello slot: serve a chi legge la
    // multa per capire quale appuntamento è saltato.
    const [appuntamento] = await db.select({ id: leads.id })
        .from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, salesUserId),
            gte(leads.appointmentDate, slot),
            lt(leads.appointmentDate, slotEnd),
        ))

    await db.insert(salesLatePenalties).values({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        salesUserId,
        leadId: appuntamento?.id ?? null,
        kind: 'ABSENT_SLOT',
        dueAt: slot,
        detectedAt: new Date(),
        amountEur: CALENDAR_PENALTY_EUR,
        monthKey: romeMonthKey(slot),
        reportedBy: user.id,
        note: note || null,
    }).onConflictDoNothing()

    await db.insert(notifications).values({
        id: crypto.randomUUID(),
        recipientUserId: salesUserId,
        type: 'calendar_penalty',
        title: 'Multa: assenza su slot disponibile',
        body: `Segnalata assenza ${formatRomeAppointmentLabel(slot)}: trattenuta di ${CALENDAR_PENALTY_EUR} €.`,
        metadata: { slot: slot.toISOString() },
        companyId: ctx.companyId,
    })

    revalidatePath('/conferme')
    revalidatePath('/calendari-venditori')
    return { success: true }
}
