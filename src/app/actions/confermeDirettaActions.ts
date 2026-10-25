"use server"

// Numeri della colonna arancione delle Conferme nella Diretta e configurazione
// del bonus Conferme (PO 25/10/2026). I conteggi sono in src/lib/conferme
// (direttaStats.ts, bonus.ts), testati; qui solo lettura dal DB e permessi.
//
// Carico sul DB: una sola query sui lead confermati dalle Conferme da inizio
// mese (o inizio settimana, se viene prima), sull'indice confirmations_outcome_idx
// (circa 8 ms e 1.200 buffer in cache al 25/10/2026), condivisa da tutti gli
// account con unstable_cache per 20 secondi, azienda per azienda. Il client
// chiede i numeri al massimo ogni 30 secondi e mai a scheda nascosta.

import { unstable_cache } from "next/cache"
import { and, asc, eq, gte, inArray, or } from "drizzle-orm"
import { db } from "@/db"
import { appSettings, leads, users } from "@/db/schema"
import { currentTenant, assertSalesArea } from "@/lib/tenancy"
import { conRuoloDb, haRuoloDb } from "@/lib/auth/ruoloDb"
import { writeSetting } from "@/lib/diretta/settings"
import {
    CONFERME_BONUS_KEY, parseConfermeBonus, validateConfermeBonus,
    type BonusPeriodo, type BonusUnita, type ConfermeBonusConfig,
} from "@/lib/conferme/bonus"
import {
    aggregateConfermeDiretta, conteggiSquadra, direttaBounds,
    type ConfermeDirettaNumeri, type ConfermeLeadRow,
} from "@/lib/conferme/direttaStats"
import { progressoObiettiviConferme, type ProgressoObiettivi } from "@/lib/economy/awards"

const CACHE_SECONDI = 20

async function readConfermeBonusConfig(): Promise<ConfermeBonusConfig> {
    try {
        const [row] = await db.select({ value: appSettings.value }).from(appSettings)
            .where(eq(appSettings.key, CONFERME_BONUS_KEY)).limit(1)
        return parseConfermeBonus(row?.value)
    } catch {
        return parseConfermeBonus(null)
    }
}

/**
 * Lead confermati da un account CONFERME con almeno una delle tre azioni
 * (conferma, presenza, chiusura) dal `sinceMs` in poi. Restano fuori le
 * conferme del bot del lancio e quelle fatte da admin e manager: il bonus è
 * delle Conferme ("contano le chiusure di lead che avete confermato voi").
 * Date in millisecondi perché unstable_cache serializza in JSON.
 */
const loadConfermeRows = unstable_cache(
    async (companyIds: string[], sinceMs: number): Promise<ConfermeLeadRow[]> => {
        const since = new Date(sinceMs)
        const rows = await db.select({
            id: leads.id,
            userId: leads.confirmationsUserId,
            confirmedAt: leads.confirmationsTimestamp,
            presentedAt: leads.presentedAt,
            outcome: leads.salespersonOutcome,
            outcomeAt: leads.salespersonOutcomeAt,
        }).from(leads).where(and(
            inArray(leads.companyId, companyIds),
            eq(leads.confirmationsOutcome, 'confermato'),
            inArray(leads.confirmationsUserId, db.select({ id: users.id }).from(users).where(eq(users.role, 'CONFERME'))),
            or(
                gte(leads.confirmationsTimestamp, since),
                gte(leads.presentedAt, since),
                gte(leads.salespersonOutcomeAt, since),
            ),
        ))
        return rows.map(r => ({
            id: r.id,
            userId: r.userId,
            confirmedAt: r.confirmedAt ? r.confirmedAt.getTime() : null,
            presentedAt: r.presentedAt ? r.presentedAt.getTime() : null,
            chiusoAt: r.outcome === 'Chiuso' && r.outcomeAt ? r.outcomeAt.getTime() : null,
        }))
    },
    ['conferme-diretta-righe'],
    { revalidate: CACHE_SECONDI },
)

export type ConfermeDirettaStats = ConfermeDirettaNumeri & {
    saldo: { scintille: number; piume: number }
    /** Obiettivi settimanali che danno Piume (solo per chi ha il ruolo CONFERME nel DB). */
    obiettiviSettimana: ProgressoObiettivi | null
}

