"use server"

// Pagina Squadra della Diretta (/classifica con l'interruttore acceso).
//
// I numeri sono uguali per tutti, quindi si calcolano una volta ogni 20 s per
// giorno di Roma (unstable_cache) e non a ogni visita: niente carico nuovo sul
// database anche con tutta la sala sulla pagina. Le query sono quattro:
// squadra, appuntamenti della settimana, presenze (countPresences per persona,
// indice leads_presented_at_idx) e personalizzazioni.
//
// "Fissato" = lead distinto con callLog APPUNTAMENTO della persona (append-only),
// come nella home. Squadra = isTeamMember: fuori 108 (IA vocale) e 201 (bot).

import { revalidatePath, unstable_cache, updateTag } from "next/cache"
import { and, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm"
import { db } from "@/db"
import { appSettings, callLogs, rewardPurchases, users } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { assertSalesArea, currentTenant } from "@/lib/tenancy"
import { countPresences } from "@/lib/presenceCounting"
import { dayBoundsRome, toRomeDateStr, weekBoundsRome } from "@/lib/dateUtils"
import { isTeamMember, peakWindow, personName } from "@/lib/diretta/config"
import { readGamificationTargets, writeSetting } from "@/lib/diretta/settings"
import { PERSONALIZZAZIONI, stileProfilo } from "@/lib/diretta/negozio"
import {
    buildSquadraView, contaFissati, LEADERBOARD_MODE_KEY, parseLeaderboardMode,
    type LeaderboardMode, type SquadraSnapshot, type SquadraView,
} from "@/lib/diretta/squadra"

const FENICE = 'fenice'
const TAG_SQUADRA = 'diretta-squadra'

async function loadSnapshot(day: string): Promise<SquadraSnapshot> {
    const now = new Date()
    const [targets, modeRows] = await Promise.all([
        readGamificationTargets(),
        db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LEADERBOARD_MODE_KEY)).limit(1),
    ])
    const mode = parseLeaderboardMode(modeRows[0]?.value)
    const giorno = dayBoundsRome(now)
    const settimana = weekBoundsRome(now)
    const punta = peakWindow(now, targets)

    const candidati = await db.select({
        id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot,
        firstName: users.firstName, displayName: users.displayName, name: users.name,
        profileImageUrl: users.profileImageUrl,
    }).from(users).where(and(
        eq(users.companyId, FENICE),
        eq(users.role, 'GDO'),
        eq(users.isActive, true),
        isNotNull(users.firstName),
    ))
    const squadra = candidati.filter(isTeamMember)
    const ids = squadra.map(u => u.id)

    const base = {
        day,
        scaliniSquadra: targets.squadra,
        sogliaFenici: targets.presenzeSogliaEuro,
        mode,
    }
    if (ids.length === 0) {
        return { ...base, squadraOggi: 0, punta: punta ? { start: punta.start.toISOString(), end: punta.end.toISOString(), count: 0, scalini: targets.punta } : null, membri: [] }
    }

    const [righe, presenze, stili] = await Promise.all([
        db.select({ userId: callLogs.userId, leadId: callLogs.leadId, createdAt: callLogs.createdAt })
            .from(callLogs)
            .where(and(
                eq(callLogs.companyId, FENICE),
                inArray(callLogs.userId, ids),
                eq(callLogs.outcome, 'APPUNTAMENTO'),
                gte(callLogs.createdAt, settimana.start),
                lt(callLogs.createdAt, settimana.end),
            )),
        Promise.all(ids.map(id => countPresences(id, settimana.start, settimana.end, FENICE))),
        db.select({ userId: rewardPurchases.userId, itemId: rewardPurchases.itemId, price: rewardPurchases.price })
            .from(rewardPurchases)
            .where(and(
                inArray(rewardPurchases.userId, ids),
                ne(rewardPurchases.status, 'annullato'),
                inArray(rewardPurchases.itemId, Object.keys(PERSONALIZZAZIONI)),
            )),
    ])

    const oggi = contaFissati(righe, giorno.start, giorno.end)
    const delPeriodo = contaFissati(righe, settimana.start, settimana.end)
    const inPunta = punta ? contaFissati(righe, punta.start, punta.end).totale : 0

    return {
        ...base,
        squadraOggi: oggi.totale,
        punta: punta ? { start: punta.start.toISOString(), end: punta.end.toISOString(), count: inPunta, scalini: targets.punta } : null,
        membri: squadra.map((u, i) => {
            const stile = stileProfilo(stili.filter(s => s.userId === u.id))
            return {
                id: u.id,
                nome: personName(u),
                presenze: presenze[i].total,
                fissati: delPeriodo.perUtente[u.id] ?? 0,
                immagine: u.profileImageUrl,
                cornice: stile.cornice,
                titolo: stile.titolo,
            }
        }),
    }
}

// Chiave per giorno di Roma: a mezzanotte il conto riparte da solo.
const snapshotInCache = unstable_cache(loadSnapshot, ['diretta-squadra-v1'], { revalidate: 20, tags: [TAG_SQUADRA] })

/** Vista della pagina Squadra per chi guarda (vedi buildSquadraView). */
export async function getSquadraView(): Promise<SquadraView> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const snap = await snapshotInCache(toRomeDateStr(new Date()))
    return buildSquadraView(snap, ctx.userId)
}

// ── Admin: forma della classifica (proposta di Bruno ancora da confermare) ──

/** Solo ADMIN, controllato anche sulla tabella users. */
async function requireAdminId(): Promise<string> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== 'ADMIN') throw new Error('Unauthorized')
    const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, user.id)).limit(1)
    if (row?.role !== 'ADMIN') throw new Error('Unauthorized')
    return user.id
}

export async function getLeaderboardMode(): Promise<LeaderboardMode> {
    await requireAdminId()
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LEADERBOARD_MODE_KEY)).limit(1)
    return parseLeaderboardMode(row?.value)
}

export async function setLeaderboardMode(mode: LeaderboardMode): Promise<{ ok: true } | { ok: false; error: string }> {
    const adminId = await requireAdminId()
    if (mode !== 'top3' && mode !== 'completa' && mode !== 'nessuna') return { ok: false, error: 'Modalità non valida.' }
    try {
        await writeSetting(LEADERBOARD_MODE_KEY, mode, adminId)
    } catch (e) {
        console.error('[squadra] setLeaderboardMode', e)
        return { ok: false, error: 'Salvataggio non riuscito. Riprova tra poco.' }
    }
    updateTag(TAG_SQUADRA)
    revalidatePath('/classifica')
    revalidatePath('/admin/premi')
    return { ok: true }
}
