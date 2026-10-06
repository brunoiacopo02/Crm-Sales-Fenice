"use server"

import crypto from "crypto"
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm"
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
import { callNowColumn, destinazioneTerzoNr, isInCallNowCycle, nextCallNowState, CALL_NOW_TAB_WINDOW_MS, type CallNowColumn } from "@/lib/lancio/callNow"
import { IN_CALL_NOW_CYCLE } from "@/lib/lancio/callNowSql"
import { notifyConfermeLancio } from "@/lib/lancio/booking"
import { countCycleNonClosed } from "@/lib/venditorePerformance/guard"
import { logLeadEvent } from "@/lib/eventLogger"
import { isLancioLiberoLead } from "@/lib/lancio/liberi"
import { NOT_CLOSED_REASONS } from "@/lib/surveys/questions"
import { saveVenditoreOutcome } from "@/app/actions/venditoreActions"

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
    lancioBotInfo: { risposte?: string[]; richiamo?: { at: string; nota?: string | null } } | null; appointmentNote: string | null
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
        // Oltre le 72 ore resta visibile chi ha un richiamo ancora da fare (PO 06/10).
        or(gte(leads.lancioSceltaAt, finestra), sql`${leads.lancioBotInfo}->'richiamo' is not null and ${leads.salespersonOutcome} is null`),
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
            lancioBotInfo: (r.lancioBotInfo as LancioCallNowLead['lancioBotInfo']) ?? null, appointmentNote: r.appointmentNote,
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
export async function recordLancioCallNowNoAnswer(leadId: string): Promise<{ ok: true; handoff: boolean; verso?: 'conferme' | 'pool' } | { ok: false; error: string }> {
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
        // Un "Non risponde" chiude anche l'eventuale richiamo: vale il nuovo +30 minuti.
        const info = { ...((lead.lancioBotInfo as Record<string, unknown> | null) ?? {}) }
        delete info.richiamo
        const updated = await db.update(leads).set({
            lancioBotInfo: info,
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
    } else if (destinazioneTerzoNr(lead) === 'pool') {
        // Terzo NR su un lead dato dall'admin senza appuntamento (PO 06/10): torna
        // nel pool GDO del lancio su /import, come una restituzione del bot.
        const updated = await db.update(leads).set({
            lancioCallNowAttempts: next.attempts,
            lancioCallNowNextAt: null,
            lastCallDate: now,
            salespersonUserId: null,
            salespersonAssigned: null,
            salespersonAssignedAt: null,
            negotiationStartedAt: null,
            assignedToId: null,
            status: 'NEW',
            callCount: 0,
            recallDate: null,
            recallNote: null,
            recallMissedAt: null,
            version: lead.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version))).returning({ id: leads.id })
        if (updated.length === 0) return { ok: false, error: 'Tentativo già registrato: ricarica la scheda' }
        try {
            await logLeadEvent({
                leadId, eventType: 'LANCIO_RETURNED_TO_POOL', userId: user.id, companyId: ctx.companyId,
                metadata: { motivo: 'venditore_tre_nr', fromSalesUserId: previousSeller, bucket: LANCIO_WEBDEV.bucket },
            })
        } catch (e) {
            console.error('[lancio] log LANCIO_RETURNED_TO_POOL fallito', e)
        }
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
    const verso = next.kind === 'handoff' ? destinazioneTerzoNr(lead) : undefined
    if (next.kind === 'handoff' && verso === 'conferme') {
        await notifyConfermeLancio({ id: lead.id, name: lead.name }, next.appointmentAt, '🚀 Lancio: 3 NR dal venditore, da richiamare')
    }
    revalidatePath('/venditore')
    revalidatePath('/lead-lancio')
    return { ok: true, handoff: next.kind === 'handoff', verso }
}

// ── Sezione venditore "Lead del lancio" (PO 05/10/2026) ──────────────────────

export type LancioAppuntamento = {
    id: string; name: string; phone: string; email: string | null
    appointmentDate: string | null; lancioSceltaAt: string | null
    lancioBotInfo: { risposte?: string[] } | null; appointmentNote: string | null
    salespersonOutcome: string | null; closeProduct: string | null; closeAmountEur: number | null
    notClosedReason: string | null; version: number
}

/**
 * Gli appuntamenti del mattino dopo che il bot ha messo in agenda al
 * venditore (`app_mattina`), con telefono e racconto del bot in chiaro: per
 * questi lead non c'è il check-in. Stessa finestra di 72 ore della scheda
 * delle chiamate subito, così la sezione si svuota da sola a lancio finito.
 */
export async function getVenditoreLancioAppuntamenti(sellerId: string): Promise<LancioAppuntamento[]> {
    const { companyId } = await requireVenditoreOrStaff(sellerId)
    const finestra = new Date(Date.now() - CALL_NOW_TAB_WINDOW_MS)
    const rows = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email,
        appointmentDate: leads.appointmentDate, lancioSceltaAt: leads.lancioSceltaAt,
        lancioBotInfo: leads.lancioBotInfo, appointmentNote: leads.appointmentNote,
        salespersonOutcome: leads.salespersonOutcome, closeProduct: leads.closeProduct, closeAmountEur: leads.closeAmountEur,
        notClosedReason: leads.notClosedReason, version: leads.version,
    }).from(leads).where(and(
        eq(leads.companyId, companyId),
        eq(leads.salespersonUserId, sellerId),
        eq(leads.lancioScelta, 'app_mattina'),
        eq(leads.launchBucket, LANCIO_WEBDEV.bucket),
        gte(leads.appointmentDate, finestra),
    )).orderBy(leads.appointmentDate)

    const iso = (d: Date | null) => (d ? d.toISOString() : null)
    return rows.map(r => ({
        id: r.id, name: r.name, phone: r.phone, email: r.email,
        appointmentDate: iso(r.appointmentDate), lancioSceltaAt: iso(r.lancioSceltaAt),
        lancioBotInfo: (r.lancioBotInfo as { risposte?: string[] } | null) ?? null, appointmentNote: r.appointmentNote,
        salespersonOutcome: r.salespersonOutcome, closeProduct: r.closeProduct,
        closeAmountEur: r.closeAmountEur === null ? null : Number(r.closeAmountEur),
        notClosedReason: r.notClosedReason, version: r.version,
    }))
}

