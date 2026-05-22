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
import { db } from '@/db';
import { leads, users } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

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
    return {
        userId: user.id,
        email: user.email ?? null,
        role: meta.role ?? 'GDO',
        companyId: meta.companyId ?? 'fenice',
        area: (meta.area as TenantArea) ?? 'sales',
        marketingRole: (meta.marketingRole as MarketingRole) ?? null,
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
