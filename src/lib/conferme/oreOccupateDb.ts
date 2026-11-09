// Lettura delle ore occupate (PO 09/11/2026), per /api/bot/ore-occupate e per
// l'avviso al GDO. Regole in oreOccupate.ts.
//
// Costo: una query sugli appuntamenti vivi dei giorni chiesti (usa l'indice su
// appointmentDate, poche decine di righe al giorno) e una lettura di appSettings
// per chiave. In cache 60 secondi per insieme di giorni: il bot la chiede a ogni
// giro di risposte, i GDO a ogni cambio di data nel popover.

import { unstable_cache } from 'next/cache'
import { and, eq, gte, lt, ne, or, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, leads } from '@/db/schema'
import { dayBoundsRome } from '@/lib/dateUtils'
import { leadVero } from '@/lib/prova/sql'
import { CHIAVE_SOGLIA_ORA_AFFOLLATA, contaPerOra, parseSogliaOraAffollata, type ContaOre } from './oreOccupate'

export type OreOccupate = { soglia: number; giorni: Record<string, ContaOre> }

const GIORNO = /^\d{4}-\d{2}-\d{2}$/

async function leggi(chiave: string): Promise<OreOccupate> {
    const giorni = chiave.split(',')
    const ordinati = [...giorni].sort()
    const inizio = dayBoundsRome(new Date(`${ordinati[0]}T12:00:00Z`)).start
    const fine = dayBoundsRome(new Date(`${ordinati[ordinati.length - 1]}T12:00:00Z`)).end

    const [righe, impostazione] = await Promise.all([
        db.select({ appointmentDate: leads.appointmentDate }).from(leads).where(and(
            eq(leads.companyId, 'fenice'),
            eq(leads.status, 'APPOINTMENT'),
            leadVero(),
            // Scartato dalle Conferme: quella call non si farà, non occupa l'ora.
            or(isNull(leads.confirmationsOutcome), ne(leads.confirmationsOutcome, 'scartato')),
            gte(leads.appointmentDate, inizio),
            lt(leads.appointmentDate, fine),
        )),
        db.select({ value: appSettings.value }).from(appSettings)
            .where(eq(appSettings.key, CHIAVE_SOGLIA_ORA_AFFOLLATA)).limit(1),
    ])

    return {
        soglia: parseSogliaOraAffollata(impostazione[0]?.value),
        giorni: contaPerOra(righe.map((r) => r.appointmentDate), giorni),
    }
}

const inCache = unstable_cache(leggi, ['ore-occupate-v1'], { revalidate: 60 })

/**
 * Ore occupate dei `giorni` ('YYYY-MM-DD' di Roma, al massimo 3). null se i giorni
 * non sono validi o la lettura non riesce: chi chiama fa come se non sapesse niente.
 */
export async function leggiOreOccupate(giorni: readonly string[]): Promise<OreOccupate | null> {
    const puliti = [...new Set(giorni)].filter((g) => GIORNO.test(g)).sort()
    if (puliti.length === 0 || puliti.length > 3 || puliti.length !== new Set(giorni).size) return null
    try {
        return await inCache(puliti.join(','))
    } catch (e) {
        console.error('[ore occupate] lettura', e)
        return null
    }
}
