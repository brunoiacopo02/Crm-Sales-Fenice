"use server"

// Server action della Diretta (PO 25/10/2026): numeri della home GDO,
// schermata d'inizio turno, saldo e richiami per la barra in alto, pagina
// admin di obiettivi e interruttori. Tutte richiedono una sessione; quelle
// della pagina admin richiedono ADMIN letto dalla tabella users.

import { revalidatePath, updateTag } from 'next/cache'
import { and, eq, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leads, users } from '@/db/schema'
import { assertSalesArea, currentTenant } from '@/lib/tenancy'
import { conRuoloDb } from '@/lib/auth/ruoloDb'
import {
    leggiMia, leggiObiettivi, leggiSquadra, TAG_DIRETTA_OBIETTIVI, TAG_DIRETTA_SQUADRA,
    type DirettaMia, type DirettaSquadra,
} from '@/lib/diretta/live'
import { leggiFissati } from '@/lib/diretta/fissatiDb'
import { giornoLavorativoPrecedente } from '@/lib/diretta/home'
import { DIRETTA_FLAG_KEYS, GAMIFICATION_SETTINGS_KEY, RUOLI_DIRETTA, type GamificationTargets, type RuoloDiretta } from '@/lib/diretta/config'
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
 * lavorativo (il lunedì guarda il sabato) e ancora validi, quanti sono già
 * confermati. Stessa definizione di fissato della home (src/lib/diretta/fissati.ts).
 */
export async function getInizioTurno(): Promise<{ etichetta: string; fissati: number; confermati: number } | null> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    if (ctx.role !== 'GDO') return null
    const ieri = giornoLavorativoPrecedente(new Date())
    const righe = await leggiFissati({ companyId: ctx.companyId, userIds: [ctx.userId], start: ieri.start, end: ieri.end })
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

/** ADMIN letto dalla tabella users, non dai metadati della sessione. */
function soloAdmin() {
    return conRuoloDb(['ADMIN'])
}

export async function getDirettaAdmin(): Promise<{ flags: Record<RuoloDiretta, boolean>; obiettivi: GamificationTargets } | null> {
    if (!(await soloAdmin())) return null
    const [flags, obiettivi] = await Promise.all([readDirettaFlags(), readGamificationTargets()])
    return { flags, obiettivi }
}

/**
 * Accende o spegne la Diretta per un ruolo (GDO, Conferme o admin). Chi ha il
 * CRM aperto passa alla veste nuova al primo aggiornamento della pagina; le
 * pagine che cambiano con l'interruttore riallineano da sole la cornice
 * (VesteAllineata).
 */
export async function setDirettaFlag(ruolo: RuoloDiretta, acceso: boolean): Promise<{ success: boolean; error?: string }> {
    const admin = await soloAdmin()
    if (!admin) return { success: false, error: 'Solo un ADMIN può cambiare gli interruttori.' }
    if (!RUOLI_DIRETTA.includes(ruolo)) return { success: false, error: 'Ruolo non valido.' }
    if (typeof acceso !== 'boolean') return { success: false, error: 'Valore non valido.' }
    await writeSetting(DIRETTA_FLAG_KEYS[ruolo], acceso ? 'on' : 'off', admin.id)
    revalidatePath('/admin/diretta')
    return { success: true }
}

/** Salva gli obiettivi: controllati per intero, poi la cache della squadra si rinnova subito. */
export async function saveDirettaObiettivi(input: unknown): Promise<{ success: boolean; error?: string }> {
    const admin = await soloAdmin()
    if (!admin) return { success: false, error: 'Solo un ADMIN può cambiare gli obiettivi.' }
    const esito = validaObiettivi(input)
    if (!esito.ok) return { success: false, error: esito.errore }
    await writeSetting(GAMIFICATION_SETTINGS_KEY, JSON.stringify(esito.value), admin.id)
    updateTag(TAG_DIRETTA_SQUADRA)
    updateTag(TAG_DIRETTA_OBIETTIVI)
    revalidatePath('/admin/diretta')
    revalidatePath('/admin/diretta/obiettivi')
    return { success: true }
}