export type LancioEsitoInput =
    | { outcome: 'Chiuso'; closeAmountEur: number; closeProduct?: 'advance' | 'gold' | 'exclusive' | null; notes?: string }
    | { outcome: 'Non chiuso'; notClosedReason: string; notes?: string }

/**
 * Esito dalla sezione "Lead del lancio": Chiuso con importo, oppure Non chiuso
 * con motivo, e la correzione di un esito già dato. Passa da `saveVenditoreOutcome` (stessa scrittura, stessi KPI e
 * webhook), che per questi lead salta check-in, sondaggio e follow-up.
 */
export async function saveLancioOutcome(leadId: string, input: LancioEsitoInput, version: number): Promise<{ ok: true } | { ok: false; error: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role ?? '')) return { ok: false, error: 'Unauthorized' }
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = role === 'MANAGER' || role === 'ADMIN'

    const [lead] = await db.select({
        salespersonUserId: leads.salespersonUserId, launchBucket: leads.launchBucket, lancioScelta: leads.lancioScelta,
        salespersonOutcome: leads.salespersonOutcome,
    }).from(leads).where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId))).limit(1)
    if (!lead) return { ok: false, error: 'Lead non trovato' }
    if (!isLancioLiberoLead(lead)) return { ok: false, error: 'Non è un lead della serata di lancio' }
    if (!isStaff && lead.salespersonUserId !== user.id) return { ok: false, error: 'Lead di un altro venditore' }

    if (input.outcome === 'Chiuso') {
        if (!Number.isFinite(input.closeAmountEur) || input.closeAmountEur <= 0) return { ok: false, error: "Inserisci l'importo della chiusura" }
    } else if (input.outcome === 'Non chiuso') {
        if (!(NOT_CLOSED_REASONS as ReadonlyArray<string>).includes(input.notClosedReason)) return { ok: false, error: 'Scegli il motivo del Non chiuso' }
    } else {
        return { ok: false, error: 'Esito non valido' }
    }

    // Esito già presente = il venditore lo sta correggendo (PO 05/10): si
    // riscrive lo stesso tentativo, niente secondo salesAttempt né fatturato doppio.
    const occasion = lead.salespersonOutcome ? 'current' as const : 'new' as const
    const res = await saveVenditoreOutcome(leadId, input.outcome === 'Chiuso'
        ? { outcome: 'Chiuso', closeAmountEur: input.closeAmountEur, closeProduct: input.closeProduct ?? undefined, notes: input.notes, occasion }
        : { outcome: 'Non chiuso', notClosedReason: input.notClosedReason, notes: input.notes, nextFollowUpDate: null, occasion },
        version)
    if (!res.success) {
        return { ok: false, error: res.error === 'CONCURRENCY_ERROR' ? 'Il lead è cambiato nel frattempo: ricarica e riprova' : (res.error ?? 'Errore') }
    }
    revalidatePath('/lead-lancio')
    return { ok: true }
}

