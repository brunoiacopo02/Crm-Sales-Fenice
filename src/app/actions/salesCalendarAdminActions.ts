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
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm"
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

    try {
        // Staff condiviso multi-tenant: stesso pattern di getVenditoriAgenda
        // (allowedCompanies). Senza questo filtro un salesUserId di un'altra
        // azienda passerebbe comunque, e la multa/notifica finirebbero scritte
        // con il companyId di chi chiama invece che con quello vero del
        // venditore: un buco di isolamento fra tenant, non una svista.
        const tenantScope = or(
            sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
            and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
        )

        const [venditore] = await db.select({ calendarExempt: users.calendarExempt, name: users.name })
            .from(users).where(and(eq(users.id, salesUserId), tenantScope))
        if (!venditore) return { success: false, error: "Venditore non trovato." }

        const [declared] = await db.select({ id: salesAvailabilitySlots.id })
            .from(salesAvailabilitySlots).where(and(
                eq(salesAvailabilitySlots.companyId, ctx.companyId),
                eq(salesAvailabilitySlots.salesUserId, salesUserId),
                eq(salesAvailabilitySlots.slotStart, slot),
            ))
        const [blocked] = await db.select({ id: salesSlotBlocks.id })
            .from(salesSlotBlocks).where(and(
                eq(salesSlotBlocks.companyId, ctx.companyId),
                eq(salesSlotBlocks.salesUserId, salesUserId),
                eq(salesSlotBlocks.slotStart, slot),
            ))
        const [reported] = await db.select({ id: salesLatePenalties.id })
            .from(salesLatePenalties).where(and(
                eq(salesLatePenalties.companyId, ctx.companyId),
                eq(salesLatePenalties.salesUserId, salesUserId),
                eq(salesLatePenalties.kind, 'ABSENT_SLOT'),
                eq(salesLatePenalties.dueAt, slot),
                // Stesso insieme di fatti di reportedSlots (confermeActions.ts):
                // una riga annullata dall'admin non deve bloccare una nuova
                // segnalazione legittima per sempre.
                isNull(salesLatePenalties.voidedAt),
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

        const inserted = await db.insert(salesLatePenalties).values({
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
        }).onConflictDoNothing().returning({ id: salesLatePenalties.id })

        // Se onConflictDoNothing non ha scritto nulla (corsa fra due
        // segnalazioni sullo stesso slot), la multa esiste già: niente
        // seconda notifica "hai preso una multa da 50 €" per una multa sola.
        if (inserted.length > 0) {
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: salesUserId,
                type: 'calendar_penalty',
                title: 'Multa: assenza su slot disponibile',
                body: `Segnalata assenza ${formatRomeAppointmentLabel(slot)}: trattenuta di ${CALENDAR_PENALTY_EUR} €.`,
                metadata: { slot: slot.toISOString() },
                companyId: ctx.companyId,
            })
        }

        revalidatePath('/conferme')
        revalidatePath('/calendari-venditori')
        return { success: true }
    } catch (e) {
        console.error('reportSalesAbsence:', e)
        return { success: false, error: 'Segnalazione non riuscita: riprova fra un momento.' }
    }
}
