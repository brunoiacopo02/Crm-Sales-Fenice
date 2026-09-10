/**
 * Malus ritardi venditori (decisione PO 2026-09-09).
 *
 * Regola: ogni SCADENZA — l'ora di un appuntamento o di un follow-up — deve
 * avere un esito registrato entro `OVERDUE_GRACE_HOURS`. Oltre quella soglia
 * scatta un ritardo: il lead esce dalle liste del Monitor Vendite e finisce nel
 * conteggio del mese, che a fine mese vale `LATE_PENALTY_EUR` a ritardo.
 *
 * Ore solari: la grazia corre anche di notte, nel weekend e nei festivi.
 *
 * Due guardie, perché la penale sia sempre attribuibile a chi poteva evitarla:
 *  1. il timer parte da max(scadenza, assegnazione al venditore) — un lead
 *     assegnato il giorno dopo l'appuntamento non è un ritardo del venditore;
 *  2. le scadenze anteriori a `notBefore` (attivazione della regola) non
 *     generano nulla: nessuno viene multato per una regola non ancora in vigore.
 */

import { OVERDUE_GRACE_HOURS } from './constants'
import { toRomeDateStr } from '../dateUtils'

/** Trattenuta per singolo ritardo, in euro. */
export const LATE_PENALTY_EUR = 10

export type PenaltyKind = 'APPOINTMENT' | 'FOLLOWUP'

/** Una scadenza aperta: appuntamento o follow-up ancora senza esito. */
export interface DueCandidate {
    leadId: string
    salesUserId: string
    kind: PenaltyKind
    /** Ora dell'appuntamento o del follow-up. */
    dueAt: Date
    /** Quando il lead è stato assegnato a questo venditore (guardia 1). */
    assignedAt: Date | null
}

export interface PendingPenalty {
    leadId: string
    salesUserId: string
    kind: PenaltyKind
    dueAt: Date
    /** 'YYYY-MM' della scadenza, Europe/Rome: mese di competenza. */
    monthKey: string
    amountEur: number
}

const GRACE_MS = OVERDUE_GRACE_HOURS * 3600 * 1000

/** 'YYYY-MM' come lo legge Europe/Rome (un appuntamento dell'1/09 alle 00:30 è di settembre). */
export function romeMonthKey(at: Date): string {
    return toRomeDateStr(at).slice(0, 7)
}

/**
 * Istante oltre il quale la scadenza è in ritardo.
 * Se il lead è arrivato al venditore DOPO la scadenza, la grazia parte
 * dall'assegnazione: non si multa qualcuno per un lead che non aveva.
 */
export function deadlineFor(candidate: DueCandidate): Date {
    const from = candidate.assignedAt && candidate.assignedAt > candidate.dueAt
        ? candidate.assignedAt
        : candidate.dueAt
    return new Date(from.getTime() + GRACE_MS)
}

/** La scadenza è in ritardo a `now`? */
export function isLate(candidate: DueCandidate, now: Date): boolean {
    return now.getTime() > deadlineFor(candidate).getTime()
}

/**
 * Ritardi da registrare fra i candidati.
 * `notBefore`: data di attivazione della regola; le scadenze precedenti sono ignorate.
 * `alreadyPenalised`: chiavi già a registro (vedi `penaltyKey`), per non ripetere il malus.
 */
export function selectLatePenalties(
    candidates: DueCandidate[],
    now: Date,
    notBefore: Date,
    alreadyPenalised: Set<string> = new Set(),
): PendingPenalty[] {
    const out: PendingPenalty[] = []
    for (const c of candidates) {
        if (c.dueAt < notBefore) continue
        if (!isLate(c, now)) continue
        if (alreadyPenalised.has(penaltyKey(c))) continue
        out.push({
            leadId: c.leadId,
            salesUserId: c.salesUserId,
            kind: c.kind,
            dueAt: c.dueAt,
            monthKey: romeMonthKey(c.dueAt),
            amountEur: LATE_PENALTY_EUR,
        })
    }
    return out
}

/** Chiave di idempotenza, gemella dell'unique index (leadId, kind, dueAt). */
export function penaltyKey(c: { leadId: string; kind: PenaltyKind; dueAt: Date }): string {
    return `${c.leadId}|${c.kind}|${c.dueAt.toISOString()}`
}

/** Ore di ritardo effettive, per la colonna "esitato dopo Xh" del monitor. */
export function lateHours(dueAt: Date, resolvedAt: Date | null, now: Date): number {
    const end = resolvedAt ?? now
    return Math.max(0, Math.floor((end.getTime() - dueAt.getTime()) / 3600_000))
}

/** Perché la regola non è in vigore, quando non lo è. */
export type PenaltyRuleInactiveReason = 'not_activated' | 'kill_switch'

/**
 * Stato della regola. Serve al Monitor Vendite quanto al cron: una sezione
 * Ritardi vuota perché nessuno è in ritardo e una vuota perché la regola non è
 * mai stata accesa si assomigliano troppo, e la seconda sembra un guasto.
 */
export type PenaltyRuleState =
    | { active: true; from: Date }
    | { active: false; reason: PenaltyRuleInactiveReason; from: Date | null }

/** Data di attivazione dalla env, o null se assente o illeggibile. */
export function parseActivationDate(raw: string | undefined): Date | null {
    if (!raw) return null
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
}

/**
 * Legge lo stato dalle env. Il kill-switch vince sulla data di attivazione:
 * `SALES_LATE_PENALTIES=off` spegne tutto senza dover togliere la data.
 */
export function penaltyRuleState(
    env: Record<string, string | undefined> = process.env,
): PenaltyRuleState {
    const from = parseActivationDate(env.SALES_LATE_PENALTIES_FROM)
    if (env.SALES_LATE_PENALTIES === 'off') return { active: false, reason: 'kill_switch', from }
    if (!from) return { active: false, reason: 'not_activated', from: null }
    return { active: true, from }
}
