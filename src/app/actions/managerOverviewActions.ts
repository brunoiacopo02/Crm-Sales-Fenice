'use server';

/**
 * Dati per la striscia "Parametri Manager" su /panoramica-generale
 * (Correzioni CRM 2026-06-11, sezione Manager):
 * - parametri principali con target espliciti: 10 app/gg/GDO, 15% conferme,
 *   fatturato settimanale (mensile/4, stretch +15%), costo/contratto <= 760€
 * - scorte lead lavorabili per GDO + pool non assegnati ("quanti lead devo dare?")
 * - lead nuovi arrivati oggi (totale + breakdown funnel)
 * - GDO sotto target oggi/settimana (segnalazione underperformer)
 */

import { db } from "@/db";
import { leads, users, monthlyLeadTargets, metaAccountDaily } from "@/db/schema";
import { and, eq, gte, lt, lte, isNull, isNotNull, inArray, or, sql } from "drizzle-orm";
import { currentTenant, assertSalesArea } from '@/lib/tenancy';
import { workingDaysBetween, currentYearMonthRome } from "@/lib/workingDaysUtils";
import { MANAGER_TARGET_APP_PER_GDO_DAY as TARGET_APP_PER_GDO_DAY } from "@/lib/kpi/canon";

// Target espliciti richiesti dal management (Correzioni CRM 2026-06-11).
// TARGET_APP_PER_GDO_DAY (soglia giudizio manager = 10) ora importata da canon.
const TARGET_CONFERMA_PCT = 0.15;
const TARGET_COSTO_CONTRATTO_EUR = 760;
const WEEKLY_STRETCH_FACTOR = 1.15;

export type ManagerParamCard = {
    key: string;
    label: string;
    actual: number | null;
    target: number;
    /** secondo target opzionale (es. stretch fatturato settimanale +15%) */
    stretchTarget?: number;
    unit: 'num' | 'pct' | 'eur';
    /** true = sopra target è buono; false = sotto target è buono (es. costo/contratto) */
    higherIsBetter: boolean;
    ok: boolean | null;
};

export type GdoStockRow = { gdoId: string; name: string; stock: number };
export type GdoUnderperformerRow = { gdoId: string; name: string; appToday: number; appWeekAvg: number | null };

export type ManagerOverviewResult =
    | {
        success: true;
        params: ManagerParamCard[];
        newLeadsToday: { total: number; byFunnel: { funnel: string; count: number }[] };
        stock: { perGdo: GdoStockRow[]; unassigned: number };
        underperformers: GdoUnderperformerRow[];
    }
    | { success: false; error: string };

