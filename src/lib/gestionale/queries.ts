import { db } from '@/db'
import { users, gestionaleContratti, gestionaleRate, gestionaleIncassi, gestionaleCommissioni, gestionaleSyncRuns, salesLatePenalties } from '@/db/schema'
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { sellerMonthSummary, effectiveRunStatus, cashTotalCents, commissionableSumCents, classifyAtRisk, sellersWithoutCommission, multeTotalCents, type SellerMonth, type AtRiskRow } from './metrics'
import { DIREZIONE } from './types'

export type LastRun = { status: string; startedAt: Date; finishedAt: Date | null; error: string | null; warnings: string[] } | null

export async function loadLastRun(): Promise<LastRun> {
    const [r] = await db.select().from(gestionaleSyncRuns).orderBy(desc(gestionaleSyncRuns.startedAt)).limit(1)
    if (!r) return null
    const { status, error } = effectiveRunStatus(r, new Date())
    return { status, startedAt: r.startedAt, finishedAt: r.finishedAt, error, warnings: r.warnings ?? [] }
}

export async function loadLastOkAt(): Promise<Date | null> {
    const [r] = await db.select({ f: gestionaleSyncRuns.finishedAt }).from(gestionaleSyncRuns)
        .where(eq(gestionaleSyncRuns.status, 'ok')).orderBy(desc(gestionaleSyncRuns.startedAt)).limit(1)
    return r?.f ?? null
}

export type IncassoView = { id: string; data: string | null; importoCents: number; voce: string | null; stato: string | null; contaCommissione: boolean; cliente: string; venditoreCode: string | null; salesUserId: string | null }
/** `missingCommission`: venditore con incassi o multe nel mese ma senza riga commissioni dal gestionale. */
export type SellerRow = { venditoreCode: string; salesUserId: string | null; summary: SellerMonth; missingCommission: boolean }
export type AdminMonth = { cashCents: number; direzioneCashCents: number; sellers: SellerRow[]; multeCents: number; incassi: IncassoView[]; atRisk: AtRiskRow[]; hasData: boolean }
export type SellerMonthView = { summary: SellerMonth; incassi: IncassoView[]; commissionableCents: number; atRisk: AtRiskRow[]; hasData: boolean }

function monthBounds(mese: string): { from: string; to: string } {
    const [y, m] = mese.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return { from: `${mese}-01`, to: `${next}-01` }
}

const incassoCols = {
    id: gestionaleIncassi.id, data: gestionaleIncassi.data, importoCents: gestionaleIncassi.importoCents,
    voce: gestionaleIncassi.voce, stato: gestionaleIncassi.stato, contaCommissione: gestionaleIncassi.contaCommissione,
    venditoreCode: gestionaleIncassi.venditoreCode, salesUserId: gestionaleIncassi.salesUserId,
    nome: gestionaleContratti.clienteNome, cognome: gestionaleContratti.clienteCognome,
}
type IncassoRaw = { id: string; data: string | null; importoCents: number; voce: string | null; stato: string | null; contaCommissione: boolean; venditoreCode: string | null; salesUserId: string | null; nome: string | null; cognome: string | null }
const toView = (r: IncassoRaw): IncassoView => ({
    id: r.id, data: r.data, importoCents: r.importoCents, voce: r.voce, stato: r.stato, contaCommissione: r.contaCommissione,
    venditoreCode: r.venditoreCode, salesUserId: r.salesUserId,
    cliente: [r.nome, r.cognome].filter(Boolean).join(' ') || '—',
})

async function multeByUser(mese: string, salesUserId?: string): Promise<Map<string, number>> {
    const rows = await db.select({ u: salesLatePenalties.salesUserId, eur: sql<number>`coalesce(sum(${salesLatePenalties.amountEur}), 0)` })
        .from(salesLatePenalties)
        .where(and(
            eq(salesLatePenalties.monthKey, mese),
            eq(salesLatePenalties.companyId, 'fenice'),
            isNull(salesLatePenalties.voidedAt),
            salesUserId ? eq(salesLatePenalties.salesUserId, salesUserId) : undefined,
        ))
        .groupBy(salesLatePenalties.salesUserId)
    return new Map(rows.map(r => [r.u, Number(r.eur)]))
}

