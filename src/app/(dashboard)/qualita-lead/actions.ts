"use server";

import { db } from "@/db";
import {
    gdoLeadSurveys,
    confermeLeadSurveys,
    salesLeadSurveys,
    leads,
} from "@/db/schema";
import { and, eq, gte, lt, isNotNull, sql } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import { isConfermeTl } from "@/lib/confermeTl";
import { currentTenant, companyScope, type TenantContext } from "@/lib/tenancy";
import { dayBoundsRome } from "@/lib/dateUtils";
// Funnel da escludere dalla dashboard: sono artifici tecnici non veri
// funnel business. Il confronto è sempre case-insensitive via UPPER().
const UI_EXCLUDED_FUNNELS = new Set(['DATABASE', 'TEST', 'SCONOSCIUTO']);

// ========== AUTH ==========
async function requireManager(): Promise<{ id: string; role: string; ctx: TenantContext }> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = user?.user_metadata?.role as string | undefined;
    // Oltre a MANAGER/ADMIN, il TL del team Conferme (Alberto, gating per email)
    // può consultare in lettura i sondaggi di qualità lead. Il TL GDO (role TL)
    // ha invece accesso pieno, come MANAGER (decisione PO 2026-07-05).
    const isTlConfermeViewer = role === "CONFERME" && isConfermeTl(user?.email);
    if (!role || (!["MANAGER", "ADMIN", "TL"].includes(role) && !isTlConfermeViewer)) {
        throw new Error("Unauthorized");
    }
    const ctx = await currentTenant();
    return { id: user!.id, role, ctx };
}

export interface QualitaLeadFilters {
    roleScope: "gdo" | "conferme" | "venditore" | "all";
    funnels: string[];            // empty = all
    startDate: string | null;     // ISO date 'YYYY-MM-DD'
    endDate: string | null;
    onlyClosedWon?: boolean;      // for "profilo dei chiusi" view
}

// ========== AGGREGATIONS ==========

/**
 * Distinct funnel values usati nella UI dei filtri. Uniformati a
 * UPPERCASE (così "org" e "ORG" si raggruppano), esclusi DATABASE /
 * TEST / SCONOSCIUTO.
 */
export async function getAvailableFunnels(): Promise<string[]> {
    const { ctx } = await requireManager();
    const rows = await db.selectDistinct({
        funnel: sql<string>`UPPER(${leads.funnel})`.as('funnel'),
    }).from(leads).where(and(isNotNull(leads.funnel), companyScope(ctx, leads.companyId)));
    const unique = new Set<string>();
    for (const r of rows) {
        const f = (r.funnel || '').trim();
        if (!f) continue;
        if (UI_EXCLUDED_FUNNELS.has(f)) continue;
        unique.add(f);
    }
    return Array.from(unique).sort();
}

function buildCommonConditions(filters: QualitaLeadFilters, tableCreatedAt: any) {
    const conds: any[] = [];
    // Mezzogiorno evita il rollover di data quando si costruisce l'istante
    // dal solo 'YYYY-MM-DD' (vedi dayBoundsRome).
    if (filters.startDate) {
        const { start } = dayBoundsRome(new Date(filters.startDate + "T12:00:00"));
        conds.push(gte(tableCreatedAt, start));
    }
    if (filters.endDate) {
        const { end } = dayBoundsRome(new Date(filters.endDate + "T12:00:00"));
        conds.push(lt(tableCreatedAt, end));
    }
    return conds;
}

interface DomainCount {
    option: string;
    count: number;
    percent: number;
}

async function aggregateSingle(
    ctx: TenantContext,
    table: any,
    field: any,
    filters: QualitaLeadFilters,
): Promise<DomainCount[]> {
    const baseConds = buildCommonConditions(filters, table.createdAt);
    baseConds.push(isNotNull(field));
    // Exclude invalidated
    baseConds.push(sql`${table.invalidatedBy} IS NULL`);

    // Join leads for funnel filter + closed-won filter
    let query = db.select({
        option: field,
        count: sql<number>`count(*)::int`,
    }).from(table).innerJoin(leads, eq(table.leadId, leads.id));

    const conds = [...baseConds];
    conds.push(companyScope(ctx, leads.companyId));
    // Always exclude lead with funnel='database'
    conds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('DATABASE', 'TEST', 'SCONOSCIUTO')`);
    if (filters.funnels.length > 0) {
        const upper = filters.funnels.map((f) => f.toUpperCase());
        conds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) IN (${sql.join(upper.map((u) => sql`${u}`), sql`, `)})`);
    }
    if (filters.onlyClosedWon) {
        conds.push(eq(leads.salespersonOutcome, "Chiuso"));
    }

    const rows = await query.where(and(...conds)).groupBy(field);
    const total = rows.reduce((s, r) => s + Number(r.count), 0);
    return rows.map((r) => ({
        option: r.option as string,
        count: Number(r.count),
        percent: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
    })).sort((a, b) => b.count - a.count);
}

