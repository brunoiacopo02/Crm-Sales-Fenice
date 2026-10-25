"use server"

// Server action della Diretta (PO 25/10/2026): numeri della home GDO,
// schermata d'inizio turno, saldo e richiami per la barra in alto, pagina
// admin di obiettivi e interruttori. Tutte richiedono una sessione; quelle
// che scrivono richiedono ADMIN.

import { revalidatePath, updateTag } from 'next/cache'
import { and, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import { callLogs, leads, users } from '@/db/schema'
import { assertSalesArea, currentTenant } from '@/lib/tenancy'
import {
    leggiMia, leggiObiettivi, leggiSquadra, TAG_DIRETTA_OBIETTIVI, TAG_DIRETTA_SQUADRA,
    type DirettaMia, type DirettaSquadra,
} from '@/lib/diretta/live'
import { giornoLavorativoPrecedente } from '@/lib/diretta/home'
import { DIRETTA_FLAG_KEYS, GAMIFICATION_SETTINGS_KEY, type GamificationTargets } from '@/lib/diretta/config'
import { readDirettaFlags, readGamificationTargets, writeSetting } from '@/lib/diretta/settings'
import { validaObiettivi } from '@/lib/diretta/validaObiettivi'

export interface DirettaLive {
    squadra: DirettaSquadra
    mia: DirettaMia
    io: { id: string; inSquadra: boolean }
    server: string
}

/** Numeri della home: squadra (cache 15 s) e miei (freschi). Solo GDO. */
export async function getDirettaLive(): Promise<DirettaLive | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'GDO') return null
    const [squadra, mia] = await Promise.all([
        leggiSquadra(ctx.companyId),
        leggiObiettivi().then(o => leggiMia(ctx.userId, ctx.companyId, o)),
    ])
    return {
        squadra,
        mia,
        io: { id: ctx.userId, inSquadra: squadra.membri.includes(ctx.userId) },
        server: new Date().toISOString(),
    }
}

/** Saldo Scintille e Piume dell'utente in sessione (barra in alto). */
export async function getDirettaSaldo(): Promise<{ scintille: number; piume: number } | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const [u] = await db.select({ scintille: users.scintille, piume: users.piume })
        .from(users).where(eq(users.id, ctx.userId)).limit(1)
    return u ?? null
}

/** Richiami scaduti del GDO, per la voce "Richiami" del menu. Un conteggio su indice. */
export async function getDirettaRichiamiScaduti(): Promise<number> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'GDO') return 0
    const [r] = await db.select({ n: sql<number>`count(*)::int` })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.assignedToId, ctx.userId),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
            isNotNull(leads.recallDate),
            lte(leads.recallDate, new Date()),
        ))
    return r?.n ?? 0
}

/**
 * Schermata d'inizio turno: degli appuntamenti fissati nell'ultimo giorno
 * lavorativo (il lunedì guarda il sabato), quanti sono già confermati.
 */
export async function getInizioTurno(): Promise<{ etichetta: string; fissati: number; confermati: number } | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'GDO') return null
    const ieri = giornoLavorativoPrecedente(new Date())
    const righe = await db.select({ leadId: callLogs.leadId })
        .from(callLogs)
        .where(and(
            eq(callLogs.companyId, ctx.companyId),
            eq(callLogs.userId, ctx.userId),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            gte(callLogs.createdAt, ieri.start),
            lt(callLogs.createdAt, ieri.end),
        ))
    const ids = [...new Set(righe.map(r => r.leadId))]
    let confermati = 0
    if (ids.length > 0) {
        const [r] = await db.select({ n: sql<number>`count(*)::int` })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                inArray(leads.id, ids),
                eq(leads.confirmationsOutcome, 'confermato'),
            ))
        confermati = r?.n ?? 0
    }
    return { etichetta: ieri.etichetta, fissati: ids.length, confermati }
}

// ── Pagina admin /admin/diretta ──────────────────────────────────────────

async function soloAdmin() {
    const ctx = await currentTenant()
    if (ctx.role !== 'ADMIN') return null
    return ctx
}

export async function getDirettaAdmin(): Promise<{ flags: { GDO: boolean; CONFERME: boolean }; obiettivi: GamificationTargets } | null> {
    if (!(await soloAdmin())) return null
    const [flags, obiettivi] = await Promise.all([readDirettaFlags(), readGamificationTargets()])
    return { flags, obiettivi }
}

/** Accende o spegne la Diretta per un ruolo. Vale dalla prossima pagina caricata. */
export async function setDirettaFlag(ruolo: 'GDO' | 'CONFERME', acceso: boolean): Promise<{ success: boolean; error?: string }> {
    const ctx = await soloAdmin()
    if (!ctx) return { success: false, error: 'Solo un ADMIN può cambiare gli interruttori.' }
    if (ruolo !== 'GDO' && ruolo !== 'CONFERME') return { success: false, error: 'Ruolo non valido.' }
    await writeSetting(DIRETTA_FLAG_KEYS[ruolo], acceso ? 'on' : 'off', ctx.userId)
    revalidatePath('/admin/diretta')
    return { success: true }
}

/** Salva gli obiettivi: controllati per intero, poi la cache della squadra si rinnova subito. */
export async function saveDirettaObiettivi(input: unknown): Promise<{ success: boolean; error?: string }> {
    const ctx = await soloAdmin()
    if (!ctx) return { success: false, error: 'Solo un ADMIN può cambiare gli obiettivi.' }
    const esito = validaObiettivi(input)
    if (!esito.ok) return { success: false, error: esito.errore }
    await writeSetting(GAMIFICATION_SETTINGS_KEY, JSON.stringify(esito.value), ctx.userId)
    updateTag(TAG_DIRETTA_SQUADRA)
    updateTag(TAG_DIRETTA_OBIETTIVI)
    revalidatePath('/admin/diretta')
    return { success: true }
}