async function atRiskFor(salesUserId?: string, today = ''): Promise<AtRiskRow[]> {
    const contratti = await db.select({
        id: gestionaleContratti.id, clienteNome: gestionaleContratti.clienteNome, clienteCognome: gestionaleContratti.clienteCognome,
        clienteTelefono: gestionaleContratti.clienteTelefono, venditoreCode: gestionaleContratti.venditoreCode,
        salesUserId: gestionaleContratti.salesUserId, statoPagamento: gestionaleContratti.statoPagamento, dataFirma: gestionaleContratti.dataFirma,
    }).from(gestionaleContratti).where(and(
        isNull(gestionaleContratti.deletedAt),
        salesUserId ? eq(gestionaleContratti.salesUserId, salesUserId) : undefined,
    ))
    if (contratti.length === 0) return []
    const ids = contratti.map(c => c.id)
    const rate = []
    for (let i = 0; i < ids.length; i += 500) {
        rate.push(...await db.select({
            contrattoId: gestionaleRate.contrattoId, scadenza: gestionaleRate.scadenza, importoCents: gestionaleRate.importoCents, stato: gestionaleRate.stato,
        }).from(gestionaleRate).where(and(isNull(gestionaleRate.deletedAt), inArray(gestionaleRate.contrattoId, ids.slice(i, i + 500)))))
    }
    return classifyAtRisk(contratti, rate, today)
}

export async function loadAdminMonth(mese: string, today: string): Promise<AdminMonth> {
    const { from, to } = monthBounds(mese)
    const [incassiRaw, commRows, multe, atRisk] = await Promise.all([
        db.select(incassoCols).from(gestionaleIncassi)
            .leftJoin(gestionaleContratti, eq(gestionaleContratti.id, gestionaleIncassi.contrattoId))
            .where(and(isNull(gestionaleIncassi.deletedAt), gte(gestionaleIncassi.data, from), lt(gestionaleIncassi.data, to)))
            .orderBy(desc(gestionaleIncassi.data)),
        db.select().from(gestionaleCommissioni).where(eq(gestionaleCommissioni.mese, mese)),
        multeByUser(mese),
        atRiskFor(undefined, today),
    ])
    const incassi = incassiRaw.map(toView)
    const withComm: SellerRow[] = commRows
        .filter(c => c.venditoreCode !== DIREZIONE)
        .map(c => ({ venditoreCode: c.venditoreCode, salesUserId: c.salesUserId, summary: sellerMonthSummary(c, c.salesUserId ? multe.get(c.salesUserId) ?? 0 : 0), missingCommission: false }))
    const missing = sellersWithoutCommission(incassi, mese, multe, new Set(commRows.flatMap(c => (c.salesUserId ? [c.salesUserId] : []))))
    const names = missing.length === 0 ? [] : await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, missing.map(m => m.salesUserId)))
    const nameById = new Map(names.map(n => [n.id, n.name]))
    const withoutComm: SellerRow[] = missing.map(m => ({
        venditoreCode: nameById.get(m.salesUserId)?.trim() || m.salesUserId,
        salesUserId: m.salesUserId,
        summary: { ...sellerMonthSummary(undefined, multe.get(m.salesUserId) ?? 0), incassatoCents: m.incassatoCents },
        missingCommission: true,
    }))
    const sellers = [...withComm, ...withoutComm].sort((a, b) => a.venditoreCode.localeCompare(b.venditoreCode))
    return {
        cashCents: cashTotalCents(incassi, mese),
        direzioneCashCents: cashTotalCents(incassi.filter(i => i.venditoreCode === DIREZIONE || !i.venditoreCode), mese),
        multeCents: multeTotalCents(multe),
        sellers, incassi, atRisk,
        hasData: commRows.length > 0 || incassi.length > 0,
    }
}

export async function loadSellerMonth(salesUserId: string, mese: string, today: string): Promise<SellerMonthView> {
    const [incassiRaw, commRows, multe, atRisk] = await Promise.all([
        db.select(incassoCols).from(gestionaleIncassi)
            .leftJoin(gestionaleContratti, eq(gestionaleContratti.id, gestionaleIncassi.contrattoId))
            .where(and(isNull(gestionaleIncassi.deletedAt), eq(gestionaleIncassi.salesUserId, salesUserId), eq(gestionaleIncassi.meseCommissione, mese)))
            .orderBy(desc(gestionaleIncassi.data)),
        db.select().from(gestionaleCommissioni).where(and(eq(gestionaleCommissioni.mese, mese), eq(gestionaleCommissioni.salesUserId, salesUserId))),
        multeByUser(mese, salesUserId),
        atRiskFor(salesUserId, today),
    ])
    const incassi = incassiRaw.map(toView)
    return {
        summary: sellerMonthSummary(commRows[0], multe.get(salesUserId) ?? 0),
        incassi,
        commissionableCents: commissionableSumCents(incassi),
        atRisk,
        hasData: commRows.length > 0 || incassi.length > 0,
    }
}
