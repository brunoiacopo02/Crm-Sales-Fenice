/**
 * Query di copertura del calendario venditori.
 *
 * Nessuna direttiva "use server" di proposito: `weekCoverage` prende un
 * `TenantContext` già risolto, non un input serializzabile da form, quindi
 * non deve diventare una server action esposta al client. Vive qui (invece
 * che dentro `salesCalendarActions.ts`) perché il Task 9 (vista Conferme) e
 * il Task 10 (vista direzione) la richiamano da altri file di action: se
 * restasse una funzione privata di un modulo `"use server"` non sarebbe
 * riusabile da loro.
 *
 * NOTA SUL MULTI-TENANT — non "riparare" il filtro che sembra mancante.
 * `salesAvailabilitySlots` e `salesSlotBlocks` si leggono SENZA
 * `eq(companyId, …)`: sono tabelle PER-UTENTE, non per-azienda. I venditori
 * sono staff condiviso (tutti con `allowedCompanies = ['fenice','serenamente']`)
 * e dichiarano una disponibilità sola, valida ovunque; l'indice unico
 * `sales_availability_slot_uq (salesUserId, slotStart)` non contiene
 * `companyId` proprio per questo, e il cron le legge già senza filtro azienda.
 * Con `eq(companyId)` un venditore loggato su Serenamente vede il calendario
 * vuoto e la copertura a zero. `leads` invece resta giustamente scoped: gli
 * appuntamenti appartengono a un tenant.
 */

import { db } from "@/db"
import { leads, salesAvailabilitySlots, salesSlotBlocks } from "@/db/schema"
import { and, eq, gte, isNotNull, lt } from "drizzle-orm"
import type { TenantContext } from "@/lib/tenancy"
import { toRomeDateStr } from "@/lib/dateUtils"
import { slotKey, slotStartFor, weekSlots, weekStartFor } from "@/lib/venditore/calendarSlots"
import { buildCoverage, buildDemand, DEMAND_WEEKS, type CoverageCell } from "@/lib/venditore/calendarCoverage"

/**
 * Copertura per slot della settimana `weekStart` (lunedì 00:00 italiane).
 *
 * La domanda storica (per lo showRate/expectedPeople di ogni cella) guarda
 * sempre le `DEMAND_WEEKS` settimane intere precedenti la settimana CORRENTE,
 * mai quella richiesta: è una statistica storica e non deve cambiare
 * navigando avanti/indietro fra settimane future.
 */
export async function weekCoverage(ctx: TenantContext, weekStart: Date): Promise<CoverageCell[]> {
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000)
    const weekStartStr = toRomeDateStr(weekStart)

    const currentWeekStart = weekStartFor(new Date())
    const demandEnd = currentWeekStart
    const demandStart = new Date(currentWeekStart.getTime() - DEMAND_WEEKS * 7 * 86_400_000)

    const [availabilityRows, blockRows, appointmentRows, demandRows] = await Promise.all([
        db.select({
            salesUserId: salesAvailabilitySlots.salesUserId,
            slotStart: salesAvailabilitySlots.slotStart,
        }).from(salesAvailabilitySlots).where(
            // Per-utente, non per-azienda: vedi la nota in testa al file.
            eq(salesAvailabilitySlots.weekStart, weekStartStr),
        ),
        db.select({
            salesUserId: salesSlotBlocks.salesUserId,
            slotStart: salesSlotBlocks.slotStart,
        }).from(salesSlotBlocks).where(and(
            // Per-utente, non per-azienda: vedi la nota in testa al file.
            gte(salesSlotBlocks.slotStart, weekStart),
            lt(salesSlotBlocks.slotStart, weekEnd),
        )),
        db.select({
            salesUserId: leads.salespersonUserId,
            appointmentDate: leads.appointmentDate,
            leadId: leads.id,
            leadName: leads.name,
        }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.salespersonUserId),
            gte(leads.appointmentDate, weekStart),
            lt(leads.appointmentDate, weekEnd),
        )),
        db.select({
            appointmentDate: leads.appointmentDate,
            presentedAt: leads.presentedAt,
        }).from(leads).where(and(
            eq(leads.companyId, ctx.companyId),
            gte(leads.appointmentDate, demandStart),
            lt(leads.appointmentDate, demandEnd),
        )),
    ])

    const availability = availabilityRows.map(r => ({
        salesUserId: r.salesUserId,
        slotKey: slotKey(r.slotStart),
    }))
    const blocks = blockRows.map(r => ({
        salesUserId: r.salesUserId,
        slotKey: slotKey(r.slotStart),
    }))
    // Un appuntamento può cadere fuori dalla griglia oraria (raro, ma i dati
    // storici non lo garantiscono): slotStartFor torna null e lo scartiamo,
    // non deve far esplodere la copertura.
    const appointments = appointmentRows.flatMap(r => {
        if (!r.salesUserId || !r.appointmentDate) return []
        const slot = slotStartFor(r.appointmentDate)
        if (!slot) return []
        return [{ salesUserId: r.salesUserId, slotKey: slotKey(slot), leadId: r.leadId, leadName: r.leadName }]
    })
    const demand = buildDemand(
        demandRows
            .filter((r): r is { appointmentDate: Date; presentedAt: Date | null } => r.appointmentDate !== null)
            .map(r => ({ appointmentAt: r.appointmentDate, presented: !!r.presentedAt })),
        DEMAND_WEEKS,
    )

    return buildCoverage({ slots: weekSlots(weekStart), availability, blocks, appointments, demand })
}
