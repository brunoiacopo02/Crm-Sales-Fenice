'use server';

/**
 * Report Qualità GDO — KPI settimanali per il coaching (spec 2026-07-22).
 *
 * Alimenta la modale "Report qualità" su /manager-gdo-performance: righe
 * settimanali (lun-dom Europe/Rome) dall'inizio del piano coaching
 * (20/07/2026) più una baseline pre-piano, per il singolo GDO e per la
 * media team (GDO isActive+statsActive, bot escluso).
 *
 * Semantica KPI identica al dossier coaching GDO 110:
 *  - lavorati        → lastCallDate nella finestra, callCount > 0
 *  - fissati         → COALESCE(appointmentCreatedAt, appointmentDate) nella finestra
 *  - confermati      → coorte dei fissati della finestra con outcome 'confermato'
 *  - scarti 3NR      → coorte dei fissati con outcome 'scartato' e reason ~ 'nr'
 *  - media tentativi → avg(callCount) dei lavorati
 *  - scarti 1ª call  → lavorati REJECTED con callCount = 1
 */

import { db } from "@/db";
import { leads, users } from "@/db/schema";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { currentTenant, assertSalesArea } from '@/lib/tenancy';
import { dayBoundsRome, toRomeDateStr } from "@/lib/dateUtils";

export type QualityRow = {
    label: string;
    lavorati: number;
    fissati: number;
    pctFissSuLavorati: number | null;
    confermati: number;
    pctConf: number | null;
    scarti3nr: number;
    pct3nr: number | null;
    mediaTentativi: number | null;
    pctScarti1a: number | null;
};

export type GdoQualityReportResult =
    | { success: true; gdoName: string; generatedAt: string; rows: QualityRow[]; teamRows: QualityRow[] }
    | { success: false; error: string };

// Inizio piano coaching GDO 110 (lunedì). Le settimane del report partono qui
// per tutti i GDO: serve un riferimento comune per confrontare le curve.
const PLAN_START_DATE = '2026-07-20';
const BASELINE_START_DATE = '2026-06-01';
const MAX_WEEKS = 20;

type LeanWorked = { assignedToId: string | null; callCount: number; status: string; lastCallDate: Date | null };
type LeanFissato = {
    assignedToId: string | null;
    apptSetAt: Date | null;
    confirmationsOutcome: string | null;
    confirmationsDiscardReason: string | null;
};

type Window = { label: string; start: Date; end: Date };

function fmtDdMm(d: Date): string {
    const [, m, day] = toRomeDateStr(d).split('-');
    return `${day}/${m}`;
}

function pct(n: number, d: number): number | null {
    return d > 0 ? (n / d) * 100 : null;
}

function computeRow(label: string, worked: LeanWorked[], fissati: LeanFissato[]): QualityRow {
    const lavorati = worked.length;
    const scarti1a = worked.filter(w => w.status === 'REJECTED' && w.callCount === 1).length;
    const sumTentativi = worked.reduce((s, w) => s + (w.callCount || 0), 0);

    const nFissati = fissati.length;
    const confermati = fissati.filter(f => f.confirmationsOutcome === 'confermato').length;
    const scarti3nr = fissati.filter(f =>
        f.confirmationsOutcome === 'scartato'
        && (f.confirmationsDiscardReason || '').toLowerCase().includes('nr')
    ).length;

    return {
        label,
        lavorati,
        fissati: nFissati,
        pctFissSuLavorati: pct(nFissati, lavorati),
        confermati,
        pctConf: pct(confermati, nFissati),
        scarti3nr,
        pct3nr: pct(scarti3nr, nFissati),
        mediaTentativi: lavorati > 0 ? sumTentativi / lavorati : null,
        pctScarti1a: pct(scarti1a, lavorati),
    };
}

function buildWindows(now: Date): Window[] {
    const baselineStart = dayBoundsRome(new Date(`${BASELINE_START_DATE}T12:00:00Z`)).start;
    const planStart = dayBoundsRome(new Date(`${PLAN_START_DATE}T12:00:00Z`)).start;

    const windows: Window[] = [{
        label: `Baseline pre-piano (${fmtDdMm(baselineStart)} → ${fmtDdMm(new Date(planStart.getTime() - 1))})`,
        start: baselineStart,
        end: planStart,
    }];

    // Passi da 7 giorni esatti dal lunedì di partenza: allineato fino al cambio
    // DST di fine ottobre, oltre l'orizzonte delle 8 settimane del piano.
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < MAX_WEEKS; i++) {
        const start = new Date(planStart.getTime() + i * weekMs);
        if (start > now) break;
        const end = new Date(start.getTime() + weekMs);
        windows.push({
            label: `Sett. ${i + 1} (${fmtDdMm(start)} → ${fmtDdMm(new Date(end.getTime() - 1))})`,
            start,
            end,
        });
    }
    return windows;
}

