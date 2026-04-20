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
import { eq, and, asc, sql, isNull, gte, desc } from "drizzle-orm";
import crypto from "crypto";
import { logLeadEvent } from "@/lib/eventLogger";
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize";

const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com';
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || '';
const WEBHOOK_SECRET = process.env.ACTIVECAMPAIGN_WEBHOOK_SECRET || '';
const PROVENIENZA_FIELD_ID = '2';
const DEFAULT_FUNNEL = 'SCONOSCIUTO';

// Liste AC da NON importare nel CRM (es. campagne di raccolta lead per
// lanci futuri: i lead devono restare in AC finché non decidiamo di
// contattarli). Override via env ACTIVECAMPAIGN_BLOCKED_LIST_NAMES
// (comma-separated). Match per nome esatto, trim, case-sensitive.
const BLOCKED_LIST_NAMES = new Set(
    (process.env.ACTIVECAMPAIGN_BLOCKED_LIST_NAMES || 'Lead Lancio Video Editor 2026')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);

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

// Cache in-memory degli ID delle liste bloccate. Si ripopola da AC ogni
// 10 min per tollerare rinomine/aggiunte senza redeploy.
let blockedListIdsCache: { ids: Set<string>; expires: number } | null = null;
async function getBlockedListIds(): Promise<Set<string>> {
    if (BLOCKED_LIST_NAMES.size === 0) return new Set();
    const now = Date.now();
    if (blockedListIdsCache && blockedListIdsCache.expires > now) {
        return blockedListIdsCache.ids;
    }
    const ids = new Set<string>();
    try {
        const res = await acGet('/lists?limit=100');
        const lists = Array.isArray(res.lists) ? res.lists : [];
        for (const l of lists) {
            const name = String(l?.name ?? '').trim();
            if (name && BLOCKED_LIST_NAMES.has(name) && l?.id != null) {
                ids.add(String(l.id));
            }
        }
    } catch (e) {
        console.error('[AC webhook] getBlockedListIds error:', e);
    }
    blockedListIdsCache = { ids, expires: now + 10 * 60 * 1000 };
    return ids;
}

function readFieldLocal(fieldValues: Array<{ field: string; value: string | null }>, fieldId: string): string | null {
    const v = fieldValues.find((f) => String(f.field) === fieldId)?.value;
    return v && String(v).trim() ? String(v).trim() : null;
}

