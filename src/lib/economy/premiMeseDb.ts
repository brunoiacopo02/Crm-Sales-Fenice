// Lettura del salvadanaio del mese dei GDO (PO 09/11/2026) e delle Conferme
// (titolare 14/11/2026), lato server. I conti sono in ./premiMese.ts.
//
// Carico: poche query per tutto il mese e per tutti insieme (roster,
// presenze dei lead, aggiustamenti manuali, settimane registrate, numeri
// delle Conferme), niente query per persona. Il risultato è lo stesso per
// tutti (la classifica serve intera anche per il salvadanaio di uno solo): in
// cache 2 minuti per azienda e mese, lo usano la pagina admin, la home di ogni
// GDO e la colonna delle Conferme. Niente polling: si legge al caricamento.
//
// Le presenze sono quelle di countPresences (src/lib/presenceCounting.ts):
// lead dell'account, confermati, con presentedAt nella settimana, più gli
// aggiustamenti manuali 'presenze', con la regola dell'account ripartito (118).
//
// Conferme: gli stessi filtri dei premi della settimana (confermatiDalleConferme
// in ./settimanaDb.ts). Le persone si leggono anche se oggi disattivate: chi ha
// lavorato in una settimana passata del mese prende comunque la sua quota.

import { unstable_cache } from 'next/cache'
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, leads, manualAdjustments, users, weeklyPrizeRuns } from '@/db/schema'
import { CONFERME_BONUS_KEY, parseConfermeBonus } from '@/lib/conferme/bonus'
import { isTeamMember, personName } from '@/lib/diretta/config'
import { readGamificationTargets } from '@/lib/diretta/settings'
import { sqlLeadConta, sqlRigaConta } from '@/lib/diretta/inizioAccount'
import { leggiInizioAccount } from '@/lib/diretta/vistaDa'
import { accountVero } from '@/lib/prova/sql'
import { readEconomyRules } from './awards'
import { inizioEconomia, isConfermePersona } from './rules'
import {
    calcolaPremiMese, meseDelSalvadanaio, meseDellaSettimana, salvadanaioConfermeDi, settimanaConfermeDi, settimanaScorsa, settimaneDelMese,
    type ConfermeGrezze, type PremiMese, type PresenzaGrezza, type VistaSalvadanaioConferme,
} from './premiMese'
import { parsePremiSettimana, type PremiSettimana } from './premiSettimana'
import { confermatiDalleConferme, leggiRosterGdo, nomeConferme } from './settimanaDb'

async function leggiRegolaConferme() {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings)
        .where(eq(appSettings.key, CONFERME_BONUS_KEY)).limit(1)
    return parseConfermeBonus(row?.value)
}

/** Numeri grezzi delle Conferme fra start ed end (fine esclusa), divisi per settimana in ./premiMese.ts. */
async function leggiConfermeGrezze(companyId: string, start: Date, end: Date): Promise<ConfermeGrezze> {
    const confermati = confermatiDalleConferme(companyId)
    const [regola, persone, chiusure, presenze, confermate] = await Promise.all([
        leggiRegolaConferme(),
        db.select({
            id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot,
            firstName: users.firstName, name: users.name, displayName: users.displayName,
        }).from(users).where(and(eq(users.role, 'CONFERME'), eq(users.isBot, false), accountVero())),
        db.select({ at: leads.salespersonOutcomeAt }).from(leads).where(and(
            confermati,
            eq(leads.salespersonOutcome, 'Chiuso'),
            gte(leads.salespersonOutcomeAt, start),
            lt(leads.salespersonOutcomeAt, end),
        )),
        db.select({ at: leads.presentedAt }).from(leads).where(and(
            confermati,
            gte(leads.presentedAt, start),
            lt(leads.presentedAt, end),
        )),
        db.select({ userId: leads.confirmationsUserId, at: leads.confirmationsTimestamp }).from(leads).where(and(
            confermati,
            gte(leads.confirmationsTimestamp, start),
            lt(leads.confirmationsTimestamp, end),
        )),
    ])
    return {
        regola,
        persone: persone.map(u => ({ userId: u.id, nome: nomeConferme(u), squadra: isConfermePersona(u) })),
        chiusure: chiusure.flatMap(r => (r.at ? [r.at] : [])),
        presenze: presenze.flatMap(r => (r.at ? [r.at] : [])),
        confermate: confermate.flatMap(r => (r.userId && r.at ? [{ userId: r.userId, at: r.at }] : [])),
    }
}

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
    if (settimane.length === 0) return calcolaPremiMese({ ...base, presenze: [], registrate: {} })

    const start = settimane[0].start
    const end = settimane[settimane.length - 1].end
    const [presentati, aggiustamenti, registrate, conferme] = await Promise.all([
        ids.length === 0 ? [] : db.select({ userId: leads.assignedToId, at: leads.presentedAt }).from(leads).where(and(
            eq(leads.companyId, companyId),
            inArray(leads.assignedToId, ids),
            eq(leads.confirmationsOutcome, 'confermato'),
            isNotNull(leads.presentedAt),
            gte(leads.presentedAt, start),
            lt(leads.presentedAt, end),
            sqlLeadConta(inizioAccount, leads),
        )),
        ids.length === 0 ? [] : db.select({ userId: manualAdjustments.userId, at: manualAdjustments.createdAt, n: manualAdjustments.count })
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
        leggiConfermeGrezze(companyId, start, end),
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
    return calcolaPremiMese({ ...base, presenze, registrate: snapshot, conferme })
}

/** Lo stesso calcolo senza cache, per gli script di anteprima in sola lettura. */
export const leggiPremiMeseSenzaCache = calcola

// v2 (14/11/2026): dentro ci sono anche le Conferme e il ruolo di ogni riga.
const inCache = unstable_cache(calcola, ['premi-mese-gdo-v2'], { revalidate: 120 })

/** Bonus del mese di tutti i GDO e delle Conferme (settimane chiuse + quella in corso), in cache 2 minuti. */
export function leggiPremiMese(companyId: string, mese: string): Promise<PremiMese> {
    return inCache(companyId, mese)
}

/** Quello che vede una persona delle Conferme: la settimana scorsa e il suo mese finora. */
export async function leggiSalvadanaioConferme(companyId: string, userId: string, now = new Date()): Promise<VistaSalvadanaioConferme> {
    const mese = meseDelSalvadanaio(now)
    const scorsa = settimanaScorsa(now)
    const meseScorsa = meseDellaSettimana(scorsa)
    const [m, mPrima] = await Promise.all([
        leggiPremiMese(companyId, mese),
        meseScorsa === mese ? null : leggiPremiMese(companyId, meseScorsa),
    ])
    const s = (mPrima ?? m).chiuse.find(x => x.lunedi === scorsa.lunedi)
    return { scorsa: s ? settimanaConfermeDi(s, userId) : null, mese: salvadanaioConfermeDi(m, userId) }
}