export async function getManagerOverview(): Promise<ManagerOverviewResult> {
    try {
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        if (!['ADMIN', 'MANAGER', 'TL'].includes(ctx.role)) {
            return { success: false, error: 'Non autorizzato' };
        }

        // ── Confini temporali (Europe/Rome) ─────────────────────────────────
        const romeDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
        const [y, m, d] = romeDateStr.split('-').map(Number);
        const todayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
        const todayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
        const dow = new Date(y, m - 1, d).getDay();
        const monOffset = dow === 0 ? -6 : 1 - dow;
        const weekStart = new Date(y, m - 1, d + monOffset, 0, 0, 0, 0);
        const monthStart = new Date(Date.UTC(y, m - 1, 1));
        const monthEnd = new Date(Date.UTC(y, m, 1));
        const now = new Date();

        const ym = currentYearMonthRome();
        const wdElapsedMonth = workingDaysBetween(new Date(y, m - 1, 1), now);
        const wdElapsedWeek = workingDaysBetween(weekStart, now);

        // ── GDO attivi ───────────────────────────────────────────────────────
        // statsActive: il TL/manager esclude dai conteggi i GDO non operativi,
        // altrimenti le medie per-GDO escono diluite (divisore gonfiato).
        // isBot=false: il bot fissatore non è un GDO reale (decisione PO 2026-07-05).
        const gdos = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
            .from(users)
            .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO'), eq(users.isActive, true), eq(users.statsActive, true), eq(users.isBot, false)));
        const nGdo = gdos.length;
        const gdoName = new Map(gdos.map(g => [g.id, g.name || g.displayName || g.id]));

        // ── Appuntamenti del mese (con conferme) — stessa definizione panoramica ──
        const queryStart = weekStart < monthStart ? weekStart : monthStart;
        const apptRows = await db.select({
            assignedToId: leads.assignedToId,
            appointmentCreatedAt: leads.appointmentCreatedAt,
            appointmentDate: leads.appointmentDate,
            confirmationsOutcome: leads.confirmationsOutcome,
        })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                isNotNull(leads.appointmentDate),
                or(
                    and(isNotNull(leads.appointmentCreatedAt), gte(leads.appointmentCreatedAt, queryStart), lt(leads.appointmentCreatedAt, monthEnd)),
                    and(isNull(leads.appointmentCreatedAt), gte(leads.appointmentDate, queryStart), lt(leads.appointmentDate, monthEnd)),
                ),
            ));

        let apptMtd = 0;
        let confMtd = 0;
        const appTodayByGdo = new Map<string, number>();
        const appWeekByGdo = new Map<string, number>();
        for (const r of apptRows) {
            const setAt = r.appointmentCreatedAt || r.appointmentDate;
            if (!setAt) continue;
            const t = new Date(setAt);
            if (t >= monthStart && t < monthEnd) {
                apptMtd++;
                if (r.confirmationsOutcome === 'confermato') confMtd++;
            }
            if (r.assignedToId && t >= weekStart) {
                appWeekByGdo.set(r.assignedToId, (appWeekByGdo.get(r.assignedToId) || 0) + 1);
                if (t >= todayStart && t <= todayEnd) {
                    appTodayByGdo.set(r.assignedToId, (appTodayByGdo.get(r.assignedToId) || 0) + 1);
                }
            }
        }

        // ── Chiusure mese + fatturato settimana ──────────────────────────────
        const closeRows = await db.select({
            salespersonOutcomeAt: leads.salespersonOutcomeAt,
            closeAmountEur: leads.closeAmountEur,
        })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                eq(leads.salespersonOutcome, 'Chiuso'),
                isNotNull(leads.salespersonOutcomeAt),
                gte(leads.salespersonOutcomeAt, queryStart),
                lt(leads.salespersonOutcomeAt, monthEnd),
            ));
        let chiusureMtd = 0;
        let fatturatoSettimana = 0;
        for (const r of closeRows) {
            const t = new Date(r.salespersonOutcomeAt!);
            if (t >= monthStart && t < monthEnd) chiusureMtd++;
            if (t >= weekStart) fatturatoSettimana += r.closeAmountEur || 0;
        }

        // ── Spesa Meta MTD (per costo/contratto) ─────────────────────────────
        let spendMtd = 0;
        try {
            const { metaFunnelsForCompany } = await import('@/lib/marketing/company-funnels');
            const funnels = await metaFunnelsForCompany(ctx.companyId);
            const accountIds = [...new Set(funnels.map(f => f.meta_account).filter((x): x is string => !!x))];
            if (accountIds.length > 0) {
                const pad = (n: number) => String(n).padStart(2, '0');
                const spendRows = await db.select({ spend: metaAccountDaily.spend })
                    .from(metaAccountDaily)
                    .where(and(
                        eq(metaAccountDaily.companyId, ctx.companyId),
                        inArray(metaAccountDaily.accountId, accountIds),
                        gte(metaAccountDaily.date, `${ym}-01`),
                        lte(metaAccountDaily.date, `${ym}-${pad(d)}`),
                    ));
                spendMtd = spendRows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
            }
        } catch (e) {
            console.error('getManagerOverview: spesa Meta non disponibile', e);
        }

        // ── Target fatturato settimanale da monthlyLeadTargets ───────────────
        const [cfg] = await db.select({
            targetFatturatoMonthly: monthlyLeadTargets.targetFatturatoMonthly,
        })
            .from(monthlyLeadTargets)
            .where(and(eq(monthlyLeadTargets.companyId, ctx.companyId), eq(monthlyLeadTargets.yearMonth, ym)))
            .limit(1);
        const weeklyRevenueTarget = (cfg?.targetFatturatoMonthly || 0) / 4;

        // ── Scorte lead lavorabili per GDO + pool non assegnato ──────────────
        const stockRows = await db.select({
            gdoId: leads.assignedToId,
            c: sql<number>`count(*)::int`,
        })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                inArray(leads.status, ['NEW', 'IN_PROGRESS']),
                isNull(leads.recallDate),
                lt(leads.callCount, 3),
                isNotNull(leads.assignedToId),
            ))
            .groupBy(leads.assignedToId);
        const stockByGdo = new Map(stockRows.map(r => [r.gdoId as string, r.c]));

        const [unassignedRow] = await db.select({ c: sql<number>`count(*)::int` })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                isNull(leads.assignedToId),
                inArray(leads.status, ['NEW', 'IN_PROGRESS']),
            ));
        const unassigned = unassignedRow?.c || 0;

        const perGdo: GdoStockRow[] = gdos
            .map(g => ({ gdoId: g.id, name: gdoName.get(g.id)!, stock: stockByGdo.get(g.id) || 0 }))
            .sort((a, b) => a.stock - b.stock);

        // ── Lead nuovi oggi ──────────────────────────────────────────────────
        const newRows = await db.select({ funnel: leads.funnel })
            .from(leads)
            .where(and(
                eq(leads.companyId, ctx.companyId),
                gte(leads.createdAt, todayStart),
                lte(leads.createdAt, todayEnd),
                // Lead dei pool /import (launchBucket) non ancora assegnati =
                // magazzino: contano solo dall'assegnazione (PO 2026-07-20).
                or(isNull(leads.launchBucket), isNotNull(leads.assignedToId)),
            ));
        const byFunnelMap = new Map<string, number>();
        for (const r of newRows) {
            const f = (r.funnel || 'Senza funnel').toUpperCase();
            byFunnelMap.set(f, (byFunnelMap.get(f) || 0) + 1);
        }
        const byFunnel = [...byFunnelMap.entries()]
            .map(([funnel, count]) => ({ funnel, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        // ── Underperformer: GDO con media app/gg settimanale sotto il 50% del target ──
        const underperformers: GdoUnderperformerRow[] = gdos
            .map(g => {
                const appWeek = appWeekByGdo.get(g.id) || 0;
                const avg = wdElapsedWeek > 0 ? appWeek / wdElapsedWeek : null;
                return { gdoId: g.id, name: gdoName.get(g.id)!, appToday: appTodayByGdo.get(g.id) || 0, appWeekAvg: avg };
            })
            .filter(r => r.appWeekAvg !== null && r.appWeekAvg < TARGET_APP_PER_GDO_DAY * 0.5)
            .sort((a, b) => (a.appWeekAvg ?? 0) - (b.appWeekAvg ?? 0))
            .slice(0, 5);

        // ── Card parametri ───────────────────────────────────────────────────
        const mediaAppPerGdoDay = wdElapsedMonth > 0 && nGdo > 0 ? apptMtd / wdElapsedMonth / nGdo : null;
        const confermaPct = apptMtd > 0 ? confMtd / apptMtd : null;
        const costoContratto = chiusureMtd > 0 && spendMtd > 0 ? spendMtd / chiusureMtd : null;

        const params: ManagerParamCard[] = [
            {
                key: 'appPerGdoDay', label: 'App/gg per GDO (mese)',
                actual: mediaAppPerGdoDay, target: TARGET_APP_PER_GDO_DAY,
                unit: 'num', higherIsBetter: true,
                ok: mediaAppPerGdoDay === null ? null : mediaAppPerGdoDay >= TARGET_APP_PER_GDO_DAY,
            },
            {
                key: 'confermaPct', label: '% Conferme media (mese)',
                actual: confermaPct, target: TARGET_CONFERMA_PCT,
                unit: 'pct', higherIsBetter: true,
                ok: confermaPct === null ? null : confermaPct >= TARGET_CONFERMA_PCT,
            },
            {
                key: 'fatturatoSettimana', label: 'Fatturato settimana',
                actual: fatturatoSettimana, target: weeklyRevenueTarget,
                stretchTarget: weeklyRevenueTarget * WEEKLY_STRETCH_FACTOR,
                unit: 'eur', higherIsBetter: true,
                ok: weeklyRevenueTarget > 0 ? fatturatoSettimana >= weeklyRevenueTarget : null,
            },
            {
                key: 'costoContratto', label: 'Costo/contratto (mese)',
                actual: costoContratto, target: TARGET_COSTO_CONTRATTO_EUR,
                unit: 'eur', higherIsBetter: false,
                ok: costoContratto === null ? null : costoContratto <= TARGET_COSTO_CONTRATTO_EUR,
            },
        ];

        // TL GDO: vede solo i parametri legati ai GDO (niente fatturato/costi).
        const visibleParams = ctx.role === 'TL'
            ? params.filter(p => p.key === 'appPerGdoDay' || p.key === 'confermaPct')
            : params;

        return {
            success: true,
            params: visibleParams,
            newLeadsToday: { total: newRows.length, byFunnel },
            stock: { perGdo, unassigned },
            underperformers,
        };
    } catch (error) {
        console.error('Errore getManagerOverview:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

// ── Selettore "GDO attivi nelle statistiche" (TL/Manager/Admin) ─────────────
// Il flag users.statsActive decide chi entra nei divisori delle medie per-GDO
// (qui e in getSalesAlerts). Persistito a DB così TL e manager vedono gli
// stessi numeri.

export type GdoStatsRosterRow = {
    id: string;
    gdoCode: number | null;
    name: string;
    statsActive: boolean;
};

export type GdoStatsRosterResult =
    | { success: true; roster: GdoStatsRosterRow[] }
    | { success: false; error: string };

export async function getGdoStatsRoster(): Promise<GdoStatsRosterResult> {
    try {
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        if (!['ADMIN', 'MANAGER', 'TL'].includes(ctx.role)) {
            return { success: false, error: 'Non autorizzato' };
        }
        const rows = await db.select({
            id: users.id,
            gdoCode: users.gdoCode,
            name: users.name,
            displayName: users.displayName,
            statsActive: users.statsActive,
        })
            .from(users)
            .where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO'), eq(users.isActive, true)));
        const roster = rows
            .map(r => ({ id: r.id, gdoCode: r.gdoCode, name: r.name || r.displayName || r.id, statsActive: r.statsActive }))
            .sort((a, b) => (a.gdoCode ?? 9999) - (b.gdoCode ?? 9999));
        return { success: true, roster };
    } catch (error) {
        console.error('Errore getGdoStatsRoster:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

export async function setGdoStatsActive(gdoUserId: string, active: boolean): Promise<{ success: boolean; error?: string }> {
    try {
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        if (!['ADMIN', 'MANAGER', 'TL'].includes(ctx.role)) {
            return { success: false, error: 'Non autorizzato' };
        }
        await db.update(users).set({ statsActive: active }).where(and(
            eq(users.companyId, ctx.companyId),
            eq(users.id, gdoUserId),
            eq(users.role, 'GDO'),
        ));
        return { success: true };
    } catch (error) {
        console.error('Errore setGdoStatsActive:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}
