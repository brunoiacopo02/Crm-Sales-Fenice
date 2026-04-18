/**
 * Webhook receiver per ActiveCampaign.
 *
 * Regola ingresso (permissiva):
 * - TELEFONO obbligatorio e normalizzabile — altrimenti failure.
 * - Provenienza opzionale → se vuota, funnel = 'SCONOSCIUTO'.
 * - Email opzionale → può essere null.
 * - Nome opzionale → fallback 'Lead senza nome'.
 * - Se AC API ritorna errore durante il fetch del contatto → failure.
 *
 * I failure vanno nella tabella acIntakeFailures (visibile nella UI
 * /lead-automatici), con il payload originale per debug. UNA sola
 * notifica aggregata al manager invece di una per ogni errore.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users, acIntakeFailures, notifications } from "@/db/schema";
import { eq, and, asc, sql, isNull, gte } from "drizzle-orm";
import crypto from "crypto";
import { logLeadEvent } from "@/lib/eventLogger";
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize";

const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com';
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || '';
const WEBHOOK_SECRET = process.env.ACTIVECAMPAIGN_WEBHOOK_SECRET || '';
const PROVENIENZA_FIELD_ID = '2';
const DEFAULT_FUNNEL = 'SCONOSCIUTO';

// Custom field id su AC per gli UTM (visti via /api/3/fields).
const UTM_FIELD_IDS = {
    utmSource: '31',
    utmMedium: '32',
    utmCampaign: '33',
    utmContent: '34',
    utmTerm: '35',
} as const;

async function acGet(path: string): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${path}`, {
        headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`AC API ${res.status}: ${await res.text()}`);
    return res.json();
}

async function recordFailure(input: {
    reason: string;
    acContactId?: string | null;
    provenienza?: string | null;
    email?: string | null;
    phoneRaw?: string | null;
    payload: Record<string, unknown>;
}) {
    await db.insert(acIntakeFailures).values({
        id: crypto.randomUUID(),
        acContactId: input.acContactId ?? null,
        reason: input.reason,
        provenienza: input.provenienza ?? null,
        email: input.email ?? null,
        phoneRaw: input.phoneRaw ?? null,
        payload: input.payload,
    });
    await notifyManagersIfNeeded();
}

/**
 * Notifica ai manager: UNA sola notifica ogni 10 minuti di inattività,
 * non una per ogni failure. Messaggio link-style che invita ad aprire la
 * sezione "Lead non importati".
 */
async function notifyManagersIfNeeded() {
    try {
        const managers = await db.select({ id: users.id }).from(users)
            .where(sql`${users.role} IN ('MANAGER', 'ADMIN')`);
        if (managers.length === 0) return;

        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        for (const m of managers) {
            const [recent] = await db.select({ id: notifications.id }).from(notifications)
                .where(and(
                    eq(notifications.recipientUserId, m.id),
                    eq(notifications.type, 'ac_intake_failure_digest'),
                    gte(notifications.createdAt, tenMinAgo),
                )).limit(1);
            if (recent) continue;

            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: m.id,
                type: 'ac_intake_failure_digest',
                title: 'Lead AC non importato',
                body: 'Uno o più lead AC non sono stati importati. Apri Lead Automatici per vederli e decidere come gestirli.',
                metadata: { link: '/lead-automatici' },
            });
        }
    } catch (e) {
        console.error('notifyManagersIfNeeded error:', e);
    }
}

