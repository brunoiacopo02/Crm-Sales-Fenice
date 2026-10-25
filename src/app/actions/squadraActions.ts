"use server"

// Pagina Squadra della Diretta (/classifica con l'interruttore acceso).
//
// I numeri sono uguali per tutti, quindi si calcolano una volta ogni 20 s per
// giorno di Roma (unstable_cache) e non a ogni visita: niente carico nuovo sul
// database anche con tutta la sala sulla pagina. Le query sono quattro:
// squadra, appuntamenti della settimana, presenze (countPresences per persona,
// indice leads_presented_at_idx) e personalizzazioni.
//
// "Fissato" = fissato valido (src/lib/diretta/fissati.ts), con la stessa query
// della home, degli scalini personali e dei forzieri. Squadra = isTeamMember:
// fuori 108 (IA vocale) e 201 (bot).
//
// La settimana della classifica va da lunedì a sabato (di domenica resta
// quella appena chiusa) e i premi in euro dei primi tre vengono dalle regole
// dell'economia: gli stessi che l'admin registra a settimana chiusa.

import { revalidatePath, unstable_cache, updateTag } from "next/cache"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { appSettings, rewardPurchases } from "@/db/schema"
import { assertSalesArea, currentTenant } from "@/lib/tenancy"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { countPresences } from "@/lib/presenceCounting"
import { dayBoundsRome, toRomeDateStr } from "@/lib/dateUtils"
import { peakWindow, personName } from "@/lib/diretta/config"
import { readGamificationTargets, writeSetting } from "@/lib/diretta/settings"
import { contaFissati } from "@/lib/diretta/fissati"
import { leggiFissati, leggiMembriSquadra } from "@/lib/diretta/fissatiDb"
import { PERSONALIZZAZIONI, stileProfilo } from "@/lib/diretta/negozio"
import { readEconomyRules } from "@/lib/economy/awards"
import { settimanaLunSab } from "@/lib/economy/premiSettimana"
import {
    buildSquadraView, LEADERBOARD_MODE_KEY, parseLeaderboardMode,
    type LeaderboardMode, type SquadraSnapshot, type SquadraView,
} from "@/lib/diretta/squadra"

const FENICE = 'fenice'
const TAG_SQUADRA = 'diretta-squadra'

async function loadSnapshot(day: string): Promise<SquadraSnapshot> {
    const now = new Date()
    const [targets, modeRows, economia] = await Promise.all([
        readGamificationTargets(),
        db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LEADERBOARD_MODE_KEY)).limit(1),
        readEconomyRules(),
    ])
    const mode = parseLeaderboardMode(modeRows[0]?.value)
    const giorno = dayBoundsRome(now)
    const settimana = settimanaLunSab(now)
    const punta = peakWindow(now, targets)

    const squadra = await leggiMembriSquadra(FENICE)
    const ids = squadra.map(u => u.id)

    const base = {
        day,
        scaliniSquadra: targets.squadra,
        sogliaFenici: targets.presenzeSogliaEuro,
        mode,
        // I premi in euro valgono dalla prima settimana della nuova economia
        // (26/10): il podio di una settimana di prima resta senza euro, così
        // nessuno lo legge come un premio da incassare (collaudo del 25/10/2026).
        premiEuro: settimana.lunedi >= economia.inizio ? economia.classifica.premiEuro : [0, 0, 0] as [number, number, number],
        minPresenze: economia.classifica.minPresenze,
        settimana: { lunedi: settimana.lunedi, sabato: settimana.sabato },
    }
    if (ids.length === 0) {
        return { ...base, squadraOggi: 0, punta: punta ? { start: punta.start.toISOString(), end: punta.end.toISOString(), count: 0, scalini: targets.punta } : null, membri: [] }
    }

    const [righe, presenze, stili] = await Promise.all([
        leggiFissati({ companyId: FENICE, userIds: ids, start: settimana.start, end: settimana.end }),
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
const snapshotInCache = unstable_cache(loadSnapshot, ['diretta-squadra-v2'], { revalidate: 20, tags: [TAG_SQUADRA] })

/** Vista della pagina Squadra per chi guarda (vedi buildSquadraView). */
export async function getSquadraView(): Promise<SquadraView> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const snap = await snapshotInCache(toRomeDateStr(new Date()))
    return buildSquadraView(snap, ctx.userId)
}

// ── Admin: forma della classifica (proposta di Bruno ancora da confermare) ──

/** Solo ADMIN, letto dalla tabella users. */
async function requireAdminId(): Promise<string> {
    const admin = await conRuoloDb(['ADMIN'])
    if (!admin) throw new Error('Unauthorized')
    return admin.id
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