async function aggregateArray(
    ctx: TenantContext,
    table: any,
    field: any,
    filters: QualitaLeadFilters,
): Promise<DomainCount[]> {
    const baseConds = buildCommonConditions(filters, table.createdAt);
    baseConds.push(isNotNull(field));
    baseConds.push(sql`${table.invalidatedBy} IS NULL`);

    // unnest the array, group by option
    let query = db.select({
        option: sql<string>`unnest(${field})`.as("option"),
        count: sql<number>`count(*)::int`,
    }).from(table).innerJoin(leads, eq(table.leadId, leads.id));

    const conds = [...baseConds];
    conds.push(companyScope(ctx, leads.companyId));
    conds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('DATABASE', 'TEST', 'SCONOSCIUTO')`);
    if (filters.funnels.length > 0) {
        const upper = filters.funnels.map((f) => f.toUpperCase());
        conds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) IN (${sql.join(upper.map((u) => sql`${u}`), sql`, `)})`);
    }
    if (filters.onlyClosedWon) {
        conds.push(eq(leads.salespersonOutcome, "Chiuso"));
    }

    const rows = await query.where(and(...conds)).groupBy(sql`option`);

    // % denominator = numero di survey coinvolte (non somma opzioni)
    const distinctSurveys = await db.select({
        c: sql<number>`count(distinct ${table.id})::int`,
    }).from(table).innerJoin(leads, eq(table.leadId, leads.id)).where(and(...conds));
    const denom = Number(distinctSurveys[0]?.c ?? 0);

    return rows.map((r) => ({
        option: r.option as string,
        count: Number(r.count),
        percent: denom > 0 ? Math.round((Number(r.count) / denom) * 100) : 0,
    })).sort((a, b) => b.count - a.count);
}

export interface GdoAggregate {
    ageRange: DomainCount[];
    occupation: DomainCount[];
    requestReason: DomainCount[];
    expectation: DomainCount[];
    mainProblem: DomainCount[];
    digitalKnow: DomainCount[];
    changeWithin: DomainCount[];
    changeSince: DomainCount[];
    totalSurveys: number;
    completedSurveys: number;
    avgFillDurationMs: number;
}

