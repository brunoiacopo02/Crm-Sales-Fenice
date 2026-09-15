"use server"

import crypto from "crypto"
import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { launchShifts, salesWeekPlans, users } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { romeInstant, weekStartKey } from "@/lib/venditore/calendarSlots"
import { LANCIO_COMPANY, LANCIO_WEBDEV, type ShiftKind } from "@/lib/lancio/config"
import { coperturaRows } from "@/lib/lancio/slots"
import { dayFactsFor, getShiftMembers, venditoreLabel } from "@/lib/lancio/shiftQueries"
import { findLancioBotId } from "@/lib/lancio/botAccount"
import { getLancioMonitor, type LancioMonitor } from "@/lib/lancio/monitor"

export type LancioAdminView = {
    config: { bucket: string; funnel: string; webinarAt: string; giornoDopo: string; dopodomani: string; oreVenditori: number[] }
    venditori: Array<{ id: string; name: string; calendarExempt: boolean }>
    shifts: { SERA: string[]; GIORNO_DOPO: string[] }
    copertura: Array<{ salesUserId: string; name: string; calendarExempt: boolean; compilato: boolean; oreDichiarate: number[]; oreLibere: number[] }>
    monitor: LancioMonitor
    /** false per il TL: legge la pagina ma non tocca i turni. */
    canEdit: boolean
}

const RUOLI_LETTURA = ['ADMIN', 'MANAGER', 'TL']
const RUOLI_SCRITTURA = ['ADMIN', 'MANAGER']

/**
 * Guard unica della pagina: ruolo + area sales + azienda Fenice.
 * La lettura arriva fino al TL (come /import), i turni li tocca solo
 * ADMIN/MANAGER. Il lancio è un'iniziativa Fenice: su un'altra azienda la
 * pagina non ha alcun significato e la guardia taglia corto.
 */
async function requireLancio(ruoli: string[]): Promise<{ userId: string; role: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = (user?.user_metadata?.role as string | undefined) ?? ''
    if (!user || !ruoli.includes(role)) throw new Error('Unauthorized')
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.companyId !== LANCIO_COMPANY) throw new Error('Il lancio è solo Fenice')
    return { userId: user.id, role }
}

export async function getLancioAdminView(): Promise<LancioAdminView> {
    const { role } = await requireLancio(RUOLI_LETTURA)
    const cfg = LANCIO_WEBDEV

    const venditoriRows = await db.select({
        id: users.id, name: users.name, displayName: users.displayName, calendarExempt: users.calendarExempt,
    }).from(users).where(and(eq(users.role, 'VENDITORE'), eq(users.isActive, true))).orderBy(users.name)
    const venditori = venditoriRows.map(v => ({ id: v.id, name: venditoreLabel(v), calendarExempt: v.calendarExempt }))

    const [sera, giornoDopo] = await Promise.all([
        getShiftMembers(db, 'SERA', cfg),
        getShiftMembers(db, 'GIORNO_DOPO', cfg),
    ])

    // Copertura delle ore dei venditori del giorno dopo, letta dal loro calendario.
    const facts = await dayFactsFor(db, giornoDopo, cfg.giornoDopo, { cfg })
    const weekKey = weekStartKey(romeInstant(cfg.giornoDopo, 12))
    const plans = giornoDopo.length > 0
        ? await db.select({ salesUserId: salesWeekPlans.salesUserId }).from(salesWeekPlans).where(and(
            inArray(salesWeekPlans.salesUserId, giornoDopo.map(m => m.salesUserId)),
            eq(salesWeekPlans.weekStart, weekKey),
        ))
        : []
    const copertura = coperturaRows({
        dateStr: cfg.giornoDopo,
        hours: cfg.oreVenditori,
        membri: giornoDopo,
        facts,
        compilati: new Set(plans.map(p => p.salesUserId)),
    })

    const monitor = await getLancioMonitor(LANCIO_COMPANY, await findLancioBotId(), cfg)

    return {
        config: {
            bucket: cfg.bucket, funnel: cfg.funnel, webinarAt: cfg.webinarAt,
            giornoDopo: cfg.giornoDopo, dopodomani: cfg.dopodomani, oreVenditori: cfg.oreVenditori,
        },
        venditori,
        shifts: { SERA: sera.map(m => m.salesUserId), GIORNO_DOPO: giornoDopo.map(m => m.salesUserId) },
        copertura,
        monitor,
        canEdit: RUOLI_SCRITTURA.includes(role),
    }
}

/**
 * Salva le spunte di un turno. Soft delete: chi esce prende removedAt, chi
 * rientra riattiva la riga che aveva (l'unique bucket+kind+salesUserId lo
 * impone) e tiene il suo lastAssignedAt, così il round robin non riparte da
 * capo per un giro di spunte. La storia dei turni è la tabella stessa.
 */
export async function saveLaunchShifts(kind: ShiftKind, salesUserIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const { userId } = await requireLancio(RUOLI_SCRITTURA)
    if (kind !== 'SERA' && kind !== 'GIORNO_DOPO') return { ok: false, error: 'Turno non valido' }
    const cfg = LANCIO_WEBDEV
    const wanted = new Set(salesUserIds)

    if (wanted.size > 0) {
        const validi = await db.select({ id: users.id }).from(users).where(and(
            eq(users.role, 'VENDITORE'), eq(users.isActive, true), inArray(users.id, [...wanted]),
        ))
        if (validi.length !== wanted.size) return { ok: false, error: 'Uno dei venditori selezionati non è un venditore attivo' }
    }

    const now = new Date()
    await db.transaction(async (tx) => {
        const existing = await tx.select({ id: launchShifts.id, salesUserId: launchShifts.salesUserId, removedAt: launchShifts.removedAt })
            .from(launchShifts).where(and(eq(launchShifts.bucket, cfg.bucket), eq(launchShifts.kind, kind)))
        const byUser = new Map(existing.map(r => [r.salesUserId, r]))

        for (const id of wanted) {
            const row = byUser.get(id)
            if (!row) {
                await tx.insert(launchShifts).values({
                    id: crypto.randomUUID(), companyId: LANCIO_COMPANY, bucket: cfg.bucket,
                    kind, salesUserId: id, createdBy: userId, createdAt: now,
                })
            } else if (row.removedAt) {
                await tx.update(launchShifts).set({ removedAt: null, removedBy: null, createdBy: userId }).where(eq(launchShifts.id, row.id))
            }
        }
        for (const row of existing) {
            if (!wanted.has(row.salesUserId) && !row.removedAt) {
                await tx.update(launchShifts).set({ removedAt: now, removedBy: userId }).where(eq(launchShifts.id, row.id))
            }
        }
    })
    revalidatePath('/lancio')
    return { ok: true }
}
