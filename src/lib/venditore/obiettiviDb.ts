// Letture per obiettivi e guadagni dei venditori (PO 29/10/2026).
// Regole pure in ./obiettivi.ts. Chi chiama decide CHI puo' vedere cosa:
// un venditore solo se stesso, manager e admin tutti.

import { db } from '@/db'
import { leads, users, salesMonthlyTargets, gestionaleCommissioni, gestionaleIncassi } from '@/db/schema'
import { and, eq, gte, lt, lte, isNull, inArray, sql, type SQL } from 'drizzle-orm'
import { monthBoundsRome } from '@/lib/dateUtils'
import { personName } from '@/lib/diretta/config'
import { obiettiviDelMese, calcolaGuadagno, type Obiettivi, type Guadagno, type ObiettiviRow } from './obiettivi'

/** Righe obiettivi fino al mese `ym` compreso (per risalire al mese prima). */
export async function loadObiettiviRows(ym: string, salesUserIds: string[]): Promise<ObiettiviRow[]> {
    if (salesUserIds.length === 0) return []
    return db.select({
        salesUserId: salesMonthlyTargets.salesUserId,
        yearMonth: salesMonthlyTargets.yearMonth,
        target1Eur: salesMonthlyTargets.target1Eur,
        target2Eur: salesMonthlyTargets.target2Eur,
    }).from(salesMonthlyTargets).where(and(
        inArray(salesMonthlyTargets.salesUserId, salesUserIds),
        lte(salesMonthlyTargets.yearMonth, ym),
    ))
}

export async function obiettiviPerVenditori(ym: string, salesUserIds: string[]): Promise<Map<string, Obiettivi>> {
    const rows = await loadObiettiviRows(ym, salesUserIds)
    return new Map(salesUserIds.map(id => [id, obiettiviDelMese(rows, id, ym)]))
}

/**
 * FIRMATO del mese per venditore: somma di closeAmountEur dei lead "Chiuso" con
 * salespersonOutcomeAt nel mese (Europe/Rome). E' la stessa base della barra in
 * KPI venditori / Team Classifica.
 */
export async function firmatoDelMese(ym: string, salesUserIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    if (salesUserIds.length === 0) return out
    const { start, end } = monthBoundsRome(ym)
    const rows = await db.select({
        uid: leads.salespersonUserId,
        firmato: sql<number>`coalesce(sum(${leads.closeAmountEur}), 0)`.mapWith(Number),
    }).from(leads).where(and(
        eq(leads.salespersonOutcome, 'Chiuso'),
        gte(leads.salespersonOutcomeAt, start),
        lt(leads.salespersonOutcomeAt, end),
        inArray(leads.salespersonUserId, salesUserIds),
    )).groupBy(leads.salespersonUserId)
    for (const r of rows) if (r.uid) out.set(r.uid, r.firmato)
    return out
}

/**
 * INCASSATO del mese per venditore, dal gestionale (mese commissione deciso
 * dall'amministrazione). Se l'amministrazione non ha ancora la riga commissioni,
 * si usa la somma degli incassi che contano e il dato e' "provvisorio".
 */
