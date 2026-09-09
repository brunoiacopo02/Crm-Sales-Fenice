/**
 * Raccolta delle scadenze scoperte e scrittura dei ritardi (malus venditori).
 * La regola pura sta in `latePenalties.ts`; qui c'è solo l'accesso al DB.
 *
 * Girato dal cron `/api/cron/sales-late-penalties`. Idempotente per costruzione:
 * l'unique (leadId, kind, dueAt) fa da rete anche se due giri si sovrappongono.
 */

import { db } from '@/db'
import { leads, salesAttempts, salesLatePenalties } from '@/db/schema'
import { and, eq, isNotNull, isNull, gte, lt, inArray } from 'drizzle-orm'
import {
    selectLatePenalties,
    penaltyKey,
    type DueCandidate,
    type PendingPenalty,
} from './latePenalties'

export interface RunnerResult {
    scanned: number
    registered: number
    skippedBeforeActivation: number
}

/**
 * Data di attivazione della regola: nessun ritardo viene registrato su scadenze
 * anteriori. Senza la env il runner non scrive nulla — fail-safe, così una
 * variabile dimenticata non produce una multa retroattiva su tutto lo storico.
 */
export function activationDate(): Date | null {
    const raw = process.env.SALES_LATE_PENALTIES_FROM
    if (!raw) return null
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
}

/** Appuntamenti passati e mai esitati. */
async function appointmentCandidates(notBefore: Date, now: Date): Promise<DueCandidate[]> {
    const rows = await db.select({
        id: leads.id,
        salespersonUserId: leads.salespersonUserId,
        appointmentDate: leads.appointmentDate,
        salespersonAssignedAt: leads.salespersonAssignedAt,
    }).from(leads).where(and(
        isNotNull(leads.salespersonUserId),
        isNotNull(leads.appointmentDate),
        isNull(leads.salespersonOutcome),
        gte(leads.appointmentDate, notBefore),
        lt(leads.appointmentDate, now),
    ))

    return rows.map(r => ({
        leadId: r.id,
        salesUserId: r.salespersonUserId!,
        kind: 'APPOINTMENT' as const,
        dueAt: r.appointmentDate as Date,
        assignedAt: r.salespersonAssignedAt ?? null,
    }))
}

/**
 * Follow-up scaduti. La scadenza aperta è la `nextFollowUpDate` dell'ULTIMO
 * tentativo: appena il venditore ne registra uno nuovo, l'ultimo cambia e la
 * vecchia scadenza smette di essere pendente — stesso criterio del Monitor
 * Vendite e della vista venditore.
 */
async function followUpCandidates(notBefore: Date, now: Date): Promise<DueCandidate[]> {
    const rows = await db.select({
        leadId: salesAttempts.leadId,
        attemptNumber: salesAttempts.attemptNumber,
        nextFollowUpDate: salesAttempts.nextFollowUpDate,
        salespersonUserId: leads.salespersonUserId,
        salespersonAssignedAt: leads.salespersonAssignedAt,
    }).from(salesAttempts)
      .innerJoin(leads, eq(leads.id, salesAttempts.leadId))
      .where(and(
          isNotNull(leads.salespersonUserId),
          eq(leads.salespersonOutcome, 'Non chiuso'),
          isNull(leads.inLavorazioneAt),
      ))

    const latestByLead = new Map<string, typeof rows[number]>()
    for (const r of rows) {
        const cur = latestByLead.get(r.leadId)
        if (!cur || r.attemptNumber > cur.attemptNumber) latestByLead.set(r.leadId, r)
    }

    const out: DueCandidate[] = []
    for (const r of latestByLead.values()) {
        const due = r.nextFollowUpDate
        if (!due || due < notBefore || due >= now) continue
        out.push({
            leadId: r.leadId,
            salesUserId: r.salespersonUserId!,
            kind: 'FOLLOWUP',
            dueAt: due,
            assignedAt: r.salespersonAssignedAt ?? null,
        })
    }
    return out
}

/** Penali già a registro per questi lead, come chiavi di idempotenza. */
async function existingKeys(leadIds: string[]): Promise<Set<string>> {
    if (leadIds.length === 0) return new Set()
    const rows = await db.select({
        leadId: salesLatePenalties.leadId,
        kind: salesLatePenalties.kind,
        dueAt: salesLatePenalties.dueAt,
    }).from(salesLatePenalties).where(inArray(salesLatePenalties.leadId, leadIds))
    return new Set(rows.map(r => penaltyKey({
        leadId: r.leadId,
        kind: r.kind as DueCandidate['kind'],
        dueAt: r.dueAt,
    })))
}

/**
 * Un giro completo: pesca le scadenze scoperte, scarta quelle già a registro e
 * quelle anteriori all'attivazione, scrive le nuove.
 */
export async function runLatePenalties(now: Date = new Date()): Promise<RunnerResult> {
    const notBefore = activationDate()
    if (!notBefore) return { scanned: 0, registered: 0, skippedBeforeActivation: 0 }

    const [appts, followUps] = await Promise.all([
        appointmentCandidates(notBefore, now),
        followUpCandidates(notBefore, now),
    ])
    const candidates = [...appts, ...followUps]

    const seen = await existingKeys(candidates.map(c => c.leadId))
    const pending: PendingPenalty[] = selectLatePenalties(candidates, now, notBefore, seen)

    if (pending.length === 0) {
        return { scanned: candidates.length, registered: 0, skippedBeforeActivation: 0 }
    }

    // companyId dal lead: il cron gira su tutti i tenant in un colpo solo.
    const companyRows = await db.select({ id: leads.id, companyId: leads.companyId })
        .from(leads)
        .where(inArray(leads.id, [...new Set(pending.map(p => p.leadId))]))
    const companyOf = new Map(companyRows.map(r => [r.id, r.companyId]))

    // onConflictDoNothing: due giri concorrenti non raddoppiano la penale.
    const inserted = await db.insert(salesLatePenalties).values(pending.map(p => ({
        id: crypto.randomUUID(),
        companyId: companyOf.get(p.leadId) ?? 'fenice',
        salesUserId: p.salesUserId,
        leadId: p.leadId,
        kind: p.kind,
        dueAt: p.dueAt,
        detectedAt: now,
        amountEur: p.amountEur,
        monthKey: p.monthKey,
    }))).onConflictDoNothing().returning({ id: salesLatePenalties.id })

    return {
        scanned: candidates.length,
        registered: inserted.length,
        skippedBeforeActivation: 0,
    }
}

/**
 * Chiude i ritardi aperti di un lead: chiamata quando il venditore registra
 * finalmente un esito. La penale resta (è già maturata), ma `resolvedAt` dice
 * dopo quante ore è arrivato l'esito.
 */
export async function resolveLatePenalties(leadId: string, at: Date = new Date()): Promise<void> {
    await db.update(salesLatePenalties)
        .set({ resolvedAt: at })
        .where(and(
            eq(salesLatePenalties.leadId, leadId),
            isNull(salesLatePenalties.resolvedAt),
        ))
}
