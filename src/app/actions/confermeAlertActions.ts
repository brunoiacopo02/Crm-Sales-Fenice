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
import { and, asc, eq, gte, inArray, isNull, isNotNull, lt, lte, or, sql } from "drizzle-orm"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import {
    selectBlockingAlert,
    SNOOZE_MS,
    STALE_CUTOFF_DAYS,
    type AlertCandidate,
    type AlertKind,
} from "@/lib/conferme/blockingAlert"

export type BlockingAlertPayload = {
    alert: {
        id: string
        name: string
        phone: string | null
        companyId: string
        kind: AlertKind
        dueAt: string
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
        recallDate: leads.recallDate,
        needsReschedule: leads.confNeedsReschedule,
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
            or(
                // "Risentire dopo": richiamo in giornata.
                and(
                    isNotNull(leads.confSnoozeAt),
                    gte(leads.confSnoozeAt, staleFloor),
                    lte(leads.confSnoozeAt, now),
                    or(
                        isNull(leads.confAlertHandledAt),
                        lt(leads.confAlertHandledAt, leads.confSnoozeAt),
                    ),
                ),
                // "Programma richiamo": il lead parcheggiato ad altri giorni
                // (badge blu). `confNeedsReschedule` è la prova che il richiamo
                // è delle Conferme: su `recallDate` da sola cadrebbero dentro
                // anche i richiami dei GDO, che non c'entrano con questo avviso.
                and(
                    eq(leads.confNeedsReschedule, true),
                    isNotNull(leads.recallDate),
                    gte(leads.recallDate, staleFloor),
                    lte(leads.recallDate, now),
                    or(
                        isNull(leads.confAlertHandledAt),
                        lt(leads.confAlertHandledAt, leads.recallDate),
                    ),
                ),
            ),
        ))
        // La scadenza è su due colonne diverse a seconda del tipo di richiamo:
        // si ordina sulla data che vale davvero, altrimenti il tetto di 20 righe
        // taglierebbe a caso.
        .orderBy(asc(sql`coalesce(case when ${leads.confNeedsReschedule} then ${leads.recallDate} end, ${leads.confSnoozeAt})`))
        .limit(20)

    // Se un lead ha tutt'e due le date, vince il parcheggio: è lo stato più
    // recente (toglie l'appuntamento dalla board) e lo snooze resta appeso da
    // prima. In prod i due campi non convivono mai (verificato 2026-09-02).
    const candidates: AlertCandidate[] = rows.map(r => {
        const parcheggiato = r.needsReschedule && r.recallDate
        return {
            id: r.id,
            name: r.name,
            phone: r.phone,
            companyId: r.companyId,
            kind: (parcheggiato ? 'parcheggiato' : 'snooze') as AlertKind,
            dueAt: (parcheggiato ? r.recallDate : r.snoozeAt) as Date,
            notes: r.notes,
            alertSnoozedUntil: r.alertSnoozedUntil,
            claimedById: r.claimedById,
            claimedAt: r.claimedAt,
            handledAt: r.handledAt,
        }
    })

    const res = selectBlockingAlert(candidates, { now, userId: ctx.userId })

    return {
        alert: res.alert ? {
            id: res.alert.id,
            name: res.alert.name,
            phone: res.alert.phone,
            companyId: res.alert.companyId,
            kind: res.alert.kind,
            dueAt: res.alert.dueAt.toISOString(),
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
 * La scheda è stata aperta: l'avviso si spegne per tutti. Idempotente — se il
 * "gestito" è già più recente della scadenza del richiamo non riscrive, per non
 * generare UPDATE (e ping Broadcast) inutili a ogni apertura del drawer. Un
 * "gestito" più vecchio della scadenza invece si riscrive: è di una tornata
 * precedente, tipico dei parcheggiati aperti il giorno in cui li si programma.
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
            or(
                and(
                    isNotNull(leads.confSnoozeAt),
                    or(
                        isNull(leads.confAlertHandledAt),
                        lt(leads.confAlertHandledAt, leads.confSnoozeAt),
                    ),
                ),
                and(
                    eq(leads.confNeedsReschedule, true),
                    isNotNull(leads.recallDate),
                    or(
                        isNull(leads.confAlertHandledAt),
                        lt(leads.confAlertHandledAt, leads.recallDate),
                    ),
                ),
            ),
        ))

    return { ok: true }
}