export async function incassatoDelMese(ym: string, salesUserIds: string[]): Promise<Map<string, { cents: number; provvisorio: boolean }>> {
    const out = new Map<string, { cents: number; provvisorio: boolean }>()
    if (salesUserIds.length === 0) return out
    const [comm, righe] = await Promise.all([
        db.select({ uid: gestionaleCommissioni.salesUserId, cents: gestionaleCommissioni.totaleIncassatoCents })
            .from(gestionaleCommissioni)
            .where(and(eq(gestionaleCommissioni.mese, ym), inArray(gestionaleCommissioni.salesUserId, salesUserIds))),
        db.select({
            uid: gestionaleIncassi.salesUserId,
            cents: sql<number>`coalesce(sum(${gestionaleIncassi.importoCents}), 0)`.mapWith(Number),
        }).from(gestionaleIncassi).where(and(
            isNull(gestionaleIncassi.deletedAt),
            eq(gestionaleIncassi.meseCommissione, ym),
            eq(gestionaleIncassi.contaCommissione, true),
            inArray(gestionaleIncassi.salesUserId, salesUserIds),
        )).groupBy(gestionaleIncassi.salesUserId),
    ])
    // Fa fede l'amministrazione: se c'e' la riga commissioni vince sulla somma delle righe.
    const ufficiale = new Map<string, number>()
    for (const c of comm) if (c.uid) ufficiale.set(c.uid, (ufficiale.get(c.uid) ?? 0) + c.cents)
    for (const r of righe) if (r.uid) out.set(r.uid, { cents: r.cents, provvisorio: true })
    for (const [uid, cents] of ufficiale) out.set(uid, { cents, provvisorio: false })
    return out
}

export type GuadagnoVenditore = {
    salesUserId: string
    nome: string
    codice: string
    firmatoEur: number
    obiettivi: Obiettivi
    incassatoCents: number
    incassoProvvisorio: boolean
    guadagno: Guadagno
}

/** Guadagni del mese. `soloUserId` limita a un venditore (vista del venditore). */
export async function loadGuadagniMese(ym: string, opts: { soloUserId?: string; companyFilter?: SQL }): Promise<GuadagnoVenditore[]> {
    const where = [eq(users.role, 'VENDITORE')]
    if (opts.soloUserId) where.push(eq(users.id, opts.soloUserId))
    if (opts.companyFilter) where.push(opts.companyFilter)
    const venditori = await db.select({
        id: users.id, name: users.name, displayName: users.displayName, firstName: users.firstName, isActive: users.isActive,
    }).from(users).where(and(...where))
    const ids = venditori.map(v => v.id)
    const [ob, firm, inc] = await Promise.all([obiettiviPerVenditori(ym, ids), firmatoDelMese(ym, ids), incassatoDelMese(ym, ids)])
    return venditori
        .map(v => {
            const obiettivi = ob.get(v.id) ?? { target1Eur: null, target2Eur: null, daMese: null }
            const firmatoEur = firm.get(v.id) ?? 0
            const i = inc.get(v.id) ?? { cents: 0, provvisorio: true }
            return {
                salesUserId: v.id,
                nome: personName(v),
                codice: v.displayName || v.name || '',
                firmatoEur,
                obiettivi,
                incassatoCents: i.cents,
                incassoProvvisorio: i.provvisorio,
                guadagno: calcolaGuadagno({ incassatoCents: i.cents, firmatoEur, obiettivi }),
                attivo: v.isActive,
            }
        })
        .filter(r => r.attivo || r.incassatoCents !== 0 || r.firmatoEur !== 0)
        .map(({ attivo: _a, ...r }) => r)
        .sort((a, b) => a.codice.localeCompare(b.codice))
}

export type ObiettiviVenditore = { salesUserId: string; nome: string; codice: string; obiettivi: Obiettivi }

/** Solo gli obiettivi del mese (schermata di modifica), senza soldi. */
export async function loadObiettiviMese(ym: string, companyFilter?: SQL): Promise<ObiettiviVenditore[]> {
    const where = [eq(users.role, 'VENDITORE'), eq(users.isActive, true)]
    if (companyFilter) where.push(companyFilter)
    const venditori = await db.select({ id: users.id, name: users.name, displayName: users.displayName, firstName: users.firstName })
        .from(users).where(and(...where))
    const ob = await obiettiviPerVenditori(ym, venditori.map(v => v.id))
    return venditori
        .map(v => ({
            salesUserId: v.id,
            nome: personName(v),
            codice: v.displayName || v.name || '',
            obiettivi: ob.get(v.id) ?? { target1Eur: null, target2Eur: null, daMese: null },
        }))
        .sort((a, b) => a.codice.localeCompare(b.codice))
}
