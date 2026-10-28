"use server"

// Pagina /statistiche-fissatore rifatta il 28/10/2026 (PO): sostituisce
// botStatsActions.ts, che contava come "ridati ai GDO" anche i parcheggiati e
// leggeva tutto lo storico a ogni caricamento. I conti sono puri in
// src/lib/bot-fissatore/statisticheFissatore.ts, le letture in statisticheDb.ts.

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { appSettings } from "@/db/schema"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { findLancioBotId } from "@/lib/lancio/botAccount"
import { meseDaParametro, mesePrecedente } from "@/lib/bot-fissatore/statisticheFissatore"
import { calcolaNumeriFissatore, type NumeriDelMese } from "@/lib/bot-fissatore/statisticheDb"
import {
    OBIETTIVI_FISSATORE_KEY, CHIAVI_OBIETTIVI, leggiObiettiviSalvati, risolviObiettivi, validaObiettivi,
    type ChiaveObiettivo, type ObiettiviRisolti, type ObiettiviSalvati,
} from "@/lib/bot-fissatore/obiettiviFissatore"
import { OBIETTIVI_FISSATORE_DEFAULT } from "@/lib/bot-fissatore/obiettiviFissatoreDefault"

const FENICE = 'fenice'
const RUOLI_PAGINA = ['MANAGER', 'ADMIN', 'TL'] as const

export interface StatisticheFissatore {
    mese: string
    mesePrima: string
    /** Mese di Roma di oggi: oltre non si va. */
    meseCorrente: string
    questo: NumeriDelMese
    prima: NumeriDelMese
    obiettivi: ObiettiviRisolti
    /** Valori scritti dall'admin (per precompilare il form). */
    obiettiviSalvati: ObiettiviSalvati
    isAdmin: boolean
    /** Istante di calcolo: gli appuntamenti contati sono quelli prima di questo. */
    calcolatoIl: string
}

async function leggiObiettivi(): Promise<ObiettiviSalvati> {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings)
        .where(eq(appSettings.key, OBIETTIVI_FISSATORE_KEY)).limit(1)
    return leggiObiettiviSalvati(row?.value)
}

/** null = account del bot non trovato. Lancia 'Unauthorized' fuori da MANAGER/ADMIN/TL. */
export async function getStatisticheFissatore(meseParam?: string): Promise<StatisticheFissatore | null> {
    const utente = await conRuoloDb(RUOLI_PAGINA)
    if (!utente) throw new Error('Unauthorized')

    const ora = new Date()
    const mese = meseDaParametro(meseParam, ora)

    const botId = await findLancioBotId()
    if (!botId) return null

    const [numeri, salvati] = await Promise.all([
        calcolaNumeriFissatore(botId, mese, ora),
        leggiObiettivi(),
    ])

    return {
        mese,
        mesePrima: mesePrecedente(mese),
        meseCorrente: meseDaParametro(undefined, ora),
        questo: numeri.questo,
        prima: numeri.prima,
        obiettivi: risolviObiettivi(salvati, OBIETTIVI_FISSATORE_DEFAULT),
        obiettiviSalvati: salvati,
        isAdmin: utente.role === 'ADMIN',
        calcolatoIl: ora.toISOString(),
    }
}

/** Solo ADMIN (ruolo letto dalla tabella users). Campo vuoto = torna al default. */
export async function salvaObiettiviFissatore(
    input: Record<ChiaveObiettivo, string>,
): Promise<{ ok: true } | { ok: false; errore: string }> {
    const admin = await conRuoloDb(['ADMIN'])
    if (!admin) return { ok: false, errore: "Solo l'admin può cambiare gli obiettivi" }

    const pulito = {} as Record<ChiaveObiettivo, string>
    for (const k of CHIAVI_OBIETTIVI) pulito[k] = typeof input?.[k] === 'string' ? input[k] : ''
    const v = validaObiettivi(pulito)
    if (!v.ok) return v

    const now = new Date()
    const value = JSON.stringify(v.valori)
    await db.insert(appSettings)
        .values({ key: OBIETTIVI_FISSATORE_KEY, value, updatedAt: now, updatedBy: admin.id, companyId: FENICE })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now, updatedBy: admin.id } })
    revalidatePath('/statistiche-fissatore')
    return { ok: true }
}
