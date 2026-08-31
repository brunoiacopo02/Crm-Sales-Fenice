"use server"

/**
 * Avviso bloccante sui richiami Conferme.
 *
 * Spec: docs/superpowers/specs/2026-08-31-avviso-bloccante-richiami-conferme-design.md
 *
 * Le quattro colonne `confAlert*` (migrazione 0032) vivono su `leads` apposta:
 * il trigger della 0019 manda già un ping Broadcast 'leads' sul topic
 * crm:<companyId> a ogni UPDATE, quindi snooze e claim si propagano a tutti gli
 * schermi senza aggiungere un canale realtime (regola del singleton) né un
 * trigger nuovo.
 *
 * Nessuna di queste UPDATE tocca `version` o `updatedAt`: sono metadati
 * dell'avviso, non modifiche al lead. Bumpare la versione farebbe scattare
 * CONCURRENCY_ERROR nelle altre azioni Conferme mentre l'operatore ci lavora.
 */

import { db } from "@/db"
import { leads } from "@/db/schema"
import { and, asc, eq, gte, inArray, isNull, isNotNull, lte } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import {
    selectBlockingAlert,
    SNOOZE_MS,
    STALE_CUTOFF_DAYS,
    type AlertCandidate,
} from "@/lib/conferme/blockingAlert"

export type BlockingAlertPayload = {
    alert: {
        id: string
        name: string
        phone: string | null
        companyId: string
        snoozeAt: string
        notes: string | null
        claimedByMe: boolean
    } | null
    queueTotal: number
    /** ISO dell'istante in cui il client deve ricontrollare da solo. */
    nextWakeAt: string | null
}

const EMPTY: BlockingAlertPayload = { alert: null, queueTotal: 0, nextWakeAt: null }

/** Solo le Conferme vengono bloccate: manager e admin no (guardano i numeri). */
async function confermeCtx() {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== "CONFERME") return null
    if (ctx.isAllCompanies) return null
    return ctx
}

export async function getConfermeBlockingAlert(): Promise<BlockingAlertPayload> {
    const ctx = await confermeCtx()
    if (!ctx) return EMPTY

    const now = new Date()
    const staleFloor = new Date(now.getTime() - STALE_CUTOFF_DAYS * 86_400_000)

    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        companyId: leads.companyId,
        snoozeAt: leads.confSnoozeAt,
        notes: leads.confRecallNotes,
        alertSnoozedUntil: leads.confAlertSnoozedUntil,
        claimedById: leads.confAlertClaimedById,
        claimedAt: leads.confAlertClaimedAt,
        handledAt: leads.confAlertHandledAt,
    })
        .from(leads)
        .where(and(
            inArray(leads.companyId, ctx.allowedCompanies),
            isNull(leads.confirmationsOutcome),
            isNull(leads.confAlertHandledAt),
            isNotNull(leads.confSnoozeAt),
            gte(leads.confSnoozeAt, staleFloor),
            lte(leads.confSnoozeAt, now),
        ))
        .orderBy(asc(leads.confSnoozeAt))
        .limit(20)

    const candidates: AlertCandidate[] = rows.map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        companyId: r.companyId,
        snoozeAt: r.snoozeAt as Date,
        notes: r.notes,
        alertSnoozedUntil: r.alertSnoozedUntil,
        claimedById: r.claimedById,
        claimedAt: r.claimedAt,
        handledAt: r.handledAt,
    }))

    const res = selectBlockingAlert(candidates, { now, userId: ctx.userId })

    return {
        alert: res.alert ? {
            id: res.alert.id,
            name: res.alert.name,
            phone: res.alert.phone,
            companyId: res.alert.companyId,
            snoozeAt: res.alert.snoozeAt.toISOString(),
            notes: res.alert.notes,
            claimedByMe: res.alert.claimedById === ctx.userId,
        } : null,
        queueTotal: res.queueTotal,
        nextWakeAt: res.nextWakeAt ? res.nextWakeAt.toISOString() : null,
    }
}

/** Silenzio per TUTTI per 2 minuti, poi l'avviso si ripresenta. Toglie il claim. */
export async function snoozeConfermeAlert(leadId: string): Promise<{ ok: boolean }> {
    const ctx = await confermeCtx()
    if (!ctx) return { ok: false }

    await db.update(leads)
        .set({
            confAlertSnoozedUntil: new Date(Date.now() + SNOOZE_MS),
            confAlertClaimedById: null,
            confAlertClaimedAt: null,
        })
        .where(and(
            eq(leads.id, leadId),
            inArray(leads.companyId, ctx.allowedCompanies),
        ))

    return { ok: true }
}

/** "Lo chiamo io": da qui in poi l'avviso è solo suo, per 10 minuti. */
export async function claimConfermeAlert(leadId: string): Promise<{ ok: boolean }> {
    const ctx = await confermeCtx()
    if (!ctx) return { ok: false }

    await db.update(leads)
        .set({
            confAlertClaimedById: ctx.userId,
            confAlertClaimedAt: new Date(),
            confAlertSnoozedUntil: null,
        })
        .where(and(
            eq(leads.id, leadId),
            inArray(leads.companyId, ctx.allowedCompanies),
        ))

    return { ok: true }
}

/**
 * La scheda è stata aperta: l'avviso si spegne per tutti. Idempotente — se
 * `confAlertHandledAt` c'è già non riscrive, per non generare UPDATE (e ping
 * Broadcast) inutili a ogni apertura del drawer.
 */
export async function markConfermeAlertHandled(leadId: string): Promise<{ ok: boolean }> {
    const ctx = await confermeCtx()
    if (!ctx) return { ok: false }

    await db.update(leads)
        .set({
            confAlertHandledAt: new Date(),
            confAlertSnoozedUntil: null,
        })
        .where(and(
            eq(leads.id, leadId),
            inArray(leads.companyId, ctx.allowedCompanies),
            isNull(leads.confAlertHandledAt),
            isNotNull(leads.confSnoozeAt),
        ))

    return { ok: true }
}
