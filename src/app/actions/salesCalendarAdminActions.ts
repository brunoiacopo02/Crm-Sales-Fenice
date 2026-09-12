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
import { leads, users, salesAvailabilitySlots, salesSlotBlocks, salesWeekPlans, salesLatePenalties, notifications } from "@/db/schema"
import { and, eq, gte, lt, or, sql, isNull, desc } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea, type TenantContext } from "@/lib/tenancy"
import { slotStartFor, slotKey, weekStartFor, weeklyDeadline } from "@/lib/venditore/calendarSlots"
import { absenceReportCheck, absenceRefusalMessage, CALENDAR_PENALTY_EUR, type CalendarPenaltyKind } from "@/lib/venditore/calendarRules"
import { romeMonthKey } from "@/lib/venditore/latePenalties"
import { formatRomeAppointmentLabel, toRomeDateStr } from "@/lib/dateUtils"
import { weekCoverage } from "@/lib/venditore/calendarQueries"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"
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
                // Conta anche le multe annullate: l'annullamento e' una decisione
                // dell'admin su quello slot, non una cancellazione. Contarle e'
                // anche cio' che tiene il controllo allineato all'indice unico,
                // che non distingue le righe annullate: senza, l'inserimento
                // verrebbe assorbito e risponderemmo "fatto" senza fare nulla.
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

/**
 * Filtro di appartenenza per lo staff venditori condiviso fra aziende
 * (`allowedCompanies`): stesso pattern di `getVenditoriAgenda`/`activeVenditori`.
 * Un `eq(companyId)` secco svuota la pagina su Serenamente.
 */
function venditoreTenantScope(ctx: TenantContext) {
    return or(
        sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
        and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
    )
}

/**
 * Guardia della vista Direzione. CONFERME guarda in sola lettura (e senza la
 * scheda Multe: spec §6.2); ADMIN e MANAGER vedono tutto, ma solo ADMIN può
 * annullare una multa o cambiare l'esenzione (spec §7) — `canWrite` riflette
 * esattamente questo, non un generico "ruolo gestionale".
 */
async function requireCalendarSupervisor(): Promise<{ userId: string; role: string; canWrite: boolean; ctx: TenantContext }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !role || !["ADMIN", "MANAGER", "CONFERME"].includes(role)) {
        throw new Error("Unauthorized")
    }
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    return { userId: user.id, role, canWrite: role === 'ADMIN', ctx }
}

export interface SupervisionView {
    weekStartIso: string
    coverage: CoverageCell[]
    venditori: Array<{ id: string; name: string; calendarExempt: boolean }>
    matrix: Array<{ salesUserId: string; slotKeys: string[] }>
    compilation: Array<{
        salesUserId: string
        submittedAtIso: string | null
        slotCount: number
        late: boolean
        penalised: boolean
    }>
    penalties: Array<{
        id: string
        salesUserId: string
        kind: CalendarPenaltyKind
        dueAt: string
        amountEur: number
        note: string | null
        reportedByName: string | null
        voidedAtIso: string | null
        voidReason: string | null
        leadName: string | null
    }>
    monthKey: string
    totalEur: number
}

/**
 * Vista completa di supervisione: stessa `weekCoverage` delle altre due
 * schermate (mai un secondo calcolo), più compilazione e multe del mese
 * richiesto (default: il mese corrente).
 */
