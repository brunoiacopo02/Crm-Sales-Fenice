"use server"

// Avviso "ora affollata" nel popover Appuntamento del GDO (PO 09/11/2026): quante
// call ci sono già nel giorno scelto, ora per ora. Solo lettura, in cache 60 s.

import { ruoloDb } from '@/lib/auth/ruoloDb'
import { leggiOreOccupate } from '@/lib/conferme/oreOccupateDb'
import type { ContaOre } from '@/lib/conferme/oreOccupate'

export async function oreOccupateDelGiorno(giorno: string): Promise<{ conta: ContaOre; soglia: number } | null> {
    if (!(await ruoloDb())) return null
    const ore = await leggiOreOccupate([giorno])
    const conta = ore?.giorni[giorno]
    return ore && conta ? { conta, soglia: ore.soglia } : null
}
