"use server"

import crypto from "crypto"
import { and, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/db"
import { launchShifts, leads, salesAttempts, salesWeekPlans, users } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { romeInstant, weekStartKey } from "@/lib/venditore/calendarSlots"
import { LANCIO_COMPANY, LANCIO_WEBDEV, type ShiftKind } from "@/lib/lancio/config"
import { coperturaRows } from "@/lib/lancio/slots"
import { dayFactsFor, getShiftMembers, venditoreLabel } from "@/lib/lancio/shiftQueries"
import { findLancioBotId } from "@/lib/lancio/botAccount"
import { getLancioMonitor, type LancioMonitor } from "@/lib/lancio/monitor"
import { CONFERME_DISCARD_RESET } from "@/lib/confermeReset"
import { callNowColumn, isInCallNowCycle, nextCallNowState, CALL_NOW_TAB_WINDOW_MS, type CallNowColumn } from "@/lib/lancio/callNow"
import { IN_CALL_NOW_CYCLE } from "@/lib/lancio/callNowSql"
import { notifyConfermeLancio } from "@/lib/lancio/booking"
import { countCycleNonClosed } from "@/lib/venditorePerformance/guard"
import { logLeadEvent } from "@/lib/eventLogger"

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

// ── Scheda venditore "Lancio: chiamate subito" (spec 2026-09-14 §4.4) ────────

export type LancioCallNowLead = {
    id: string; name: string; phone: string; email: string | null; funnel: string | null
    lancioSceltaAt: string | null; lancioCallNowAttempts: number; lancioCallNowNextAt: string | null
    lancioBotInfo: { risposte?: string[] } | null; appointmentNote: string | null
    negotiationStartedAt: string | null; salespersonOutcome: string | null; appointmentDate: string | null
    version: number; priorNonClosedCount: number; attemptCount: number; column: CallNowColumn
}

/**
 * Guardia della scheda: il venditore vede e tocca SOLO i propri lead.
 * MANAGER/ADMIN possono leggere la scheda di chiunque (supporto nella serata
 * di lancio); il vincolo di proprietà sulla scrittura resta comunque sul lead.
 */
async function requireVenditoreOrStaff(sellerId: string): Promise<{ userId: string; isStaff: boolean; companyId: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role ?? '')) throw new Error('Unauthorized')
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = role === 'MANAGER' || role === 'ADMIN'
    if (!isStaff && sellerId !== user.id) throw new Error('Forbidden')
    return { userId: user.id, isStaff, companyId: ctx.companyId }
}

/**
 * I lead "chiamata subito" del venditore, con la colonna della scheda già
 * calcolata.
 *
 * Tre limiti, oltre alla proprietà del lead:
 *  - il bucket del lancio: la scheda non pesca da altre iniziative;
 *  - le ultime 72 ore (`CALL_NOW_TAB_WINDOW_MS`): il lancio è una sera, e la
 *    tab deve sparire da sola quando è finita;
 *  - o ciclo aperto, o un esito: un lead con tre NR alle spalle che le Conferme
 *    hanno ri-confermato e riassegnato è un appuntamento normale, e nella
 *    scheda non ci torna.
 */
export async function getVenditoreLancioLeads(sellerId: string): Promise<LancioCallNowLead[]> {
    const { companyId } = await requireVenditoreOrStaff(sellerId)
    const finestra = new Date(Date.now() - CALL_NOW_TAB_WINDOW_MS)
    const rows = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel,
        lancioSceltaAt: leads.lancioSceltaAt, lancioCallNowAttempts: leads.lancioCallNowAttempts, lancioCallNowNextAt: leads.lancioCallNowNextAt,
        lancioBotInfo: leads.lancioBotInfo, appointmentNote: leads.appointmentNote,
        negotiationStartedAt: leads.negotiationStartedAt, salespersonOutcome: leads.salespersonOutcome, appointmentDate: leads.appointmentDate,
        version: leads.version, salesCycleStartAt: leads.salesCycleStartAt,
    }).from(leads).where(and(
        eq(leads.companyId, companyId),
        eq(leads.salespersonUserId, sellerId),
        eq(leads.lancioScelta, 'chiamata_subito'),
        eq(leads.launchBucket, LANCIO_WEBDEV.bucket),
        gte(leads.lancioSceltaAt, finestra),
        // Colonne da chiamare + colonna Esitati, niente altro.
        or(IN_CALL_NOW_CYCLE, isNotNull(leads.salespersonOutcome)),
    )).orderBy(desc(leads.lancioSceltaAt))

    const ids = rows.map(r => r.id)
    const attempts = ids.length
        ? await db.select({ leadId: salesAttempts.leadId, outcome: salesAttempts.outcome, outcomeAt: salesAttempts.outcomeAt })
            .from(salesAttempts).where(and(eq(salesAttempts.companyId, companyId), inArray(salesAttempts.leadId, ids)))
        : []
    const byLead = new Map<string, { outcome: string; outcomeAt: Date | null }[]>()
    for (const a of attempts) byLead.set(a.leadId, [...(byLead.get(a.leadId) ?? []), a])

    const iso = (d: Date | null) => (d ? d.toISOString() : null)
    return rows.map(r => {
        const arr = byLead.get(r.id) ?? []
        return {
            id: r.id, name: r.name, phone: r.phone, email: r.email, funnel: r.funnel,
            lancioSceltaAt: iso(r.lancioSceltaAt), lancioCallNowAttempts: r.lancioCallNowAttempts ?? 0, lancioCallNowNextAt: iso(r.lancioCallNowNextAt),
            lancioBotInfo: (r.lancioBotInfo as { risposte?: string[] } | null) ?? null, appointmentNote: r.appointmentNote,
            negotiationStartedAt: iso(r.negotiationStartedAt), salespersonOutcome: r.salespersonOutcome, appointmentDate: iso(r.appointmentDate),
            version: r.version, attemptCount: arr.length,
            priorNonClosedCount: countCycleNonClosed(arr, r.salesCycleStartAt ?? null),
            column: callNowColumn({ lancioCallNowAttempts: r.lancioCallNowAttempts ?? 0, salespersonOutcome: r.salespersonOutcome }),
        }
    })
}

