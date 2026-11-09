// Lettura del salvadanaio del mese dei GDO (PO 09/11/2026), lato server. I
// conti sono in ./premiMese.ts.
//
// Carico: poche query per tutto il mese e per tutti i GDO insieme (roster,
// presenze dei lead, aggiustamenti manuali, settimane registrate), niente
// query per persona. Il risultato è lo stesso per tutti (la classifica serve
// intera anche per il salvadanaio di uno solo): in cache 2 minuti per azienda
// e mese, lo usano sia la pagina admin sia la home di ogni GDO. Niente polling:
// si legge al caricamento della pagina.
//
// Le presenze sono quelle di countPresences (src/lib/presenceCounting.ts):
// lead dell'account, confermati, con presentedAt nella settimana, più gli
// aggiustamenti manuali 'presenze', con la regola dell'account ripartito (118).

import { unstable_cache } from 'next/cache'
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '@/db'
import { leads, manualAdjustments, weeklyPrizeRuns } from '@/db/schema'
import { isTeamMember, personName } from '@/lib/diretta/config'
import { readGamificationTargets } from '@/lib/diretta/settings'
import { sqlLeadConta, sqlRigaConta } from '@/lib/diretta/inizioAccount'
import { leggiInizioAccount } from '@/lib/diretta/vistaDa'
import { readEconomyRules } from './awards'
import { inizioEconomia } from './rules'
import { calcolaPremiMese, settimaneDelMese, type PremiMese, type PresenzaGrezza } from './premiMese'
import { parsePremiSettimana, type PremiSettimana } from './premiSettimana'
import { leggiRosterGdo } from './settimanaDb'

async function calcola(companyId: string, mese: string): Promise<PremiMese> {
    const now = new Date()
    const settimane = settimaneDelMese(mese)
    const [roster, economia, obiettivi, inizioAccount] = await Promise.all([
        leggiRosterGdo(companyId),
        readEconomyRules(),
        readGamificationTargets(),
        leggiInizioAccount(),
    ])
    const gdo = roster.map(u => ({ userId: u.id, nome: personName(u), squadra: isTeamMember(u) }))
    const ids = gdo.map(g => g.userId)
    const base = { mese, now, gdo, inizioEconomia: inizioEconomia(economia), regole: { economia, obiettivi } }
    if (settimane.length === 0 || ids.length === 0) return calcolaPremiMese({ ...base, presenze: [], registrate: {} })

    const start = settimane[0].start
    const end = settimane[settimane.length - 1].end
    const [presentati, aggiustamenti, registrate] = await Promise.all([
        db.select({ userId: leads.assignedToId, at: leads.presentedAt }).from(leads).where(and(
            eq(leads.companyId, companyId),
            inArray(leads.assignedToId, ids),
            eq(leads.confirmationsOutcome, 'confermato'),
            isNotNull(leads.presentedAt),
            gte(leads.presentedAt, start),
            lt(leads.presentedAt, end),
            sqlLeadConta(inizioAccount, leads),
        )),
        db.select({ userId: manualAdjustments.userId, at: manualAdjustments.createdAt, n: manualAdjustments.count })
            .from(manualAdjustments).where(and(
                eq(manualAdjustments.companyId, companyId),
                inArray(manualAdjustments.userId, ids),
                eq(manualAdjustments.type, 'presenze'),
                gte(manualAdjustments.createdAt, start),
                lt(manualAdjustments.createdAt, end),
                sqlRigaConta(inizioAccount, manualAdjustments.userId, manualAdjustments.createdAt),
            )).catch(() => [] as { userId: string; at: Date; n: number }[]),
        db.select({ weekStart: weeklyPrizeRuns.weekStart, snapshot: weeklyPrizeRuns.snapshot }).from(weeklyPrizeRuns).where(and(
            eq(weeklyPrizeRuns.companyId, companyId),
            inArray(weeklyPrizeRuns.weekStart, settimane.map(s => s.lunedi)),
        )),
    ])

    const presenze: PresenzaGrezza[] = [
        ...presentati.filter(p => p.userId && p.at).map(p => ({ userId: p.userId as string, at: p.at as Date, n: 1 })),
        ...aggiustamenti.map(a => ({ userId: a.userId, at: a.at, n: a.n || 0 })),
    ]
    const snapshot: Record<string, PremiSettimana> = {}
    for (const r of registrate) {
        const p = parsePremiSettimana(r.snapshot)
        if (p) snapshot[r.weekStart] = p
    }
    return calcolaPremiMese({ ...base, presenze, registrate: snapshot })
}

const inCache = unstable_cache(calcola, ['premi-mese-gdo-v1'], { revalidate: 120 })

/** Bonus del mese di tutti i GDO (settimane chiuse + quella in corso), in cache 2 minuti. */
export function leggiPremiMese(companyId: string, mese: string): Promise<PremiMese> {
    return inCache(companyId, mese)
}
