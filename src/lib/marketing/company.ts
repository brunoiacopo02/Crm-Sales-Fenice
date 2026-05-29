// src/lib/marketing/company.ts
// Helper centralizzato per la selezione azienda corrente (porting da crm-marketing).
//
// Cookie `selected_company` (HttpOnly, SameSite=Lax, 30gg) può avere valori:
//   - slug di una company attiva ('fenice','serenamente','fcd')
//   - 'all' (vista aggregata)
// Se mancante o invalido: le route devono redirigere a /select-company.

import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { eq, asc } from 'drizzle-orm';
import { db } from '@/db';
import { companies as companiesTbl } from '@/db/schema';

export const SELECTED_COMPANY_COOKIE = 'selected_company';
export const SELECTED_COMPANY_MAX_AGE = 60 * 60 * 24 * 30; // 30 giorni

export interface Company {
    id: string;
    name: string;
    display_name: string;
    short_code: string;
    currency: string;
    is_active: boolean;
    sort_order: number;
}

export type CompanySelection =
    | { mode: 'single'; companyId: string; company: Company }
    | { mode: 'all'; companies: Company[] };

// Cache in-memory (5 minuti). Vivo per istanza serverless ⇒ utile a ridurre
// query nello stesso warm container.
let _cache: { data: Company[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function listActiveCompanies(): Promise<Company[]> {
    const now = Date.now();
    if (_cache && _cache.expiresAt > now) return _cache.data;
    try {
        const rows = await db
            .select({
                id: companiesTbl.id,
                name: companiesTbl.name,
                displayName: companiesTbl.displayName,
                shortCode: companiesTbl.shortCode,
                currency: companiesTbl.currency,
                isActive: companiesTbl.isActive,
                sortOrder: companiesTbl.sortOrder,
            })
            .from(companiesTbl)
            .where(eq(companiesTbl.isActive, true))
            .orderBy(asc(companiesTbl.sortOrder));
        const list: Company[] = rows.map((r) => ({
            id: r.id,
            name: r.name,
            display_name: r.displayName,
            short_code: r.shortCode,
            currency: r.currency,
            is_active: r.isActive,
            sort_order: r.sortOrder,
        }));
        _cache = { data: list, expiresAt: now + CACHE_TTL_MS };
        return list;
    } catch (e) {
        console.error('listActiveCompanies error', e);
        return [];
    }
}

function readCookieFromRequest(req?: NextRequest): string | null {
    if (req) return req.cookies.get(SELECTED_COMPANY_COOKIE)?.value ?? null;
    return null;
}

async function readCookieFromContext(): Promise<string | null> {
    const store = await cookies();
    return store.get(SELECTED_COMPANY_COOKIE)?.value ?? null;
}

export async function getSelectedCompany(
    req?: NextRequest,
): Promise<CompanySelection | null> {
    const raw = req ? readCookieFromRequest(req) : await readCookieFromContext();
    if (!raw) return null;
    const companies = await listActiveCompanies();
    if (raw === 'all') return { mode: 'all', companies };
    const company = companies.find((c) => c.id === raw);
    if (!company) return null;
    return { mode: 'single', companyId: company.id, company };
}

export function companyIdsForFilter(sel: CompanySelection): string[] {
    if (sel.mode === 'single') return [sel.companyId];
    return sel.companies.map((c) => c.id);
}

export function invalidateCompaniesCache(): void {
    _cache = null;
}

// Helper per route "single-only" (Pattern A): risolve l'azienda corrente o
// ritorna un Response 400/409 pronto da rispondere.
//
// Quando il cookie è 'all', accetta un override `?company=<slug>` per
// permettere alle pagine all-aware di fare fan-out client-side: una fetch
// per azienda. Il cookie single non è override-abile (evita data leak
// cross-company se l'utente fosse limitato a una singola azienda).
export async function requireSingleCompany(
    req?: NextRequest,
): Promise<
    | { ok: true; companyId: string; company: Company }
    | { ok: false; response: Response }
> {
    const sel = await getSelectedCompany(req);
    if (!sel) {
        return {
            ok: false,
            response: new Response(
                JSON.stringify({ error: 'Azienda non selezionata' }),
                { status: 400, headers: { 'content-type': 'application/json' } },
            ),
        };
    }
    if (sel.mode === 'all') {
        const override = req?.nextUrl.searchParams.get('company') ?? null;
        if (override) {
            const target = sel.companies.find((c) => c.id === override);
            if (target) {
                return { ok: true, companyId: target.id, company: target };
            }
        }
        return {
            ok: false,
            response: new Response(
                JSON.stringify({
                    error: 'Seleziona una singola azienda per questa pagina.',
                    code: 'SINGLE_COMPANY_REQUIRED',
                }),
                { status: 409, headers: { 'content-type': 'application/json' } },
            ),
        };
    }
    return { ok: true, companyId: sel.companyId, company: sel.company };
}
