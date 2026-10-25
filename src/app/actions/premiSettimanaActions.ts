"use server"

// Premi in euro della settimana (PO 25/10/2026, seconda tornata): a settimana
// chiusa l'admin calcola e registra classifica dei primi tre, bonus presenze
// dei GDO e bonus di squadra delle Conferme (tabella weeklyPrizeRuns, migr.
// 0049). Solo ADMIN, letto dalla tabella users. I conti sono puri in
// src/lib/economy/premiSettimana.ts, la lettura in settimanaDb.ts.
//
// Queste action non muovono Scintille né Piume per conto loro: la
// registrazione riallinea soltanto gli obiettivi settimanali delle Conferme
// (src/lib/economy/awards.ts), come farebbe il prossimo esito.

import { revalidatePath } from "next/cache"
import { and, desc, eq, gte } from "drizzle-orm"
import { db } from "@/db"
import { appSettings, users, weeklyPrizeRuns } from "@/db/schema"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { personName } from "@/lib/diretta/config"
import { readGamificationTargets } from "@/lib/diretta/settings"
import { CONFERME_BONUS_KEY, parseConfermeBonus } from "@/lib/conferme/bonus"
import { readEconomyRules, riallineaObiettiviConferme } from "@/lib/economy/awards"
import { inizioEconomia } from "@/lib/economy/rules"
import {
    calcolaPremiSettimana, parsePremiSettimana, settimanaChiusa, settimanaDaLunedi, settimanaLunSab, settimanaPrima,
    type PremiSettimana,
} from "@/lib/economy/premiSettimana"
import { leggiNumeriSettimana } from "@/lib/economy/settimanaDb"

const FENICE = 'fenice'
/** Settimane mostrate nello storico. */
const SETTIMANE_STORICO = 12

export interface SettimanaPremi {
    lunedi: string
    sabato: string
    chiusa: boolean
    registrata: { premi: PremiSettimana; computedAt: string; computedBy: string | null } | null
}

async function requireAdminId(): Promise<string> {
    const admin = await conRuoloDb(['ADMIN'])
    if (!admin) throw new Error('Unauthorized')
    return admin.id
}

async function leggiConfigConferme() {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings)
        .where(eq(appSettings.key, CONFERME_BONUS_KEY)).limit(1)
    return parseConfermeBonus(row?.value)
}

/** Settimane dall'avvio dell'economia a oggi, dalla più recente, con quello che è già registrato. */
export async function getPremiSettimane(): Promise<SettimanaPremi[]> {
    await requireAdminId()
    const now = new Date()
    const rules = await readEconomyRules()
    const prima = settimanaLunSab(inizioEconomia(rules))

    const settimane = []
    for (let s = settimanaLunSab(now); s.start.getTime() >= prima.start.getTime() && settimane.length < SETTIMANE_STORICO; s = settimanaPrima(s)) {
        settimane.push(s)
    }
    if (settimane.length === 0) return []

    const registrate = await db.select({
        weekStart: weeklyPrizeRuns.weekStart,
        snapshot: weeklyPrizeRuns.snapshot,
        computedAt: weeklyPrizeRuns.computedAt,
        firstName: users.firstName, displayName: users.displayName, name: users.name,
    })
        .from(weeklyPrizeRuns)
        .leftJoin(users, eq(users.id, weeklyPrizeRuns.computedBy))
        .where(and(eq(weeklyPrizeRuns.companyId, FENICE), gte(weeklyPrizeRuns.weekStart, settimane[settimane.length - 1].lunedi)))
        .orderBy(desc(weeklyPrizeRuns.weekStart))
    const perLunedi = new Map(registrate.map(r => [r.weekStart, r]))

    return settimane.map(s => {
        const r = perLunedi.get(s.lunedi)
        const premi = r ? parsePremiSettimana(r.snapshot) : null
        return {
            lunedi: s.lunedi,
            sabato: s.sabato,
            chiusa: settimanaChiusa(s, now),
            registrata: r && premi
                ? { premi, computedAt: r.computedAt.toISOString(), computedBy: r.name || r.displayName || r.firstName ? personName(r) : null }
                : null,
        }
    })
}

/**
 * Calcola i premi della settimana del `lunedi`. Con `registra` (solo a
 * settimana chiusa) li scrive in weeklyPrizeRuns, sostituendo un calcolo
 * precedente, e riallinea gli obiettivi settimanali delle Conferme.
 */
export async function calcolaPremiSettimanaAdmin(
    lunedi: string,
    registra: boolean,
): Promise<{ ok: true; premi: PremiSettimana; registrata: boolean } | { ok: false; error: string }> {
    let adminId: string
    try {
        adminId = await requireAdminId()
    } catch {
        return { ok: false, error: 'Non autorizzato.' }
    }
    const settimana = settimanaDaLunedi(lunedi)
    if (!settimana) return { ok: false, error: 'Settimana non valida: serve la data di un lunedì.' }
    const now = new Date()
    if (registra && !settimanaChiusa(settimana, now)) {
        return { ok: false, error: 'La settimana non è ancora chiusa: si registra dalla domenica in poi.' }
    }

    try {
        const [economia, obiettivi, conferme, numeri] = await Promise.all([
            readEconomyRules(),
            readGamificationTargets(),
            leggiConfigConferme(),
            leggiNumeriSettimana(FENICE, settimana),
        ])
        if (registra && settimana.end.getTime() <= inizioEconomia(economia).getTime()) {
            return { ok: false, error: 'Questa settimana è prima dei premi nuovi: si guarda in anteprima ma non si registra.' }
        }
        const premi = calcolaPremiSettimana(numeri, { economia, obiettivi, conferme })
        if (!registra) return { ok: true, premi, registrata: false }

        // Prima gli obiettivi delle Conferme (Piume), poi la riga dei premi in euro.
        for (const p of numeri.conferme.persone) {
            await riallineaObiettiviConferme(p.userId, settimana.lunedi, economia)
                .catch((e: unknown) => console.error('[premi settimana] obiettivi Conferme', p.userId, e))
        }
        await db.insert(weeklyPrizeRuns).values({
            companyId: FENICE,
            weekStart: settimana.lunedi,
            snapshot: premi,
            totalEur: premi.totaleEuro.toFixed(2),
            computedAt: now,
            computedBy: adminId,
        }).onConflictDoUpdate({
            target: [weeklyPrizeRuns.companyId, weeklyPrizeRuns.weekStart],
            set: { snapshot: premi, totalEur: premi.totaleEuro.toFixed(2), computedAt: now, computedBy: adminId },
        })
        revalidatePath('/admin/diretta/premi-settimana')
        return { ok: true, premi, registrata: true }
    } catch (e) {
        console.error('[premi settimana] calcolo', lunedi, e)
        return { ok: false, error: 'Calcolo non riuscito. Riprova tra poco.' }
    }
}