/** Numeri della colonna arancione per chi guarda: i suoi di oggi, gli obiettivi, la squadra e il saldo. */
export async function getConfermeDirettaStats(): Promise<ConfermeDirettaStats> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    // Ruolo dalla tabella users, non dai metadati della sessione.
    if (!(await haRuoloDb(ctx.userId, ['CONFERME', 'MANAGER', 'ADMIN']))) throw new Error('Unauthorized')

    const now = new Date()
    const cfg = await readConfermeBonusConfig()
    const bounds = direttaBounds(now, cfg.periodo)
    const companyIds = ctx.isAllCompanies ? [...ctx.allowedCompanies].sort() : [ctx.companyId]

    const [rows, saldoRows] = await Promise.all([
        loadConfermeRows(companyIds, bounds.since),
        db.select({ scintille: users.scintille, piume: users.piume, role: users.role })
            .from(users).where(eq(users.id, ctx.userId)).limit(1),
    ])
    // Obiettivi della settimana: gli stessi conteggi che decidono le Piume
    // (src/lib/economy/awards.ts). Un errore non toglie il resto della colonna.
    const obiettiviSettimana = saldoRows[0]?.role === 'CONFERME'
        ? await progressoObiettiviConferme(ctx.userId, now).catch((e: unknown) => {
            console.error('[conferme diretta] obiettivi', e)
            return null
        })
        : null

    return {
        ...aggregateConfermeDiretta(rows, { userId: ctx.userId, bounds, cfg }),
        saldo: { scintille: saldoRows[0]?.scintille ?? 0, piume: saldoRows[0]?.piume ?? 0 },
        obiettiviSettimana,
    }
}

export type ConfermeAccount = { id: string; nome: string; isActive: boolean }

async function listConfermeAccounts(): Promise<ConfermeAccount[]> {
    const rows = await db.select({
        id: users.id,
        name: users.name,
        displayName: users.displayName,
        firstName: users.firstName,
        isActive: users.isActive,
    }).from(users).where(eq(users.role, 'CONFERME')).orderBy(asc(users.name))
    return rows.map(r => ({
        id: r.id,
        nome: r.firstName?.trim() || r.name || r.displayName || r.id,
        isActive: r.isActive,
    }))
}

export type ConfermeBonusSettings = {
    config: ConfermeBonusConfig
    account: ConfermeAccount[]
    /** Dove sarebbe la squadra oggi con ciascuna regola, per scegliere unità e periodo. */
    anteprima: Record<BonusUnita, Record<BonusPeriodo, number>>
}

/** Configurazione del bonus Conferme per la pagina admin. Solo ADMIN, letto dalla tabella users. */
export async function getConfermeBonusSettings(): Promise<ConfermeBonusSettings> {
    const ctx = await currentTenant()
    if (!(await haRuoloDb(ctx.userId, ['ADMIN']))) throw new Error('Unauthorized')

    const now = new Date()
    const config = await readConfermeBonusConfig()
    const bounds = direttaBounds(now, config.periodo)
    const companyIds = ctx.isAllCompanies ? [...ctx.allowedCompanies].sort() : [ctx.companyId]
    const [account, rows] = await Promise.all([
        listConfermeAccounts(),
        loadConfermeRows(companyIds, bounds.since),
    ])
    return { config, account, anteprima: conteggiSquadra(rows, bounds) }
}

/**
 * Salva la configurazione del bonus Conferme. Solo ADMIN (letto dalla tabella
 * users); i valori sbagliati si rifiutano, non si correggono.
 */
export async function saveConfermeBonusSettings(
    input: unknown,
): Promise<{ success: true; config: ConfermeBonusConfig } | { success: false; error: string }> {
    try {
        const admin = await conRuoloDb(['ADMIN'])
        if (!admin) return { success: false, error: 'Non autorizzato.' }
        const account = await listConfermeAccounts()
        const v = validateConfermeBonus(input, new Set(account.map(a => a.id)))
        if (!v.ok) return { success: false, error: v.error }
        await writeSetting(CONFERME_BONUS_KEY, JSON.stringify(v.value), admin.id)
        return { success: true, config: v.value }
    } catch (error) {
        console.error('Errore saveConfermeBonusSettings:', error)
        return { success: false, error: 'Salvataggio non riuscito, riprova.' }
    }
}