/**
 * Rilegge i fieldValues del contatto AC finché la Provenienza non è
 * valorizzata, per tollerare il caso in cui AC crea il contatto (e
 * triggera il subscribe webhook) prima di aver applicato le automazioni
 * che settano i custom field. Max 3 tentativi × 2 secondi di attesa
 * totale tra il primo e l'ultimo.
 */
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
        const eventType = rawPayload['type'] || rawPayload['event'] || 'subscribe';
        if (!contactId) {
            await recordFailure({ reason: 'Payload senza contact id', payload: rawPayload });
            return NextResponse.json({ error: 'missing contact id' }, { status: 400 });
        }

        // Lista sorgente del subscribe: se corrisponde a una lista
        // bloccata (es. campagna lancio futuro) skippiamo senza creare
        // lead né failure record. Non è un errore: è intenzionale.
        const triggerListId = rawPayload['list'] || rawPayload['list[id]'] || null;
        if (triggerListId) {
            const blocked = await getBlockedListIds();
            if (blocked.has(String(triggerListId))) {
                console.log(`[AC webhook] skip contact ${contactId} - lista bloccata ${triggerListId}`);
                return NextResponse.json({
                    skipped: 'blocked_list',
                    listId: String(triggerListId),
                    acContactId: contactId,
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
        // Se il contatto esiste già nel CRM (importato precedentemente da AC),
        // lo ritroviamo via acContactId e aggiorniamo funnel/UTM se cambiati.
        // Questo gestisce il caso: Provenienza settata DOPO il subscribe.
        if (eventType === 'update') {
            const [existing] = await db.select().from(leads).where(eq(leads.acContactId, contactId)).limit(1);
            if (!existing) {
                // Non conosciamo questo contatto: potrebbe essere stato creato fuori dal nostro flow, ignoriamo.
                return NextResponse.json({ skipped: 'update for unknown contact', acContactId: contactId });
            }

            const utmSource = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmSource);
            const utmMedium = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmMedium);
            const utmCampaign = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmCampaign);
            const utmContent = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmContent);
            const utmTerm = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmTerm);

            const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
            const changes: string[] = [];

            // Aggiorno il funnel SOLO se il CRM ha 'SCONOSCIUTO' e ora AC ha un valore reale.
            // Non sovrascrivo un funnel già valido (il manager potrebbe averlo editato).
            if (provenienza && existing.funnel === DEFAULT_FUNNEL) {
                updatePayload.funnel = provenienza.toUpperCase();
                changes.push(`funnel → ${provenienza.toUpperCase()}`);
            }
            // UTM: popolo solo i campi ancora vuoti nel CRM
            if (utmSource && !existing.utmSource) { updatePayload.utmSource = utmSource; changes.push('utmSource'); }
            if (utmMedium && !existing.utmMedium) { updatePayload.utmMedium = utmMedium; changes.push('utmMedium'); }
            if (utmCampaign && !existing.utmCampaign) { updatePayload.utmCampaign = utmCampaign; changes.push('utmCampaign'); }
            if (utmContent && !existing.utmContent) { updatePayload.utmContent = utmContent; changes.push('utmContent'); }
            if (utmTerm && !existing.utmTerm) { updatePayload.utmTerm = utmTerm; changes.push('utmTerm'); }

            if (changes.length === 0) {
                return NextResponse.json({ skipped: 'no updatable fields', acContactId: contactId });
            }

            await db.update(leads).set(updatePayload).where(eq(leads.id, existing.id));
            await logLeadEvent({
                leadId: existing.id,
                eventType: 'AC_UPDATED',
                metadata: { source: 'activecampaign_update', acContactId: contactId, changes },
            });
            return NextResponse.json({ success: true, updatedLeadId: existing.id, changes });
        }

        // ===== EVENTO SUBSCRIBE (default) =====
        // Dedup: AC può spedire più eventi subscribe ravvicinati per lo
        // stesso contatto (es. iscrizione a più liste, retry). Se esiste
        // già un lead con lo stesso acContactId creato negli ultimi 10
        // minuti, NON creiamo un duplicato. Dopo 10 min consideriamo
        // un'eventuale re-iscrizione come caso legittimo.
        const dedupCutoff = new Date(Date.now() - 10 * 60 * 1000);
        const [existingRecent] = await db.select({
            id: leads.id,
            createdAt: leads.createdAt,
            funnel: leads.funnel,
        }).from(leads).where(and(
            eq(leads.acContactId, contactId),
            gte(leads.createdAt, dedupCutoff),
        )).orderBy(desc(leads.createdAt)).limit(1);

        if (existingRecent) {
            return NextResponse.json({
                skipped: 'duplicate_within_dedup_window',
                acContactId: contactId,
                existingLeadId: existingRecent.id,
            });
        }

        // Retry sulla Provenienza: AC può creare il contatto + triggerare
        // il webhook PRIMA di aver applicato le automazioni custom field.
        // Aspetto fino a 4 secondi totali che Provenienza compaia.
        if (!provenienza) {
            fieldValues = await fetchFieldValuesWithProvenienzaRetry(contactId, fieldValues);
            provenienza = (readFieldLocal(fieldValues, PROVENIENZA_FIELD_ID) || '').trim();
        }

        // UTM (custom field 31-35). Salvati per uso marketing futuro, non mostrati in UI.
        const utmSource = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmSource);
        const utmMedium = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmMedium);
        const utmCampaign = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmCampaign);
        const utmContent = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmContent);
        const utmTerm = readFieldLocal(fieldValues, UTM_FIELD_IDS.utmTerm);

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
        const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone);
        // I lead importati da AC vanno salvati SENZA prefisso +39 (formato
        // "locale" italiano). Se il numero inizia con +39 tolgo il prefisso,
        // altrimenti (estero, senza prefisso, ecc.) lascio così com'è.
        const phoneFinal = phoneFinalNormalized?.startsWith('+39')
            ? phoneFinalNormalized.slice(3)
            : phoneFinalNormalized;
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

        // Notifica al GDO: lead caldo appena arrivato, chiamalo subito.
        // Si aggancia al sistema notifications → useRealtimeNotifications
        // le porta in UI live via Supabase realtime.
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
