/**
 * Multi-tenancy helper centrale.
 *
 * Pattern: ogni Server Action / API route inizia con
 *   const ctx = await currentTenant();
 *   assertSalesArea(ctx);   // o assertMarketingArea
 *   ...
 *   db.select().from(leads).where(and(eq(leads.companyId, ctx.companyId), ...))
 *
 * Sorgente di verità: user_metadata Supabase Auth (impostato all'invite/creazione
 * utente). Fallback su tavolo `users` se mancante. Default 'fenice' / 'sales' per
 * back-compat con gli account esistenti pre-retrofit (non rompe nessuna query).
 *
 * Vedi: docs/superpowers/specs/2026-05-21-merge-crm-marketing-design.md §7
 */
import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { leads, users } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Cookie HttpOnly con l'azienda sales selezionata. Distinto dal cookie marketing. */
export const SALES_ACTIVE_COMPANY_COOKIE = 'sales_active_company';
export const SALES_ACTIVE_COMPANY_MAX_AGE = 60 * 60 * 24 * 30; // 30 giorni

/**
 * Sentinella "Tutte le aziende": valore valido SOLO nel cookie sales_active_company.
 * Non raggiunge MAI una query DB (ctx.companyId resta sempre un'azienda reale).
 * Attivabile solo da admin con >1 aziende consentite — vedi currentTenant().
 */
export const ALL_COMPANIES = '__all__';

export type TenantArea = 'sales' | 'marketing' | 'both';
export type MarketingRole = 'manager' | 'media_buyer' | 'copywriter' | 'social';
export type CompanyId = string; // 'fenice' | 'serenamente' | 'fcd' (text PK, mai validato a livello tipo)

export interface TenantContext {
    userId: string;
    email: string | null;
    role: string;              // sales role: 'GDO' | 'CONFERME' | 'VENDITORE' | 'MANAGER' | 'ADMIN'
    companyId: CompanyId;
    area: TenantArea;
    marketingRole: MarketingRole | null;
    allowedCompanies: CompanyId[];   // aziende selezionabili dall'utente
    /**
     * true quando l'admin ha selezionato "Tutte le aziende" (cookie ALL_COMPANIES).
     * In questa modalità le dashboard KPI aggregano su `allowedCompanies` (vedi
     * companyScope) e le pagine operative/le scritture sono bloccate
     * (assertSingleCompany). `companyId` resta comunque un'azienda reale.
     */
    isAllCompanies: boolean;
}

/**
 * Legge il contesto utente corrente. Lancia se non autenticato.
 * Usa user_metadata Supabase per i campi di tenancy; per back-compat ritorna
 * 'fenice'/'sales' se mancanti (la migration M5 finale rimuoverà il default
 * dopo che tutti gli utenti avranno i metadata popolati).
 */
export async function currentTenant(): Promise<TenantContext> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Unauthorized: no Supabase user');

    const meta = user.user_metadata ?? {};

    const fallbackCompany: CompanyId = meta.companyId ?? 'fenice';
    const allowedCompanies: CompanyId[] =
        Array.isArray(meta.allowedCompanies) && meta.allowedCompanies.length > 0
            ? meta.allowedCompanies
            : [fallbackCompany];

    const role: string = meta.role ?? 'GDO';

    // Azienda attiva: cookie se consentito, altrimenti companyId metadata se
    // consentito, altrimenti la prima consentita. Sempre validato server-side.
    // La sentinella ALL_COMPANIES è ammessa solo per admin con >1 aziende; in quel
    // caso `companyId` resta un fallback reale e si alza il flag isAllCompanies.
    let activeCompany: CompanyId = fallbackCompany;
    let isAllCompanies = false;
    const realFallback = () =>
        allowedCompanies.includes(fallbackCompany) ? fallbackCompany : allowedCompanies[0];
    try {
        const cookieStore = await cookies();
        const cookieVal = cookieStore.get(SALES_ACTIVE_COMPANY_COOKIE)?.value;
        if (cookieVal === ALL_COMPANIES && role === 'ADMIN' && allowedCompanies.length > 1) {
            isAllCompanies = true;
            activeCompany = realFallback();
        } else if (cookieVal && allowedCompanies.includes(cookieVal)) {
            activeCompany = cookieVal;
        } else {
            activeCompany = realFallback();
        }
    } catch {
        // cookies() non disponibile (contesto non-request): usa il fallback.
        activeCompany = realFallback();
    }

    return {
        userId: user.id,
        email: user.email ?? null,
        role,
        companyId: activeCompany,
        area: (meta.area as TenantArea) ?? 'sales',
        marketingRole: (meta.marketingRole as MarketingRole) ?? null,
        allowedCompanies,
        isAllCompanies,
    };
}