export async function getGdoQualityReport(gdoUserId: string): Promise<GdoQualityReportResult> {
    try {
        const ctx = await currentTenant();
        assertSalesArea(ctx);
        if (!['ADMIN', 'MANAGER', 'TL'].includes(ctx.role)) {
            return { success: false, error: 'Non autorizzato' };
        }

        // GDO target: deve appartenere alla company del contesto (no cross-tenant).
        const [gdo] = await db.select({
            id: users.id, name: users.name, displayName: users.displayName, isBot: users.isBot,
        })
            .from(users)
            .where(and(
                eq(users.companyId, ctx.companyId),
                eq(users.id, gdoUserId),
                eq(users.role, 'GDO'),
            ))
            .limit(1);
        if (!gdo) return { success: false, error: 'GDO non trovato' };
        if (gdo.isBot) return { success: false, error: 'Report non disponibile per il bot fissatore' };

        // Team per la media: GDO attivi nelle statistiche, bot escluso (canone).
        const team = await db.select({ id: users.id })
            .from(users)
            .where(and(
                eq(users.companyId, ctx.companyId),
                eq(users.role, 'GDO'),
                eq(users.isActive, true),
                eq(users.statsActive, true),
                eq(users.isBot, false),
            ));
        const teamIds = team.map(t => t.id);
        const allIds = [...new Set([...teamIds, gdo.id])];

        const now = new Date();
        const windows = buildWindows(now);
        const rangeStart = windows[0].start;

        const [workedRows, fissatiRows] = await Promise.all([
            db.select({
                assignedToId: leads.assignedToId,
                callCount: leads.callCount,
                status: leads.status,
                lastCallDate: leads.lastCallDate,
            })
                .from(leads)
                .where(and(
                    eq(leads.companyId, ctx.companyId),
                    inArray(leads.assignedToId, allIds),
                    isNotNull(leads.lastCallDate),
                    gte(leads.lastCallDate, rangeStart),
                    sql`${leads.callCount} > 0`,
                )),
            db.select({
                assignedToId: leads.assignedToId,
                apptSetAt: sql<Date | null>`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate})`,
                confirmationsOutcome: leads.confirmationsOutcome,
                confirmationsDiscardReason: leads.confirmationsDiscardReason,
            })
                .from(leads)
                .where(and(
                    eq(leads.companyId, ctx.companyId),
                    inArray(leads.assignedToId, allIds),
                    isNotNull(leads.appointmentDate),
                    sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) >= ${rangeStart}`,
                )),
        ]);

        const inWindow = (d: Date | null | undefined, w: Window): boolean => {
            if (!d) return false;
            const t = new Date(d);
            return t >= w.start && t < w.end;
        };

        const rows: QualityRow[] = [];
        const teamRows: QualityRow[] = [];
        const teamIdSet = new Set(teamIds);

        for (const w of windows) {
            const workedWin = workedRows.filter(r => inWindow(r.lastCallDate, w));
            const fissWin = fissatiRows.filter(r => inWindow(r.apptSetAt, w));

            rows.push(computeRow(
                w.label,
                workedWin.filter(r => r.assignedToId === gdo.id) as LeanWorked[],
                fissWin.filter(r => r.assignedToId === gdo.id) as LeanFissato[],
            ));
            teamRows.push(computeRow(
                w.label,
                workedWin.filter(r => r.assignedToId && teamIdSet.has(r.assignedToId)) as LeanWorked[],
                fissWin.filter(r => r.assignedToId && teamIdSet.has(r.assignedToId)) as LeanFissato[],
            ));
        }

        return {
            success: true,
            gdoName: gdo.name || gdo.displayName || 'GDO',
            generatedAt: now.toISOString(),
            rows,
            teamRows,
        };
    } catch (error) {
        console.error('Errore getGdoQualityReport:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}