export async function getGdoAggregate(filters: QualitaLeadFilters): Promise<GdoAggregate> {
    const { ctx } = await requireManager();

    const [
        ageRange, occupation, requestReason, expectation, mainProblem, digitalKnow, changeWithin, changeSince,
    ] = await Promise.all([
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.ageRange, filters),
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.occupation, filters),
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.requestReason, filters),
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.expectation, filters),
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.mainProblem, filters),
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.digitalKnow, filters),
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.changeWithin, filters),
        aggregateSingle(ctx, gdoLeadSurveys, gdoLeadSurveys.changeSince, filters),
    ]);

    // Totals
    const baseConds = buildCommonConditions(filters, gdoLeadSurveys.createdAt);
    baseConds.push(sql`${gdoLeadSurveys.invalidatedBy} IS NULL`);
    baseConds.push(companyScope(ctx, leads.companyId));
    baseConds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('DATABASE', 'TEST', 'SCONOSCIUTO')`);
    if (filters.funnels.length > 0) {
        const upper = filters.funnels.map((f) => f.toUpperCase());
        baseConds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) IN (${sql.join(upper.map((u) => sql`${u}`), sql`, `)})`);
    }
    if (filters.onlyClosedWon) baseConds.push(eq(leads.salespersonOutcome, "Chiuso"));

    const [tot] = await db.select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${gdoLeadSurveys.completed} = true)::int`,
        avgFill: sql<number>`coalesce(avg(${gdoLeadSurveys.fillDurationMs}), 0)::int`,
    }).from(gdoLeadSurveys).innerJoin(leads, eq(gdoLeadSurveys.leadId, leads.id)).where(and(...baseConds));

    return {
        ageRange, occupation, requestReason, expectation, mainProblem, digitalKnow, changeWithin, changeSince,
        totalSurveys: Number(tot?.total ?? 0),
        completedSurveys: Number(tot?.completed ?? 0),
        avgFillDurationMs: Number(tot?.avgFill ?? 0),
    };
}

export interface ConfermeAggregate {
    remembersApptYes: number; remembersApptNo: number;
    watchedVideoYes: number; watchedVideoNo: number;
    confirmedYes: number; confirmedNo: number;
    whyNot: DomainCount[];
    totalSurveys: number;
}

export async function getConfermeAggregate(filters: QualitaLeadFilters): Promise<ConfermeAggregate> {
    const { ctx } = await requireManager();

    const baseConds = buildCommonConditions(filters, confermeLeadSurveys.createdAt);
    baseConds.push(sql`${confermeLeadSurveys.invalidatedBy} IS NULL`);
    baseConds.push(companyScope(ctx, leads.companyId));
    baseConds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('DATABASE', 'TEST', 'SCONOSCIUTO')`);
    if (filters.funnels.length > 0) {
        const upper = filters.funnels.map((f) => f.toUpperCase());
        baseConds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) IN (${sql.join(upper.map((u) => sql`${u}`), sql`, `)})`);
    }
    if (filters.onlyClosedWon) baseConds.push(eq(leads.salespersonOutcome, "Chiuso"));

    const [agg] = await db.select({
        total: sql<number>`count(*)::int`,
        remembersYes: sql<number>`count(*) FILTER (WHERE ${confermeLeadSurveys.remembersAppt} = true)::int`,
        remembersNo: sql<number>`count(*) FILTER (WHERE ${confermeLeadSurveys.remembersAppt} = false)::int`,
        videoYes: sql<number>`count(*) FILTER (WHERE ${confermeLeadSurveys.watchedVideo} = true)::int`,
        videoNo: sql<number>`count(*) FILTER (WHERE ${confermeLeadSurveys.watchedVideo} = false)::int`,
        confYes: sql<number>`count(*) FILTER (WHERE ${confermeLeadSurveys.confirmed} = true)::int`,
        confNo: sql<number>`count(*) FILTER (WHERE ${confermeLeadSurveys.confirmed} = false)::int`,
    }).from(confermeLeadSurveys).innerJoin(leads, eq(confermeLeadSurveys.leadId, leads.id)).where(and(...baseConds));

    const whyNot = await aggregateSingle(ctx, confermeLeadSurveys, confermeLeadSurveys.whyNot, filters);

    return {
        remembersApptYes: Number(agg?.remembersYes ?? 0),
        remembersApptNo: Number(agg?.remembersNo ?? 0),
        watchedVideoYes: Number(agg?.videoYes ?? 0),
        watchedVideoNo: Number(agg?.videoNo ?? 0),
        confirmedYes: Number(agg?.confYes ?? 0),
        confirmedNo: Number(agg?.confNo ?? 0),
        whyNot,
        totalSurveys: Number(agg?.total ?? 0),
    };
}

export interface SalesAggregate {
    problemSignals: DomainCount[];
    urgencySignals: DomainCount[];
    priceReaction: DomainCount[];
    totalSurveys: number;
}

export async function getSalesAggregate(filters: QualitaLeadFilters): Promise<SalesAggregate> {
    const { ctx } = await requireManager();

    const baseConds = buildCommonConditions(filters, salesLeadSurveys.createdAt);
    baseConds.push(sql`${salesLeadSurveys.invalidatedBy} IS NULL`);
    baseConds.push(companyScope(ctx, leads.companyId));
    baseConds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) NOT IN ('DATABASE', 'TEST', 'SCONOSCIUTO')`);
    if (filters.funnels.length > 0) {
        const upper = filters.funnels.map((f) => f.toUpperCase());
        baseConds.push(sql`UPPER(COALESCE(${leads.funnel}, '')) IN (${sql.join(upper.map((u) => sql`${u}`), sql`, `)})`);
    }
    if (filters.onlyClosedWon) baseConds.push(eq(leads.salespersonOutcome, "Chiuso"));

    const [tot] = await db.select({ total: sql<number>`count(*)::int` })
        .from(salesLeadSurveys)
        .innerJoin(leads, eq(salesLeadSurveys.leadId, leads.id))
        .where(and(...baseConds));

    const [problemSignals, urgencySignals, priceReaction] = await Promise.all([
        aggregateArray(ctx, salesLeadSurveys, salesLeadSurveys.problemSignals, filters),
        aggregateArray(ctx, salesLeadSurveys, salesLeadSurveys.urgencySignals, filters),
        aggregateSingle(ctx, salesLeadSurveys, salesLeadSurveys.priceReaction, filters),
    ]);

    return {
        problemSignals, urgencySignals, priceReaction,
        totalSurveys: Number(tot?.total ?? 0),
    };
}

