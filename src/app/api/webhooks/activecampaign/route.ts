/**
 * Webhook receiver per ActiveCampaign.
 *
 * Flow:
 * 1. Validazione secret via query param `?secret=<ACTIVECAMPAIGN_WEBHOOK_SECRET>`.
 * 2. Parse payload (AC invia form-urlencoded).
 * 3. Fetch contatto completo (incluso custom field `Provenienza`) dall'API AC.
 * 4. Normalizza telefono con lib phoneNormalize.
 * 5. Round-robin GDO: least-recently-assigned con acAutoIntake=true + isActive=true.
 * 6. Insert lead + logLeadEvent IMPORTED + update acLastAssignedAt sul GDO.
 * 7. Se errore: log in importLogs + notifica MANAGER via notifications.
 *
 * Duplicati: creati come lead nuovi (per scelta esplicita — diversi da import CSV).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users, importLogs, notifications } from "@/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import crypto from "crypto";
import { logLeadEvent } from "@/lib/eventLogger";
import { normalizePhone, isPlausiblePhone } from "@/lib/phoneNormalize";

const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com';
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || '';
const WEBHOOK_SECRET = process.env.ACTIVECAMPAIGN_WEBHOOK_SECRET || '';
const PROVENIENZA_FIELD_ID = '2'; // custom field "Provenienza" su AC

async function acGet(path: string): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${path}`, {
        headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`AC API ${res.status}: ${await res.text()}`);
    return res.json();
}

async function notifyAllManagers(title: string, body: string, metadata: Record<string, unknown>) {
    const managers = await db.select({ id: users.id }).from(users)
        .where(sql`${users.role} IN ('MANAGER', 'ADMIN')`);
    for (const m of managers) {
        await db.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: m.id,
            type: 'ac_intake_error',
            title,
            body,
            metadata,
        });
    }
}

async function logIntakeError(reason: string, payload: Record<string, unknown>) {
    await db.insert(importLogs).values({
        id: crypto.randomUUID(),
        totalRows: 1,
        importedCount: 0,
        duplicateCount: 0,
        invalidCount: 1,
        perGdoAssigned: { reason, payload },
        createdAt: new Date(),
    });
    await notifyAllManagers(
        'Lead AC non importato',
        `Un lead da ActiveCampaign non è stato importato: ${reason}`,
        { reason, payload },
    );
}

export async function POST(req: NextRequest) {
    try {
        // 1. Secret
        const secret = req.nextUrl.searchParams.get('secret');
        if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }

        // 2. Parse body (AC invia application/x-www-form-urlencoded)
        const contentType = req.headers.get('content-type') || '';
        let raw: Record<string, string> = {};
        if (contentType.includes('application/json')) {
            const j = await req.json();
            raw = flattenObject(j);
        } else {
            const text = await req.text();
            const params = new URLSearchParams(text);
            for (const [k, v] of params.entries()) raw[k] = v;
        }

        const contactId = raw['contact[id]'] || raw['contact.id'] || raw['id'];
        if (!contactId) {
            await logIntakeError('Payload senza contact id', raw);
            return NextResponse.json({ error: 'missing contact id' }, { status: 400 });
        }

        // 3. Fetch contatto completo + fieldValues per leggere Provenienza
        const [contactResp, fieldValuesResp] = await Promise.all([
            acGet(`/contacts/${contactId}`),
            acGet(`/contacts/${contactId}/fieldValues`),
        ]);
        const contact = contactResp.contact;
        if (!contact) {
            await logIntakeError(`Contatto ${contactId} non trovato su AC`, raw);
            return NextResponse.json({ error: 'contact not found' }, { status: 404 });
        }

        const firstName = String(contact.firstName || '').trim();
        const lastName = String(contact.lastName || '').trim();
        const email = String(contact.email || '').trim() || null;
        const rawPhone = String(contact.phone || '').trim();

        // Provenienza (funnel)
        const fvs = (fieldValuesResp.fieldValues || []) as Array<{ field: string; value: string | null }>;
        const provenienza = (fvs.find((f) => String(f.field) === PROVENIENZA_FIELD_ID)?.value || '').trim();

        if (!provenienza) {
            await logIntakeError(`Contatto ${contactId} senza valore Provenienza`, { contactId, email, rawPhone });
            return NextResponse.json({ skipped: 'missing provenienza' });
        }
        const funnel = provenienza.toUpperCase();

        // 4. Normalizza telefono
        const phone = normalizePhone(rawPhone);
        if (!isPlausiblePhone(phone)) {
            await logIntakeError(`Telefono non normalizzabile: "${rawPhone}"`, { contactId, email, funnel, rawPhone });
            return NextResponse.json({ skipped: 'invalid phone' });
        }

        // 5. Round-robin: least-recently-assigned tra GDO attivi con acAutoIntake=true
        const eligible = await db.select({
            id: users.id,
            acLastAssignedAt: users.acLastAssignedAt,
        }).from(users).where(and(
            eq(users.role, 'GDO'),
            eq(users.isActive, true),
            eq(users.acAutoIntake, true),
        )).orderBy(asc(sql`coalesce(${users.acLastAssignedAt}, 'epoch'::timestamptz)`), asc(users.id));

        if (eligible.length === 0) {
            await logIntakeError('Nessun GDO abilitato per lead automatici', { contactId, funnel });
            return NextResponse.json({ skipped: 'no active gdo' });
        }
        const assignedGdoId = eligible[0].id;

        // 6. Insert lead
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome';
        const newLeadId = crypto.randomUUID();
        const now = new Date();
        await db.insert(leads).values({
            id: newLeadId,
            name: fullName,
            phone: phone!,
            email,
            funnel,
            status: 'NEW',
            callCount: 0,
            assignedToId: assignedGdoId,
            createdAt: now,
            updatedAt: now,
        });

        await logLeadEvent({
            leadId: newLeadId,
            eventType: 'IMPORTED',
            toSection: 'Prima Chiamata',
            metadata: { source: 'activecampaign', acContactId: contactId, provenienza },
        });
        await logLeadEvent({
            leadId: newLeadId,
            eventType: 'ASSIGNED',
            metadata: { assignedToUser: assignedGdoId, source: 'activecampaign' },
        });

        // 7. Update cursore round-robin
        await db.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, assignedGdoId));

        return NextResponse.json({
            success: true,
            leadId: newLeadId,
            funnel,
            assignedTo: assignedGdoId,
        });
    } catch (e) {
        console.error('AC webhook error:', e);
        const msg = e instanceof Error ? e.message : String(e);
        try { await logIntakeError(`Errore server: ${msg}`, {}); } catch { /* best-effort */ }
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

// Flatten nested AC payload (es. { contact: { id: "1" } }) in chiavi "contact[id]".
function flattenObject(obj: unknown, prefix = ''): Record<string, string> {
    const out: Record<string, string> = {};
    if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const key = prefix ? `${prefix}[${k}]` : k;
            if (v !== null && typeof v === 'object') {
                Object.assign(out, flattenObject(v, key));
            } else if (v !== null && v !== undefined) {
                out[key] = String(v);
            }
        }
    }
    return out;
}
