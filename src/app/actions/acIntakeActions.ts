"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
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