// ========== CSV EXPORT ==========

const esc = (s: unknown) => {
    const v = String(s ?? "");
    if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
    return v;
};

function buildCsvSection(
    funnelLabel: string,
    gdo: GdoAggregate,
    conferme: ConfermeAggregate,
    sales: SalesAggregate,
): string[] {
    const rows: string[] = [];
    const pushDomain = (role: string, question: string, items: DomainCount[]) => {
        for (const it of items) rows.push([esc(funnelLabel), esc(role), esc(question), esc(it.option), esc(it.count), esc(`${it.percent}%`)].join(","));
    };

    pushDomain("GDO", "Età", gdo.ageRange);
    pushDomain("GDO", "Occupazione", gdo.occupation);
    pushDomain("GDO", "Motivo richiesta", gdo.requestReason);
    pushDomain("GDO", "Cosa aspettava", gdo.expectation);
    pushDomain("GDO", "Problema principale", gdo.mainProblem);
    pushDomain("GDO", "Conoscenza digitale", gdo.digitalKnow);
    pushDomain("GDO", "Cambiamento entro", gdo.changeWithin);
    pushDomain("GDO", "Cerca cambiamento da", gdo.changeSince);

    rows.push([esc(funnelLabel), "Conferme", "Si ricorda appuntamento", "Sì", String(conferme.remembersApptYes), ""].join(","));
    rows.push([esc(funnelLabel), "Conferme", "Si ricorda appuntamento", "No", String(conferme.remembersApptNo), ""].join(","));
    rows.push([esc(funnelLabel), "Conferme", "Ha visto video", "Sì", String(conferme.watchedVideoYes), ""].join(","));
    rows.push([esc(funnelLabel), "Conferme", "Ha visto video", "No", String(conferme.watchedVideoNo), ""].join(","));
    rows.push([esc(funnelLabel), "Conferme", "Confermato", "Sì", String(conferme.confirmedYes), ""].join(","));
    rows.push([esc(funnelLabel), "Conferme", "Confermato", "No", String(conferme.confirmedNo), ""].join(","));
    pushDomain("Conferme", "Perché no", conferme.whyNot);

    pushDomain("Venditore", "Segnali problema", sales.problemSignals);
    pushDomain("Venditore", "Segnali urgenza", sales.urgencySignals);
    pushDomain("Venditore", "Reazione prezzo", sales.priceReaction);

    return rows;
}

export async function exportCsvResoconto(filters: QualitaLeadFilters): Promise<string> {
    await requireManager();

    // Quando l'utente non ha selezionato un funnel specifico, generiamo
    // un resoconto per-funnel in un unico file (come scaricare ogni
    // funnel singolarmente ma concatenato).
    const funnelsToReport: string[] = filters.funnels.length > 0
        ? filters.funnels.map((f) => f.toUpperCase())
        : await getAvailableFunnels();

    const header = "funnel,ruolo,domanda,opzione,count,percentuale";
    const rows: string[] = [header];

    for (const funnel of funnelsToReport) {
        const perFunnelFilters: QualitaLeadFilters = { ...filters, funnels: [funnel] };
        const [gdo, conferme, sales] = await Promise.all([
            getGdoAggregate(perFunnelFilters),
            getConfermeAggregate(perFunnelFilters),
            getSalesAggregate(perFunnelFilters),
        ]);
        rows.push(...buildCsvSection(funnel, gdo, conferme, sales));
    }

    return rows.join("\n");
}
