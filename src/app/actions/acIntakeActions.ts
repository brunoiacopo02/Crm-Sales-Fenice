"use server";

import { db } from "@/db";
import { users, acIntakeFailures } from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";

async function requireManager() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = user?.user_metadata?.role as string | undefined;
    if (!user || !role || !["MANAGER", "ADMIN"].includes(role)) {
        throw new Error("Unauthorized");
    }
    return { id: user.id, role };
}

// ============ UI: list + toggle ============
export interface GdoAcIntakeRow {
    id: string;
    gdoCode: number | null;
    name: string | null;
    displayName: string | null;
    isActive: boolean;
    acAutoIntake: boolean;
    acLastAssignedAt: Date | null;
}

export async function listGdosForAcIntake(): Promise<GdoAcIntakeRow[]> {
    await requireManager();
    const rows = await db.select({
        id: users.id,
        gdoCode: users.gdoCode,
        name: users.name,
        displayName: users.displayName,
        isActive: users.isActive,
        acAutoIntake: users.acAutoIntake,
        acLastAssignedAt: users.acLastAssignedAt,
    }).from(users).where(eq(users.role, 'GDO'));
    return rows.sort((a, b) => (a.gdoCode ?? 9999) - (b.gdoCode ?? 9999));
}

export async function setGdoAcIntake(gdoUserId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
        await requireManager();
        await db.update(users).set({ acAutoIntake: enabled }).where(and(
            eq(users.id, gdoUserId),
            eq(users.role, 'GDO'),
        ));
        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function disableAllAcIntake(): Promise<{ success: boolean; error?: string }> {
    try {
        await requireManager();
        await db.update(users).set({ acAutoIntake: false }).where(eq(users.role, 'GDO'));
        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// ============ AC webhook setup ============
const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com';
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || '';
const WEBHOOK_SECRET = process.env.ACTIVECAMPAIGN_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || process.env.NEXTAUTH_URL || 'https://crm-sales-fenice.vercel.app';

async function acRequest(path: string, method: string = 'GET', body?: unknown): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${path}`, {
        method,
        headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`AC ${res.status}: ${text.substring(0, 200)}`);
    return text ? JSON.parse(text) : {};
}

export async function listAcWebhooks(): Promise<{ success: boolean; webhooks?: Array<{ id: string; url: string; events: string[]; name: string }>; error?: string }> {
    try {
        await requireManager();
        const data = await acRequest('/webhooks?limit=50');
        const webhooks = (data.webhooks || []).map((w: any) => ({
            id: w.id,
            url: w.url,
            events: w.events || [],
            name: w.name || '',
        }));
        return { success: true, webhooks };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function setupAcWebhook(): Promise<{ success: boolean; webhookId?: string; url?: string; error?: string }> {
    try {
        await requireManager();
        if (!WEBHOOK_SECRET) {
            return { success: false, error: "Manca ACTIVECAMPAIGN_WEBHOOK_SECRET in env Vercel" };
        }
        const url = `${APP_URL}/api/webhooks/activecampaign?secret=${encodeURIComponent(WEBHOOK_SECRET)}`;

        // Verifica se un webhook CRM-intake è già presente
        const existing = await acRequest('/webhooks?limit=50');
        const ours = (existing.webhooks || []).find((w: any) =>
            (w.url || '').startsWith(`${APP_URL}/api/webhooks/activecampaign`)
        );
        if (ours) {
            // Aggiorna URL (potrebbe essere cambiato il secret)
            await acRequest(`/webhooks/${ours.id}`, 'PUT', {
                webhook: {
                    name: 'CRM Fenice — Lead Auto-Intake',
                    url,
                    events: ['subscribe'],
                    sources: ['public', 'admin', 'api', 'system'],
                },
            });
            return { success: true, webhookId: ours.id, url };
        }

        const created = await acRequest('/webhooks', 'POST', {
            webhook: {
                name: 'CRM Fenice — Lead Auto-Intake',
                url,
                events: ['subscribe'],
                sources: ['public', 'admin', 'api', 'system'],
            },
        });
        return { success: true, webhookId: created.webhook?.id, url };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// ============ AC intake failures (lead non importati) ============

export interface AcFailureRow {
    id: string;
    acContactId: string | null;
    reason: string;
    reasonHuman: string;           // testo italiano leggibile
    reasonCategory: 'phone' | 'ac_api' | 'no_gdo' | 'missing_id' | 'not_found' | 'server' | 'other';
    provenienza: string | null;
    email: string | null;
    phoneRaw: string | null;
    firstName: string | null;       // estratto dal payload quando fetch AC è fallito
    lastName: string | null;
    payload: unknown;
    resolvedAt: Date | null;
    createdAt: Date;
    acContactLink: string | null;
}

function humanizeReason(reason: string): { human: string; category: AcFailureRow['reasonCategory'] } {
    const r = reason || '';
    if (r.startsWith('Telefono non normalizzabile')) {
        const match = r.match(/"([^"]*)"/);
        const num = match?.[1] ?? '';
        return { human: `Telefono non valido o troppo corto${num ? ` ("${num}")` : ''}.`, category: 'phone' };
    }
    if (r === 'Telefono assente') return { human: 'Il contatto AC non ha un numero di telefono.', category: 'phone' };
    if (r.startsWith('Errore fetch AC API')) {
        if (r.includes('403')) return { human: 'ActiveCampaign ha rifiutato la richiesta (403). Può succedere durante un redeploy — riprova tra poco.', category: 'ac_api' };
        if (r.includes('404')) return { human: 'Contatto non più presente su AC (404). Forse è stato cancellato.', category: 'not_found' };
        if (r.includes('429')) return { human: 'Troppe chiamate verso AC (429). Il sistema riproverà.', category: 'ac_api' };
        return { human: 'Errore nella chiamata verso ActiveCampaign. Riprova.', category: 'ac_api' };
    }
    if (r === 'Contatto non trovato su AC') return { human: 'Il contatto non esiste più su AC.', category: 'not_found' };
    if (r === 'Payload senza contact id') return { human: 'AC ha mandato un payload senza ID contatto (spesso è un "test" inviato da AC). Puoi ignorarlo.', category: 'missing_id' };
    if (r === 'Nessun GDO abilitato al round-robin AC') return { human: 'Nessun GDO era abilitato quando il lead è arrivato. Abilita almeno un GDO e clicca Riprova.', category: 'no_gdo' };
    if (r.startsWith('Errore server')) return { human: 'Errore interno al CRM durante il salvataggio. Riprova o segnalalo.', category: 'server' };
    return { human: r, category: 'other' };
}

function extractPayloadField(payload: unknown, keys: string[]): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    for (const k of keys) {
        const v = p[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
}

export async function listAcFailures(onlyUnresolved: boolean = true): Promise<AcFailureRow[]> {
    await requireManager();
    const rows = await db.select().from(acIntakeFailures)
        .where(onlyUnresolved ? isNull(acIntakeFailures.resolvedAt) : undefined as any)
        .orderBy(desc(acIntakeFailures.createdAt))
        .limit(200);
    return rows.map((r) => {
        const { human, category } = humanizeReason(r.reason);
        return {
            id: r.id,
            acContactId: r.acContactId,
            reason: r.reason,
            reasonHuman: human,
            reasonCategory: category,
            provenienza: r.provenienza,
            email: r.email ?? extractPayloadField(r.payload, ['contact[email]', 'contact.email']),
            phoneRaw: r.phoneRaw ?? extractPayloadField(r.payload, ['contact[phone]', 'contact.phone']),
            firstName: extractPayloadField(r.payload, ['contact[first_name]', 'contact[firstName]', 'contact.firstName', 'contact.first_name']),
            lastName: extractPayloadField(r.payload, ['contact[last_name]', 'contact[lastName]', 'contact.lastName', 'contact.last_name']),
            payload: r.payload,
            resolvedAt: r.resolvedAt,
            createdAt: r.createdAt,
            acContactLink: r.acContactId
                ? `${AC_URL.replace('.api-us1.com', '.activehosted.com')}/app/contacts/${r.acContactId}`
                : null,
        };
    });
}

export async function resolveAcFailure(id: string): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await requireManager();
        await db.update(acIntakeFailures).set({
            resolvedAt: new Date(),
            resolvedBy: session.id,
        }).where(eq(acIntakeFailures.id, id));
        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * Riprova a importare il contatto AC associato a una failure. Chiama di
 * nuovo il webhook internamente; se riesce, marca la failure come risolta.
 */
export async function retryAcFailure(id: string): Promise<{ success: boolean; error?: string; leadId?: string }> {
    try {
        const session = await requireManager();
        const [row] = await db.select().from(acIntakeFailures).where(eq(acIntakeFailures.id, id));
        if (!row) return { success: false, error: 'Failure non trovata' };
        if (!row.acContactId) return { success: false, error: 'Nessun contact id associato — non si può riprovare' };
        if (!WEBHOOK_SECRET) return { success: false, error: 'Webhook secret non configurato' };

        const url = `${APP_URL}/api/webhooks/activecampaign?secret=${encodeURIComponent(WEBHOOK_SECRET)}`;
        const form = new URLSearchParams({ 'contact[id]': row.acContactId, type: 'subscribe', source: 'manual_retry' });
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
            return { success: false, error: data?.error || data?.skipped || `HTTP ${res.status}` };
        }
        // Successo: marca come risolto
        await db.update(acIntakeFailures).set({
            resolvedAt: new Date(),
            resolvedBy: session.id,
        }).where(eq(acIntakeFailures.id, id));
        return { success: true, leadId: data.leadId };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function deleteAcWebhookByUrl(): Promise<{ success: boolean; error?: string }> {
    try {
        await requireManager();
        const existing = await acRequest('/webhooks?limit=50');
        const ours = (existing.webhooks || []).find((w: any) =>
            (w.url || '').startsWith(`${APP_URL}/api/webhooks/activecampaign`)
        );
        if (!ours) return { success: true };
        await acRequest(`/webhooks/${ours.id}`, 'DELETE');
        return { success: true };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}