/**
 * Richiamo su un lead della sezione "Lead del lancio" (PO 06/10/2026): il venditore
 * fissa giorno, ora e una nota, come un GDO coi suoi lead. Vive in
 * `lancioBotInfo.richiamo` e in `lancioCallNowNextAt` (l'ora a cui richiamare), NON in
 * `recallDate`: quello e' dei GDO e accenderebbe i loro richiami e i loro avvisi.
 * `at` null toglie il richiamo.
 */
export async function setLancioRecall(leadId: string, at: string | null, nota?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role as string | undefined
    if (!user || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role ?? '')) return { ok: false, error: 'Unauthorized' }
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = role === 'MANAGER' || role === 'ADMIN'

    const [lead] = await db.select({
        id: leads.id, version: leads.version, salespersonUserId: leads.salespersonUserId, lancioScelta: leads.lancioScelta,
        launchBucket: leads.launchBucket, salespersonOutcome: leads.salespersonOutcome, lancioBotInfo: leads.lancioBotInfo,
    }).from(leads).where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId))).limit(1)
    if (!lead) return { ok: false, error: 'Lead non trovato' }
    if (lead.launchBucket !== LANCIO_WEBDEV.bucket || lead.lancioScelta !== 'chiamata_subito') return { ok: false, error: 'Non è un lead da chiamare del lancio' }
    if (!isStaff && lead.salespersonUserId !== user.id) return { ok: false, error: 'Lead di un altro venditore' }
    if (lead.salespersonOutcome) return { ok: false, error: 'Il lead ha già un esito' }

    let quando: Date | null = null
    if (at !== null) {
        quando = new Date(at)
        if (Number.isNaN(quando.getTime())) return { ok: false, error: 'Data del richiamo non valida' }
        if (quando.getTime() < Date.now() - 60_000) return { ok: false, error: 'Il richiamo deve essere nel futuro' }
    }
    const info = { ...((lead.lancioBotInfo as Record<string, unknown> | null) ?? {}) }
    if (quando) info.richiamo = { at: quando.toISOString(), nota: nota?.trim() || null }
    else delete info.richiamo

    const updated = await db.update(leads).set({
        lancioBotInfo: info,
        lancioCallNowNextAt: quando,
        version: lead.version + 1,
        updatedAt: new Date(),
    }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version))).returning({ id: leads.id })
    if (updated.length === 0) return { ok: false, error: 'Il lead è cambiato nel frattempo: ricarica e riprova' }
    try {
        await logLeadEvent({
            leadId, eventType: 'RECALL_SET', userId: user.id, companyId: ctx.companyId,
            metadata: { source: 'lancio_venditore', at: quando?.toISOString() ?? null, nota: nota?.trim() || null },
        })
    } catch (e) {
        console.error('[lancio] log RECALL_SET fallito', e)
    }
    revalidatePath('/lead-lancio')
    return { ok: true }
}