export async function getCalendarSupervision(
    weekStartIso?: string,
    monthKeyInput?: string,
): Promise<SupervisionView> {
    const { ctx } = await requireCalendarSupervisor()

    const weekStart = weekStartIso ? weekStartFor(new Date(weekStartIso)) : weekStartFor(new Date())
    const weekStartStr = toRomeDateStr(weekStart)
    const deadline = weeklyDeadline(weekStart)
    const monthKey = monthKeyInput || romeMonthKey(new Date())

    const [coverage, venditoriRows, availRows, planRows, missingRows, penaltyRows] = await Promise.all([
        weekCoverage(ctx, weekStart),
        db.select({
            id: users.id,
            name: users.name,
            displayName: users.displayName,
            calendarExempt: users.calendarExempt,
        }).from(users).where(and(
            venditoreTenantScope(ctx),
            eq(users.role, 'VENDITORE'),
            eq(users.isActive, true),
        )).orderBy(users.name),
        db.select({
            salesUserId: salesAvailabilitySlots.salesUserId,
            slotStart: salesAvailabilitySlots.slotStart,
        }).from(salesAvailabilitySlots).where(and(
            eq(salesAvailabilitySlots.companyId, ctx.companyId),
            eq(salesAvailabilitySlots.weekStart, weekStartStr),
        )),
        db.select({
            salesUserId: salesWeekPlans.salesUserId,
            submittedAt: salesWeekPlans.submittedAt,
            slotCount: salesWeekPlans.slotCount,
            late: salesWeekPlans.late,
        }).from(salesWeekPlans).where(and(
            eq(salesWeekPlans.companyId, ctx.companyId),
            eq(salesWeekPlans.weekStart, weekStartStr),
        )),
        // Chi ha già la multa "calendario non compilato" per QUESTA scadenza
        // (annullate escluse): serve solo alla pastiglia "Multa" della scheda
        // Compilazione, indipendente dal monthKey della scheda Multe.
        db.select({ salesUserId: salesLatePenalties.salesUserId })
            .from(salesLatePenalties).where(and(
                eq(salesLatePenalties.companyId, ctx.companyId),
                eq(salesLatePenalties.kind, 'CALENDAR_MISSING'),
                eq(salesLatePenalties.dueAt, deadline),
                isNull(salesLatePenalties.voidedAt),
            )),
        // `leftJoin` su leads: le multe CALENDAR_MISSING non hanno lead e
        // sparirebbero con un innerJoin (lo stesso bug che il Task 11 corregge
        // altrove — non va introdotto qui).
        db.select({
            id: salesLatePenalties.id,
            salesUserId: salesLatePenalties.salesUserId,
            kind: salesLatePenalties.kind,
            dueAt: salesLatePenalties.dueAt,
            amountEur: salesLatePenalties.amountEur,
            note: salesLatePenalties.note,
            voidedAt: salesLatePenalties.voidedAt,
            voidReason: salesLatePenalties.voidReason,
            leadName: leads.name,
            reporterName: users.name,
            reporterDisplayName: users.displayName,
        }).from(salesLatePenalties)
            .leftJoin(leads, eq(salesLatePenalties.leadId, leads.id))
            .leftJoin(users, eq(salesLatePenalties.reportedBy, users.id))
            .where(and(
                eq(salesLatePenalties.companyId, ctx.companyId),
                or(
                    eq(salesLatePenalties.kind, 'CALENDAR_MISSING'),
                    eq(salesLatePenalties.kind, 'ABSENT_SLOT'),
                ),
                eq(salesLatePenalties.monthKey, monthKey),
            ))
            .orderBy(desc(salesLatePenalties.dueAt)),
    ])

    const venditori = venditoriRows.map(v => ({
        id: v.id,
        name: v.displayName || v.name || 'Venditore',
        calendarExempt: v.calendarExempt,
    }))

    const declaredByUser = new Map<string, string[]>()
    for (const row of availRows) {
        const arr = declaredByUser.get(row.salesUserId) ?? []
        arr.push(slotKey(row.slotStart))
        declaredByUser.set(row.salesUserId, arr)
    }
    const matrix = venditori.map(v => ({ salesUserId: v.id, slotKeys: declaredByUser.get(v.id) ?? [] }))

    const planByUser = new Map(planRows.map(p => [p.salesUserId, p]))
    const missingSet = new Set(missingRows.map(r => r.salesUserId))
    const compilation = venditori.map(v => {
        const plan = planByUser.get(v.id)
        return {
            salesUserId: v.id,
            submittedAtIso: plan?.submittedAt ? plan.submittedAt.toISOString() : null,
            slotCount: plan?.slotCount ?? 0,
            late: plan?.late ?? false,
            penalised: missingSet.has(v.id),
        }
    })
    // Prima i non compilati: sono il motivo per cui qualcuno apre questa scheda.
    compilation.sort((a, b) => {
        if (!a.submittedAtIso && b.submittedAtIso) return -1
        if (a.submittedAtIso && !b.submittedAtIso) return 1
        return 0
    })

    const penalties = penaltyRows.map(r => ({
        id: r.id,
        salesUserId: r.salesUserId,
        kind: r.kind as CalendarPenaltyKind,
        dueAt: r.dueAt.toISOString(),
        amountEur: r.amountEur,
        note: r.note,
        reportedByName: r.reporterDisplayName || r.reporterName || null,
        voidedAtIso: r.voidedAt ? r.voidedAt.toISOString() : null,
        voidReason: r.voidReason,
        leadName: r.leadName,
    }))
    // I totali escludono sempre le righe annullate: non è un filtro di vista,
    // è il vincolo di prodotto sull'annullamento (spec §7).
    const totalEur = penalties.reduce((sum, p) => sum + (p.voidedAtIso ? 0 : p.amountEur), 0)

    return {
        weekStartIso: weekStart.toISOString(),
        coverage,
        venditori,
        matrix,
        compilation,
        penalties,
        monthKey,
        totalEur,
    }
}