/**
 * "Non risponde" sulla chiamata subito: +1 tentativo e richiamo fra 30 minuti;
 * al terzo passa alle Conferme il giorno dopo (A1): venditore azzerato, esito
 * Conferme azzerato, appuntamento alle 09:00, badge LANCIO in board.
 */
export async function recordLancioCallNowNoAnswer(leadId: string): Promise<{ ok: true; handoff: boolean } | { ok: false; error: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role ?? '')) return { ok: false, error: 'Unauthorized' }
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = role === 'MANAGER' || role === 'ADMIN'

    const [lead] = await db.select().from(leads).where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId))).limit(1)
    if (!lead) return { ok: false, error: 'Lead non trovato' }
    if (lead.lancioScelta !== 'chiamata_subito') return { ok: false, error: 'Non è una chiamata subito del lancio' }
    if (!isStaff && lead.salespersonUserId !== user.id) return { ok: false, error: 'Lead di un altro venditore' }
    if (lead.salespersonOutcome) return { ok: false, error: 'Il lead ha già un esito' }
    if (!lead.salespersonUserId) return { ok: false, error: 'Lead già passato alle Conferme' }
    // Ciclo già chiuso (tre NR spesi) su un lead che le Conferme hanno
    // ri-confermato e riassegnato: è tornato un appuntamento normale, il "Non
    // risponde" della serata non lo riguarda e non deve rispedirlo alle Conferme.
    if (!isInCallNowCycle(lead)) return { ok: false, error: 'Il ciclo delle chiamate subito è chiuso per questo lead' }

    const now = new Date()
    const next = nextCallNowState(lead.lancioCallNowAttempts ?? 0, now)
    const previousSeller = lead.salespersonUserId

    if (next.kind === 'retry') {
        const updated = await db.update(leads).set({
            lancioCallNowAttempts: next.attempts,
            lancioCallNowNextAt: next.nextAt,
            lastCallDate: now,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version))).returning({ id: leads.id })
        // Doppio click o due schede aperte: la versione è già cambiata sotto i
        // piedi e il tentativo è già stato contato. Non si scrive l'evento due
        // volte, e al venditore non si dice che è andato tutto bene.
        if (updated.length === 0) return { ok: false, error: 'Tentativo già registrato: ricarica la scheda' }
    } else {
        // Terzo NR: il lead esce dal venditore e rientra nella board Conferme,
        // che filtra `confirmationsOutcome IS NULL` + `status='APPOINTMENT'`.
        // L'azzeramento Conferme è incondizionato: la chiamata subito era stata
        // marcata `confermato` dal bot e senza reset nessuno la rivedrebbe.
        const updated = await db.update(leads).set({
            ...CONFERME_DISCARD_RESET,
            lancioCallNowAttempts: next.attempts,
            lancioCallNowNextAt: null,
            lastCallDate: now,
            appointmentDate: next.appointmentAt,
            salespersonUserId: null,
            salespersonAssigned: null,
            salespersonAssignedAt: null,
            negotiationStartedAt: null,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version))).returning({ id: leads.id })
        if (updated.length === 0) return { ok: false, error: 'Tentativo già registrato: ricarica la scheda' }
    }

    // Prima il registro della chiamata, poi la notifica alle Conferme: il
    // tentativo è già scritto sul lead, e un log che fallisce non deve far
    // credere al venditore che il "Non risponde" non sia passato. Nessuno dei
    // due fa fallire l'azione: il log è avvolto qui sotto, e
    // `notifyConfermeLancio` si mangia da sé i propri errori (non rilancia).
    try {
        await logLeadEvent({
            leadId, eventType: 'CALL_LOGGED', userId: user.id, companyId: ctx.companyId,
            metadata: { source: 'lancio_call_now', outcome: 'NON_RISPOSTO', attempts: next.attempts, handoff: next.kind === 'handoff', previousSeller },
        })
    } catch (e) {
        console.error('[lancio] log CALL_LOGGED fallito', e)
    }
    if (next.kind === 'handoff') {
        await notifyConfermeLancio({ id: lead.id, name: lead.name }, next.appointmentAt, '🚀 Lancio: 3 NR dal venditore, da richiamare')
    }
    revalidatePath('/venditore')
    return { ok: true, handoff: next.kind === 'handoff' }
}
