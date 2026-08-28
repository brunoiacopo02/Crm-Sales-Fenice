'use server';

/**
 * Report Qualità GDO — KPI settimanali per il coaching (spec 2026-07-22,
 * revisione 2026-08-25).
 *
 * Alimenta la modale "Report qualità" su /manager-gdo-performance: righe
 * settimanali (lun-dom Europe/Rome) dall'inizio del piano coaching
 * (20/07/2026) più una baseline pre-piano, per il singolo GDO e per la
 * media team (GDO isActive+statsActive, bot escluso).
 *
 * ⚠️ Le metriche di attività si leggono da `callLogs`, che è un registro di
 * fatti datati. La prima versione le leggeva da `leads.lastCallDate`, un
 * campo che avanza a ogni nuova chiamata: i lead migravano dalle settimane
 * vecchie a quelle nuove e le righe passate si svuotavano col tempo. Vedi la
 * nota estesa in src/lib/kpi/coachingRows.ts.
 *
 * Semantica delle righe: src/lib/kpi/coachingRows.ts (con i test).
 */

import { db } from "@/db";
import { callLogs, leads, users } from "@/db/schema";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { currentTenant, assertSalesArea } from '@/lib/tenancy';
import { dayBoundsRome, toRomeDateStr } from "@/lib/dateUtils";
import {
    computeRow, matchesScope,
    type CallFact, type ApptFact, type FunnelScope, type QualityRow,
} from "@/lib/kpi/coachingRows";

export type { QualityRow, FunnelScope } from "@/lib/kpi/coachingRows";

export type GdoQualityReportResult =
    | {
        success: true;
        gdoName: string;
        generatedAt: string;
        funnelScope: FunnelScope;
        rows: QualityRow[];
        teamRows: QualityRow[];
    }
    | { success: false; error: string };

// Inizio piano coaching GDO 110 (lunedì). Le settimane del report partono qui
// per tutti i GDO: serve un riferimento comune per confrontare le curve.
const PLAN_START_DATE = '2026-07-20';
const BASELINE_START_DATE = '2026-06-01';
const MAX_WEEKS = 20;

type Window = { label: string; start: Date; end: Date };

function fmtDdMm(d: Date): string {
    const [, m, day] = toRomeDateStr(d).split('-');
    return `${day}/${m}`;
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

export async function getGdoQualityReport(
    gdoUserId: string,
    funnelScope: FunnelScope = 'ALL',
): Promise<GdoQualityReportResult> {
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

        // CTE: rn = posizione della chiamata nella storia COMPLETA del lead.
        // Il filtro sul periodo va applicato dopo, altrimenti "prima chiamata"
        // significherebbe "prima chiamata dentro la finestra" e ogni settimana
        // sembrerebbe piena di primi contatti.
        const ranked = db.$with('ranked').as(
            db.select({
                leadId: callLogs.leadId,
                userId: callLogs.userId,
                outcome: callLogs.outcome,
                createdAt: callLogs.createdAt,
                rn: sql<number>`row_number() over (partition by ${callLogs.leadId} order by ${callLogs.createdAt}, ${callLogs.id})`.as('rn'),
            }).from(callLogs).where(eq(callLogs.companyId, ctx.companyId)),
        );

        const [callRows, apptRows] = await Promise.all([
            db.with(ranked)
                .select({
                    leadId: ranked.leadId,
                    userId: ranked.userId,
                    outcome: ranked.outcome,
                    createdAt: ranked.createdAt,
                    rn: ranked.rn,
                    funnel: leads.funnel,
                    leadCallCount: leads.callCount,
                })
                .from(ranked)
                .innerJoin(leads, eq(leads.id, ranked.leadId))
                .where(and(
                    gte(ranked.createdAt, rangeStart),
                    inArray(ranked.userId, allIds),
                )),
            db.select({
                leadId: leads.id,
                assignedToId: leads.assignedToId,
                apptSetAt: sql<Date | null>`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate})`,
                confirmationsOutcome: leads.confirmationsOutcome,
                confirmationsDiscardReason: leads.confirmationsDiscardReason,
                funnel: leads.funnel,
            })
                .from(leads)
                .where(and(
                    eq(leads.companyId, ctx.companyId),
                    inArray(leads.assignedToId, allIds),
                    isNotNull(leads.appointmentDate),
                    sql`COALESCE(${leads.appointmentCreatedAt}, ${leads.appointmentDate}) >= ${rangeStart}`,
                )),
        ]);

        const calls: CallFact[] = callRows
            .filter(r => matchesScope(r.funnel, funnelScope))
            .map(r => ({
                leadId: r.leadId,
                userId: r.userId,
                outcome: r.outcome,
                createdAt: new Date(r.createdAt),
                rn: Number(r.rn),
                funnel: r.funnel,
                leadCallCount: r.leadCallCount ?? 0,
            }));
        const appts: ApptFact[] = apptRows
            .filter(r => matchesScope(r.funnel, funnelScope))
            .map(r => ({
                leadId: r.leadId,
                assignedToId: r.assignedToId,
                apptSetAt: r.apptSetAt ? new Date(r.apptSetAt) : null,
                confirmationsOutcome: r.confirmationsOutcome,
                confirmationsDiscardReason: r.confirmationsDiscardReason,
                funnel: r.funnel,
            }));

        const inWindow = (d: Date | null | undefined, w: Window): boolean => {
            if (!d) return false;
            return d >= w.start && d < w.end;
        };

        const rows: QualityRow[] = [];
        const teamRows: QualityRow[] = [];
        const teamIdSet = new Set(teamIds);

        for (const w of windows) {
            const callsWin = calls.filter(c => inWindow(c.createdAt, w));
            const apptsWin = appts.filter(a => inWindow(a.apptSetAt, w));

            rows.push(computeRow(
                w.label,
                callsWin.filter(c => c.userId === gdo.id),
                apptsWin.filter(a => a.assignedToId === gdo.id),
            ));
            teamRows.push(computeRow(
                w.label,
                callsWin.filter(c => c.userId && teamIdSet.has(c.userId)),
                apptsWin.filter(a => a.assignedToId && teamIdSet.has(a.assignedToId)),
            ));
        }

        return {
            success: true,
            gdoName: gdo.name || gdo.displayName || 'GDO',
            generatedAt: now.toISOString(),
            funnelScope,
            rows,
            teamRows,
        };
    } catch (error) {
        console.error('Errore getGdoQualityReport:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}
