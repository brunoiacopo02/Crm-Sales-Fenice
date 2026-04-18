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
    provenienza: string | null;
    email: string | null;
    phoneRaw: string | null;
    payload: unknown;
    resolvedAt: Date | null;
    createdAt: Date;
    acContactLink: string | null;
}

export async function listAcFailures(onlyUnresolved: boolean = true): Promise<AcFailureRow[]> {
    await requireManager();
    const rows = await db.select().from(acIntakeFailures)
        .where(onlyUnresolved ? isNull(acIntakeFailures.resolvedAt) : undefined as any)
        .orderBy(desc(acIntakeFailures.createdAt))
        .limit(200);
    return rows.map((r) => ({
        id: r.id,
        acContactId: r.acContactId,
        reason: r.reason,
        provenienza: r.provenienza,
        email: r.email,
        phoneRaw: r.phoneRaw,
        payload: r.payload,
        resolvedAt: r.resolvedAt,
        createdAt: r.createdAt,
        acContactLink: r.acContactId
            ? `${AC_URL.replace('https://', 'https://').replace('.api-us1.com', '.activehosted.com')}/app/contacts/${r.acContactId}`
            : null,
    }));
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
