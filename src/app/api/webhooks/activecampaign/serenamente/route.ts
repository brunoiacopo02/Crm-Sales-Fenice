/**
 * Webhook receiver per ActiveCampaign — TENANT SERENAMENTE.
 *
 * Endpoint dedicato per l'account ActiveCampaign di Serenamente. Tutti i
 * lead creati qui hanno companyId='serenamente' hardcoded. Il GDO round-
 * robin pesca SOLO tra GDO Serenamente. Failure e notifiche restano
 * isolate dal tenant Fenice.
 *
 * Env richieste:
 * - ACTIVECAMPAIGN_URL_SERENAMENTE     → base URL account AC Serenamente
 * - ACTIVECAMPAIGN_API_KEY_SERENAMENTE → API token AC
 * - ACTIVECAMPAIGN_WEBHOOK_SECRET_SERENAMENTE → secret query param
 *
 * Env opzionali (default vuoto — Serenamente parte senza quarantena):
 * - ACTIVECAMPAIGN_BLOCKED_LIST_NAMES_SERENAMENTE  (comma-separated nomi lista)
 * - ACTIVECAMPAIGN_QUARANTINED_FUNNELS_SERENAMENTE (comma-separated funnel)
 *
 * Regole ingresso identiche al webhook generico /api/webhooks/activecampaign
 * (telefono obbligatorio, provenienza opzionale, dedup 10 min, advisory lock,
 * round-robin per acLastAssignedAt). Vedi il file principale per la doc estesa.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { leads, users, acIntakeFailures, notifications } from "@/db/schema";
import { eq, and, asc, sql, isNull, gte, desc } from "drizzle-orm";
import crypto from "crypto";
import { logLeadEvent } from "@/lib/eventLogger";
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize";

const AC_URL = process.env.ACTIVECAMPAIGN_URL_SERENAMENTE || '';
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY_SERENAMENTE || '';
const WEBHOOK_SECRET = process.env.ACTIVECAMPAIGN_WEBHOOK_SECRET_SERENAMENTE || '';
const PROVENIENZA_FIELD_ID = '2';
const DEFAULT_FUNNEL = 'SCONOSCIUTO';

// Tenant fisso per QUESTO endpoint.
const SERENAMENTE_COMPANY = 'serenamente';

// Liste AC da NON importare (es. campagne di raccolta lead per lanci futuri).
// Serenamente parte senza blocchi: l'env è vuoto di default e si abilita
// quando serve via ACTIVECAMPAIGN_BLOCKED_LIST_NAMES_SERENAMENTE.
const BLOCKED_LIST_NAMES_NORMALIZED = new Set(
    (process.env.ACTIVECAMPAIGN_BLOCKED_LIST_NAMES_SERENAMENTE || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
);

// "Quarantena funnel": blocca l'ingresso automatico di lead con queste
// provenienze. Default vuoto: Serenamente non parte con quarantene attive.
const QUARANTINED_FUNNELS = new Set(
    (process.env.ACTIVECAMPAIGN_QUARANTINED_FUNNELS_SERENAMENTE || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
);

// Custom field id su AC per gli UTM. Stessi ID del flow Fenice perché il
// template AC è condiviso; se Serenamente userà custom field con id diversi,
// vanno parametrizzati qui.
const UTM_FIELD_IDS = {
    utmSource: '31',
    utmMedium: '32',
    utmCampaign: '33',
    utmContent: '34',
    utmTerm: '35',
} as const;

// Retry con backoff esponenziale + jitter sui 429 (rate limit AC, ~5 req/s
// per account) e sui 5xx transitori. Senza questo, un burst di webhook AC
// (es. automazione che riversa una lista intera in pochi secondi) satura il
// rate limit: ogni fetch sbatte su 429 e il lead finisce in acIntakeFailures
// invece di essere importato. Rispetta l'header Retry-After se presente.
const AC_MAX_RETRIES = 4;
async function acGet(path: string, attempt = 0): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${path}`, {
        headers: { 'Api-Token': AC_KEY, 'Content-Type': 'application/json' },
    });
    if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < AC_MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 10000)
            : Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoffMs));
        return acGet(path, attempt + 1);
    }
    if (!res.ok) throw new Error(`AC API ${res.status}: ${await res.text()}`);
    return res.json();
}

// Cache in-memory degli ID delle liste bloccate. Nome variabile distinto
// dal route Fenice — pur essendo module-scoped (file separato) il naming
// distinto aiuta debug e log.
let serenamenteBlockedListIdsCache: { ids: Set<string>; expires: number } | null = null;
async function getBlockedListIds(): Promise<Set<string>> {
    if (BLOCKED_LIST_NAMES_NORMALIZED.size === 0) return new Set();
    const now = Date.now();
    if (serenamenteBlockedListIdsCache && serenamenteBlockedListIdsCache.expires > now) {
        return serenamenteBlockedListIdsCache.ids;
    }
    const ids = new Set<string>();
    try {
        for (let offset = 0; offset < 500; offset += 100) {
            const res = await acGet(`/lists?limit=100&offset=${offset}`);
            const lists = Array.isArray(res.lists) ? res.lists : [];
            if (lists.length === 0) break;
            for (const l of lists) {
                const nameNorm = String(l?.name ?? '').trim().toLowerCase();
                if (nameNorm && BLOCKED_LIST_NAMES_NORMALIZED.has(nameNorm) && l?.id != null) {
                    ids.add(String(l.id));
                }
            }
            if (lists.length < 100) break;
        }
        console.log(`[AC webhook serenamente] getBlockedListIds: ${ids.size} blocked list(s) found — ids=${Array.from(ids).join(',')}`);
    } catch (e) {
        console.error('[AC webhook serenamente] getBlockedListIds error:', e);
    }
    serenamenteBlockedListIdsCache = { ids, expires: now + 10 * 60 * 1000 };
    return ids;
}

async function isContactInBlockedList(contactId: string): Promise<{ blocked: boolean; listId: string | null }> {
    const blocked = await getBlockedListIds();
    if (blocked.size === 0) return { blocked: false, listId: null };
    try {
        const res = await acGet(`/contacts/${contactId}/contactLists`);
        const memberships = Array.isArray(res.contactLists) ? res.contactLists : [];
        for (const m of memberships) {
            const listId = String(m?.list ?? '');
            const status = String(m?.status ?? '');
            if (listId && blocked.has(listId) && status === '1') {
                return { blocked: true, listId };
            }
        }
    } catch (e) {
        console.error(`[AC webhook serenamente] isContactInBlockedList error for contact ${contactId}:`, e);
    }
    return { blocked: false, listId: null };
}

function readFieldLocal(fieldValues: Array<{ field: string; value: string | null }>, fieldId: string): string | null {
    const v = fieldValues.find((f) => String(f.field) === fieldId)?.value;
    return v && String(v).trim() ? String(v).trim() : null;
}

async function fetchFieldValuesWithProvenienzaRetry(
    contactId: string,
    firstFieldValues: Array<{ field: string; value: string | null }>,
): Promise<Array<{ field: string; value: string | null }>> {
    const hasProvenienza = (fvs: typeof firstFieldValues): boolean =>
        !!readFieldLocal(fvs, PROVENIENZA_FIELD_ID);
    if (hasProvenienza(firstFieldValues)) return firstFieldValues;

    let current = firstFieldValues;
    for (let attempt = 1; attempt <= 2; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
            const res = await acGet(`/contacts/${contactId}/fieldValues`);
            current = res.fieldValues || current;
            if (hasProvenienza(current)) return current;
        } catch {
            // network hiccup: tengo il valore precedente e ritento
        }
    }
    return current;
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
        companyId: SERENAMENTE_COMPANY,
    });
    await notifyManagersIfNeeded();
}

async function notifyManagersIfNeeded() {
    try {
        const managers = await db.select({ id: users.id }).from(users)
            .where(and(
                eq(users.companyId, SERENAMENTE_COMPANY),
                sql`${users.role} IN ('MANAGER', 'ADMIN')`,
            ));
        if (managers.length === 0) return;

        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        for (const m of managers) {
            const [recent] = await db.select({ id: notifications.id }).from(notifications)
                .where(and(
                    eq(notifications.companyId, SERENAMENTE_COMPANY),
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
                companyId: SERENAMENTE_COMPANY,
            });
        }
    } catch (e) {
        console.error('[serenamente] notifyManagersIfNeeded error:', e);
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
        const eventType = rawPayload['type'] || rawPayload['event'] || 'subscribe';
        if (!contactId) {
            await recordFailure({ reason: 'Payload senza contact id', payload: rawPayload });
            return NextResponse.json({ error: 'missing contact id' }, { status: 400 });
        }

        const triggerListId = rawPayload['list'] || rawPayload['list[id]'] || null;
        if (triggerListId) {
            const blocked = await getBlockedListIds();
            if (blocked.has(String(triggerListId))) {
                console.log(`[AC webhook serenamente] skip contact ${contactId} — lista bloccata (payload) ${triggerListId}`);
                return NextResponse.json({
                    skipped: 'blocked_list',
                    listId: String(triggerListId),
                    acContactId: contactId,
                    via: 'payload',
                });
            }
        }

        {
            const membership = await isContactInBlockedList(contactId);
            if (membership.blocked) {
                console.log(`[AC webhook serenamente] skip contact ${contactId} — lista bloccata (membership) ${membership.listId}`);
                return NextResponse.json({
                    skipped: 'blocked_list',
                    listId: membership.listId,
                    acContactId: contactId,
                    via: 'membership',
                });
            }
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
        let provenienza = (readFieldLocal(fieldValues, PROVENIENZA_FIELD_ID) || '').trim();

        // ===== EVENTO UPDATE =====
        if (eventType === 'update') {
            const [existing] = await db.select().from(leads)
                .where(and(eq(leads.companyId, SERENAMENTE_COMPANY), eq(leads.acContactId, contactId)))
                .limit(1);
            if (!existing) {
                return NextResponse.json({ skipped: 'update for unknown contact', acContactId: contactId });
            }

            const utmSource = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmSource);
            const utmMedium = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmMedium);
            const utmCampaign = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmCampaign);
            const utmContent = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmContent);
            const utmTerm = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmTerm);

            const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
            const changes: string[] = [];

            if (provenienza && existing.funnel === DEFAULT_FUNNEL) {
                updatePayload.funnel = provenienza.toUpperCase();
                changes.push(`funnel → ${provenienza.toUpperCase()}`);
            }
            if (utmSource && !existing.utmSource) { updatePayload.utmSource = utmSource; changes.push('utmSource'); }
            if (utmMedium && !existing.utmMedium) { updatePayload.utmMedium = utmMedium; changes.push('utmMedium'); }
            if (utmCampaign && !existing.utmCampaign) { updatePayload.utmCampaign = utmCampaign; changes.push('utmCampaign'); }
            if (utmContent && !existing.utmContent) { updatePayload.utmContent = utmContent; changes.push('utmContent'); }
            if (utmTerm && !existing.utmTerm) { updatePayload.utmTerm = utmTerm; changes.push('utmTerm'); }

            if (changes.length === 0) {
                return NextResponse.json({ skipped: 'no updatable fields', acContactId: contactId });
            }

            updatePayload.version = existing.version + 1;
            const updated = await db.update(leads)
                .set(updatePayload)
                .where(and(
                    eq(leads.companyId, SERENAMENTE_COMPANY),
                    eq(leads.id, existing.id),
                    eq(leads.version, existing.version),
                ))
                .returning({ id: leads.id });

            if (updated.length === 0) {
                return NextResponse.json(
                    { skipped: 'concurrency_conflict', acContactId: contactId, leadId: existing.id },
                    { status: 409 },
                );
            }

            await logLeadEvent({
                leadId: existing.id,
                eventType: 'AC_UPDATED',
                metadata: { source: 'activecampaign_update', acContactId: contactId, changes },
                companyId: SERENAMENTE_COMPANY,
            });
            return NextResponse.json({ success: true, updatedLeadId: existing.id, changes });
        }

        // ===== EVENTO SUBSCRIBE (default) =====

        if (!provenienza) {
            fieldValues = await fetchFieldValuesWithProvenienzaRetry(contactId, fieldValues);
            provenienza = (readFieldLocal(fieldValues, PROVENIENZA_FIELD_ID) || '').trim();
        }

        if (provenienza && QUARANTINED_FUNNELS.has(provenienza.toUpperCase())) {
            console.log(`[AC webhook serenamente] skip contact ${contactId} — funnel '${provenienza}' in quarantena`);
            return NextResponse.json({
                skipped: 'quarantined_funnel',
                funnel: provenienza.toUpperCase(),
                acContactId: contactId,
            });
        }

        const utmSource = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmSource);
        const utmMedium = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmMedium);
        const utmCampaign = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmCampaign);
        const utmContent = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmContent);
        const utmTerm = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmTerm);

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
        const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone);
        const phoneFinal = phoneFinalNormalized?.startsWith('+39')
            ? phoneFinalNormalized.slice(3)
            : phoneFinalNormalized;
        if (!phoneFinal) {
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
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome';
        const newLeadId = crypto.randomUUID();
        const now = new Date();
        const dedupCutoff = new Date(now.getTime() - 10 * 60 * 1000);

        const txResult = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${phoneFinal}, 0))`);
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contactId}, 1))`);

            // Dedup scoped al tenant Serenamente
            const [existing] = await tx.select({
                id: leads.id,
                assignedToId: leads.assignedToId,
            }).from(leads).where(and(
                eq(leads.companyId, SERENAMENTE_COMPANY),
                gte(leads.createdAt, dedupCutoff),
                sql`(${leads.acContactId} = ${contactId} OR ${leads.phone} = ${phoneFinal})`,
            )).orderBy(desc(leads.createdAt)).limit(1);

            if (existing) {
                return { kind: 'duplicate' as const, existingLeadId: existing.id };
            }

            // Round-robin GDO Serenamente
            const eligible = await tx.select({
                id: users.id,
            }).from(users).where(and(
                eq(users.companyId, SERENAMENTE_COMPANY),
                eq(users.role, 'GDO'),
                eq(users.isActive, true),
                eq(users.acAutoIntake, true),
            )).orderBy(asc(sql`coalesce(${users.acLastAssignedAt}, 'epoch'::timestamptz)`), asc(users.id));

            if (eligible.length === 0) {
                return { kind: 'no_gdo' as const };
            }
            const assignedGdoId = eligible[0].id;

            await tx.insert(leads).values({
                id: newLeadId,
                name: fullName,
                phone: phoneFinal,
                email,
                funnel,
                source: 'activecampaign',
                acContactId: contactId,
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
                companyId: SERENAMENTE_COMPANY,
            });

            await tx.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, assignedGdoId));

            return { kind: 'created' as const, assignedGdoId };
        });

        if (txResult.kind === 'duplicate') {
            return NextResponse.json({
                skipped: 'duplicate_within_dedup_window',
                acContactId: contactId,
                existingLeadId: txResult.existingLeadId,
            });
        }

        if (txResult.kind === 'no_gdo') {
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

        const assignedGdoId = txResult.assignedGdoId;

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
            companyId: SERENAMENTE_COMPANY,
        });
        await logLeadEvent({
            leadId: newLeadId,
            eventType: 'ASSIGNED',
            metadata: { assignedToUser: assignedGdoId, source: 'activecampaign' },
            companyId: SERENAMENTE_COMPANY,
        });

        const warningSuffix = phoneSuspicious ? ' ⚠️ verifica il numero' : '';
        await db.insert(notifications).values({
            id: crypto.randomUUID(),
            recipientUserId: assignedGdoId,
            type: 'ac_lead_assigned',
            title: '🔥 Nuovo lead caldo!',
            body: `${fullName} · ${funnel} · ${phoneFinal}${warningSuffix} — chiama ora!`,
            metadata: {
                leadId: newLeadId,
                acContactId: contactId,
                funnel,
                name: fullName,
                phone: phoneFinal,
                email,
                phoneSuspicious,
            },
            companyId: SERENAMENTE_COMPANY,
        });

        return NextResponse.json({
            success: true,
            leadId: newLeadId,
            funnel,
            funnelFallback: !provenienza,
            phoneSuspicious,
            assignedTo: assignedGdoId,
        });
    } catch (e) {
        console.error('[AC webhook serenamente] error:', e);
        const msg = e instanceof Error ? e.message : String(e);
        try {
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