/**
 * Annulla una multa calendario. Definitivo per quello slot (decisione Task 9):
 * non esiste un `voidCalendarPenalty(..., false)` che la riapra.
 */
export async function voidCalendarPenalty(
    penaltyId: string,
    reason: string,
): Promise<{ success: boolean; error?: string }> {
    const { userId, role, ctx } = await requireCalendarSupervisor()
    if (role !== 'ADMIN') return { success: false, error: 'Non autorizzato.' }

    const trimmed = reason?.trim()
    if (!trimmed) return { success: false, error: 'Serve un motivo.' }

    try {
        const [existing] = await db.select({
            id: salesLatePenalties.id,
            voidedAt: salesLatePenalties.voidedAt,
        }).from(salesLatePenalties).where(and(
            eq(salesLatePenalties.id, penaltyId),
            eq(salesLatePenalties.companyId, ctx.companyId),
        )).limit(1)

        if (!existing) return { success: false, error: 'Multa non trovata.' }
        if (existing.voidedAt) return { success: false, error: 'Multa già annullata.' }

        await db.update(salesLatePenalties).set({
            voidedAt: new Date(),
            voidedBy: userId,
            voidReason: trimmed,
        }).where(and(
            eq(salesLatePenalties.id, penaltyId),
            eq(salesLatePenalties.companyId, ctx.companyId),
        ))
    } catch (e) {
        console.error('voidCalendarPenalty:', e)
        return { success: false, error: 'Annullamento non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/calendari-venditori')
    return { success: true }
}

/**
 * Esenzione dall'obbligo di calendario. Solo ADMIN (spec §7): niente multe
 * automatiche né segnalabilità di assenza per chi è esente.
 */
export async function setCalendarExempt(
    salesUserId: string,
    exempt: boolean,
): Promise<{ success: boolean; error?: string }> {
    const { role, ctx } = await requireCalendarSupervisor()
    if (role !== 'ADMIN') return { success: false, error: 'Non autorizzato.' }

    try {
        const updated = await db.update(users).set({ calendarExempt: exempt }).where(and(
            eq(users.id, salesUserId),
            eq(users.role, 'VENDITORE'),
            venditoreTenantScope(ctx),
        )).returning({ id: users.id })

        if (updated.length === 0) return { success: false, error: 'Venditore non trovato.' }
    } catch (e) {
        console.error('setCalendarExempt:', e)
        return { success: false, error: 'Aggiornamento non riuscito: riprova fra un momento.' }
    }

    revalidatePath('/calendari-venditori')
    revalidatePath('/mio-calendario')
    return { success: true }
}