/**
 * Variante "sicura": ritorna null invece di lanciare. Utile in pagine
 * server-rendered che gestiscono il redirect a /login a livello UI.
 */
export async function tryCurrentTenant(): Promise<TenantContext | null> {
    try {
        return await currentTenant();
    } catch {
        return null;
    }
}

/**
 * Guard: l'utente DEVE avere accesso sales (area 'sales' o 'both').
 * Chiama questa nella prima riga di ogni Server Action sales.
 */
export function assertSalesArea(ctx: TenantContext): void {
    if (ctx.area !== 'sales' && ctx.area !== 'both') {
        throw new Error(`Forbidden: user ${ctx.userId} has area '${ctx.area}', sales required`);
    }
}

/**
 * Guard: l'utente DEVE avere accesso marketing (area 'marketing' o 'both').
 * Chiama questa nella prima riga di ogni route marketing.
 */
export function assertMarketingArea(ctx: TenantContext): void {
    if (ctx.area !== 'marketing' && ctx.area !== 'both') {
        throw new Error(`Forbidden: user ${ctx.userId} has area '${ctx.area}', marketing required`);
    }
}

/**
 * Guard: l'azione richiede una SINGOLA azienda selezionata. Lancia in modalità
 * "Tutte le aziende". Da chiamare in testa a ogni Server Action di SCRITTURA e
 * nelle pagine operative: non si può lavorare/scrivere un lead sul gruppo fittizio.
 */
export function assertSingleCompany(ctx: TenantContext): void {
    if (ctx.isAllCompanies) {
        throw new Error('Forbidden: azione non disponibile in modalità "Tutte le aziende"');
    }
}

/**
 * Filtro azienda per le query KPI/reporting. In modalità singola → eq(col, companyId).
 * In modalità "Tutte le aziende" → inArray(col, allowedCompanies): aggrega su tutte
 * le aziende consentite all'utente. Funziona su qualsiasi colonna `companyId`
 * (leads, callLogs, users, leadEvents, monthlyTargets, ...).
 *
 * Sintassi: where(and(companyScope(ctx, leads.companyId), eq(leads.status, 'NEW')))
 */
export function companyScope(ctx: TenantContext, col: AnyPgColumn) {
    return ctx.isAllCompanies
        ? inArray(col, ctx.allowedCompanies)
        : eq(col, ctx.companyId);
}

/**
 * Guard: il lead `leadId` DEVE appartenere al tenant corrente.
 * Da chiamare PRIMA di qualsiasi azione sul lead quando l'ID arriva dal client
 * (form, fetch, ecc.). Non fidarsi mai dell'ID solo perché loggato.
 *
 * Costo: 1 SELECT su PK. Cache-friendly se ripetuta nella stessa request.
 */
export async function assertLeadInCompany(leadId: string, companyId: CompanyId): Promise<void> {
    const [row] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
        .limit(1);
    if (!row) {
        throw new Error(`Forbidden: lead ${leadId} not found in company ${companyId}`);
    }
}

/**
 * Helper: filtro `companyId` da combinare con altre condizioni in un and().
 * Sintassi: where(withCompanyScope(ctx.companyId, eq(leads.status,'NEW'), eq(leads.assignedToId, userId)))
 * Equivale a: where(and(eq(leads.companyId, ctx.companyId), eq(leads.status,'NEW'), eq(leads.assignedToId, userId)))
 *
 * NOTE: questo helper è specifico per `leads`. Per altri tavoli, costruisci
 * l'and() manualmente; un helper generico richiede generics sui colonne table-specific.
 */
export function withCompanyScopeLeads(companyId: CompanyId, ...conditions: any[]) {
    return and(eq(leads.companyId, companyId), ...conditions);
}

/**
 * Backup lookup: legge companyId dal tavolo `users` Drizzle, bypassando i
 * user_metadata Supabase. Da usare SOLO in script di migrazione o in casi
 * di debug; nelle Server Action preferire currentTenant() che è 10x più
 * veloce (no DB roundtrip).
 */
export async function companyIdFromUserId(userId: string): Promise<CompanyId | null> {
    const [row] = await db
        .select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    return row?.companyId ?? null;
}
