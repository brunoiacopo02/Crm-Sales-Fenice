/**
 * Letture DB dei turni del lancio e della disponibilità dei venditori di turno.
 * Nessuna decisione qui: i fatti letti vanno ai moduli puri (slots.ts).
 *
 * MULTI-TENANT: salesAvailabilitySlots/salesSlotBlocks sono per-utente e la
 * "occupazione" di un venditore vale su ogni azienda (vedi la nota in
 * schema.ts sopra salesAvailabilitySlots e checkBookingAllowed): nessuna delle
 * tre letture filtra companyId. Non "ripararlo". Il companyId resta solo dove
 * la riga appartiene davvero a un tenant: il turno (`launchShifts`). Su `users`
 * NON si filtra — i venditori sono staff condiviso (vedi getShiftMembers).
 */
import { db } from '@/db'
import { launchShifts, leads, salesAvailabilitySlots, salesSlotBlocks, users } from '@/db/schema'
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { romeInstant, slotKey } from '@/lib/venditore/calendarSlots'
import { LANCIO_COMPANY, LANCIO_WEBDEV, type LancioConfig, type ShiftKind } from './config'
import { declaredHoursFor, type ShiftMember, type VenditoreDayFacts } from './slots'

export type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface ShiftMemberRow extends ShiftMember {
    name: string
    calendarExempt: boolean
}

export function venditoreLabel(u: { name: string | null; displayName: string | null }): string {
    return u.displayName || u.name || 'Venditore'
}

/**
 * Venditori attivi del turno, nell'ordine del round robin.
 *
 * `companyId` è l'unico filtro di tenant di questo file, e ci sta perché un
 * turno appartiene al lancio di quell'azienda. Su `users` si filtra solo
 * isActive + ruolo: i venditori sono staff condiviso, `users.companyId` è la
 * provenienza dell'account, non chi può lavorare il lancio.
 */
export async function getShiftMembers(
    tx: Db,
    kind: ShiftKind,
    cfg: LancioConfig = LANCIO_WEBDEV,
): Promise<ShiftMemberRow[]> {
    const rows = await tx.select({
        salesUserId: launchShifts.salesUserId,
        lastAssignedAt: launchShifts.lastAssignedAt,
        name: users.name,
        displayName: users.displayName,
        calendarExempt: users.calendarExempt,
    }).from(launchShifts)
        .innerJoin(users, eq(users.id, launchShifts.salesUserId))
        .where(and(
            eq(launchShifts.companyId, LANCIO_COMPANY),
            eq(launchShifts.bucket, cfg.bucket),
            eq(launchShifts.kind, kind),
            isNull(launchShifts.removedAt),
            eq(users.isActive, true),
            eq(users.role, 'VENDITORE'),
        ))
        .orderBy(asc(sql`coalesce(${launchShifts.lastAssignedAt}, 'epoch'::timestamptz)`), asc(launchShifts.salesUserId))
    return rows.map(r => ({
        salesUserId: r.salesUserId,
        lastAssignedAt: r.lastAssignedAt,
        name: venditoreLabel(r),
        calendarExempt: r.calendarExempt,
    }))
}

/**
 * Dichiarati / bloccati / occupati del giorno italiano `dateStr` per i venditori dati.
 *
 * Una query per tabella (`inArray` su tutti i membri): il numero di letture non
 * cresce col numero di venditori di turno.
 *
 * `excludeLeadId` esclude dalle ore occupate l'appuntamento del lead che si sta
 * prenotando: senza, uno spostamento d'ora si scontrerebbe con sé stesso
 * (stessa esclusione di `checkBookingAllowed`).
 */
export async function dayFactsFor(
    tx: Db,
    members: Array<ShiftMember & { calendarExempt?: boolean | null }>,
    dateStr: string,
    opts: { excludeLeadId?: string | null; cfg?: LancioConfig } = {},
): Promise<VenditoreDayFacts[]> {
    if (members.length === 0) return []
    const cfg = opts.cfg ?? LANCIO_WEBDEV
    const ids = members.map(m => m.salesUserId)
    const dayStart = romeInstant(dateStr, 0)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    const [declared, blocked, busy] = await Promise.all([
        tx.select({ salesUserId: salesAvailabilitySlots.salesUserId, slotStart: salesAvailabilitySlots.slotStart })
            .from(salesAvailabilitySlots).where(and(
                inArray(salesAvailabilitySlots.salesUserId, ids),
                gte(salesAvailabilitySlots.slotStart, dayStart),
                lt(salesAvailabilitySlots.slotStart, dayEnd),
            )),
        tx.select({ salesUserId: salesSlotBlocks.salesUserId, slotStart: salesSlotBlocks.slotStart })
            .from(salesSlotBlocks).where(and(
                inArray(salesSlotBlocks.salesUserId, ids),
                gte(salesSlotBlocks.slotStart, dayStart),
                lt(salesSlotBlocks.slotStart, dayEnd),
            )),
        tx.select({ salesUserId: leads.salespersonUserId, appointmentDate: leads.appointmentDate })
            .from(leads).where(and(
                inArray(leads.salespersonUserId, ids),
                isNotNull(leads.appointmentDate),
                gte(leads.appointmentDate, dayStart),
                lt(leads.appointmentDate, dayEnd),
                ...(opts.excludeLeadId ? [ne(leads.id, opts.excludeLeadId)] : []),
            )),
    ])

    // Le ore dichiarate si raccolgono a parte perché un esente le riceve
    // d'ufficio (vedi declaredHoursFor): bloccati e occupati no.
    const declaredKeys = new Map<string, string[]>()
    for (const id of ids) declaredKeys.set(id, [])
    for (const r of declared) declaredKeys.get(r.salesUserId)?.push(slotKey(r.slotStart))

    const facts = new Map<string, VenditoreDayFacts>()
    for (const m of members) {
        facts.set(m.salesUserId, {
            salesUserId: m.salesUserId,
            lastAssignedAt: m.lastAssignedAt,
            declared: declaredHoursFor(m, declaredKeys.get(m.salesUserId) ?? [], { dateStr, hours: cfg.oreVenditori }),
            blocked: new Set<string>(),
            busy: new Set<string>(),
        })
    }
    for (const r of blocked) facts.get(r.salesUserId)?.blocked.add(slotKey(r.slotStart))
    for (const r of busy) if (r.salesUserId && r.appointmentDate) facts.get(r.salesUserId)?.busy.add(slotKey(r.appointmentDate))
    return [...facts.values()]
}