export async function POST(req: NextRequest) {
    let rawPayload: Record<string, string> = {};
    try {
        const secret = req.nextUrl.searchParams.get('secret');
        if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }

        // Parse body
        const contentType = req.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            rawPayload = flattenObject(await req.json());
        } else {
            const text = await req.text();
            for (const [k, v] of new URLSearchParams(text).entries()) rawPayload[k] = v;
        }

        const contactId = rawPayload['contact[id]'] || rawPayload['contact.id'] || rawPayload['id'];
        if (!contactId) {
            await recordFailure({ reason: 'Payload senza contact id', payload: rawPayload });
            return NextResponse.json({ error: 'missing contact id' }, { status: 400 });
        }

        // Fetch contatto + fieldValues
        let contact: any = null;
        let fieldValues: Array<{ field: string; value: string | null }> = [];
        try {
            const [contactResp, fvResp] = await Promise.all([
                acGet(`/contacts/${contactId}`),
                acGet(`/contacts/${contactId}/fieldValues`),
            ]);
            contact = contactResp.contact;
            fieldValues = fvResp.fieldValues || [];
        } catch (apiErr) {
            await recordFailure({
                reason: `Errore fetch AC API: ${apiErr instanceof Error ? apiErr.message.substring(0, 200) : String(apiErr)}`,
                acContactId: contactId,
                payload: rawPayload,
            });
            return NextResponse.json({ error: 'ac api failure', retryable: true }, { status: 502 });
        }

        if (!contact) {
            await recordFailure({ reason: 'Contatto non trovato su AC', acContactId: contactId, payload: rawPayload });
            return NextResponse.json({ error: 'contact not found' }, { status: 404 });
        }

        const firstName = String(contact.firstName || '').trim();
        const lastName = String(contact.lastName || '').trim();
        const email = String(contact.email || '').trim() || null;
        const rawPhone = String(contact.phone || '').trim();
        const provenienza = (fieldValues.find((f) => String(f.field) === PROVENIENZA_FIELD_ID)?.value || '').trim();

        // UTM (custom field 31-35). Salvati per uso marketing futuro, non mostrati in UI.
        const readField = (fieldId: string): string | null => {
            const v = fieldValues.find((f) => String(f.field) === fieldId)?.value;
            return v && String(v).trim() ? String(v).trim() : null;
        };
        const utmSource = readField(UTM_FIELD_IDS.utmSource);
        const utmMedium = readField(UTM_FIELD_IDS.utmMedium);
        const utmCampaign = readField(UTM_FIELD_IDS.utmCampaign);
        const utmContent = readField(UTM_FIELD_IDS.utmContent);
        const utmTerm = readField(UTM_FIELD_IDS.utmTerm);

        // Telefono: bloccante SOLO se totalmente assente. Se è troppo corto
        // o formato strano, importo comunque il lead preservando le cifre
        // ricevute e aggiungo un warning nella nota del lead.
        if (!rawPhone) {
            await recordFailure({
                reason: 'Telefono assente',
                acContactId: contactId,
                provenienza: provenienza || null,
                email,
                phoneRaw: null,
                payload: rawPayload,
            });
            return NextResponse.json({ skipped: 'missing phone' });
        }

        const phoneStrict = normalizePhoneStrict(rawPhone);
        const phoneFinal = phoneStrict ?? normalizePhoneLenient(rawPhone);
        if (!phoneFinal) {
            // Caso estremo: stringa senza cifre ("---", "N/D", ecc.)
            await recordFailure({
                reason: `Telefono non utilizzabile (nessuna cifra): "${rawPhone}"`,
                acContactId: contactId,
                provenienza: provenienza || null,
                email,
                phoneRaw: rawPhone,
                payload: rawPayload,
            });
            return NextResponse.json({ skipped: 'invalid phone' });
        }
        const phoneSuspicious = !isPlausiblePhone(phoneStrict);

        const funnel = provenienza ? provenienza.toUpperCase() : DEFAULT_FUNNEL;

        // Round-robin GDO
        const eligible = await db.select({
            id: users.id,
            acLastAssignedAt: users.acLastAssignedAt,
        }).from(users).where(and(
            eq(users.role, 'GDO'),
            eq(users.isActive, true),
            eq(users.acAutoIntake, true),
        )).orderBy(asc(sql`coalesce(${users.acLastAssignedAt}, 'epoch'::timestamptz)`), asc(users.id));

        if (eligible.length === 0) {
            await recordFailure({
                reason: 'Nessun GDO abilitato al round-robin AC',
                acContactId: contactId,
                provenienza: provenienza || null,
                email,
                phoneRaw: rawPhone,
                payload: rawPayload,
            });
            return NextResponse.json({ skipped: 'no active gdo' });
        }
        const assignedGdoId = eligible[0].id;

        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome';
        const newLeadId = crypto.randomUUID();
        const now = new Date();
        await db.insert(leads).values({
            id: newLeadId,
            name: fullName,
            phone: phoneFinal,
            email,
            funnel,
            source: 'activecampaign',
            utmSource,
            utmMedium,
            utmCampaign,
            utmContent,
            utmTerm,
            phoneSuspicious,
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
            metadata: {
                source: 'activecampaign',
                acContactId: contactId,
                provenienza: provenienza || null,
                funnelFallback: !provenienza,
                phoneSuspicious,
                phoneRaw: phoneSuspicious ? rawPhone : undefined,
            },
        });
        await logLeadEvent({
            leadId: newLeadId,
            eventType: 'ASSIGNED',
            metadata: { assignedToUser: assignedGdoId, source: 'activecampaign' },
        });

        await db.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, assignedGdoId));

        return NextResponse.json({
            success: true,
            leadId: newLeadId,
            funnel,
            funnelFallback: !provenienza,
            phoneSuspicious,
            assignedTo: assignedGdoId,
        });
    } catch (e) {
        console.error('AC webhook error:', e);
        const msg = e instanceof Error ? e.message : String(e);
        try {
            // Estrae dal payload i campi più utili anche quando il fetch AC è fallito
            await recordFailure({
                reason: `Errore server: ${msg.substring(0, 200)}`,
                acContactId: rawPayload['contact[id]'] || rawPayload['contact.id'] || rawPayload['id'] || null,
                email: rawPayload['contact[email]'] || rawPayload['contact.email'] || null,
                phoneRaw: rawPayload['contact[phone]'] || rawPayload['contact.phone'] || null,
                payload: rawPayload,
            });
        } catch { /* best-effort */ }
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

// mantiene isNull usato in futuro se serve
void isNull;

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
