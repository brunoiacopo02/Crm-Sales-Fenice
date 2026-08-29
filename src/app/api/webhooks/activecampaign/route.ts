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

import { after, NextRequest, NextResponse } from "next/server";
import { pushLeadToBot } from "@/lib/bot-fissatore/push";
import { isBotHolidayWindow } from "@/lib/bot-fissatore/holidayWindow";
import { getLeadRouting, BOT_DAILY_MIN, type LeadRouting } from "@/lib/bot-fissatore/leadRouting";
import { db } from "@/db";
import { leads, users, acIntakeFailures, notifications } from "@/db/schema";
import { eq, and, asc, sql, isNull, gte, desc, or, like } from "drizzle-orm";
import crypto from "crypto";
import { logLeadEvent } from "@/lib/eventLogger";
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize";

const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com';
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || '';
const WEBHOOK_SECRET = process.env.ACTIVECAMPAIGN_WEBHOOK_SECRET || '';
const PROVENIENZA_FIELD_ID = '2';
const DEFAULT_FUNNEL = 'SCONOSCIUTO';

// Tenant fisso per QUESTO endpoint: tutti i lead arrivati qui sono di Fenice.
// L'AC account è feniceacademy0089903 → ogni subscribe genera un lead Fenice.
// Per Serenamente esisterà un endpoint separato (/serenamente) con secret e
// AC account distinti e companyId='serenamente' hardcoded. Vedi design doc §11.
const FENICE_COMPANY = 'fenice';

// Liste AC da NON importare nel CRM (es. campagne di raccolta lead per
// lanci futuri: i lead devono restare in AC finché non decidiamo di
// contattarli). Override via env ACTIVECAMPAIGN_BLOCKED_LIST_NAMES
// (comma-separated). Match normalizzato: trim + lowercase, così
// tolleriamo differenze di maiuscole/spazi tra UI AC e config.
const BLOCKED_LIST_NAMES_NORMALIZED = new Set(
    (process.env.ACTIVECAMPAIGN_BLOCKED_LIST_NAMES || 'Lead Lancio Video Editor 2026,Lead Lancio Black Summer 2026')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
);

// "Quarantena funnel": blocca l'ingresso automatico da AC di lead con
// questa provenienza, anche se non sono in una lista esplicitamente
// bloccata. Difesa aggiuntiva per evitare che lead di lancio sfuggano
// (es. perché qualche automazione sovrascrive la lista). Gli import
// manuali dalla UI /import non passano da questo webhook, quindi il
// manager può sempre caricare manualmente i lead. Override via env
// ACTIVECAMPAIGN_QUARANTINED_FUNNELS (comma-separated). Match
// case-insensitive su provenienza normalizzata uppercase.
const QUARANTINED_FUNNELS = new Set(
    (process.env.ACTIVECAMPAIGN_QUARANTINED_FUNNELS || 'ORG')
        .split(',')
        .map((s) => s.trim().toUpperCase())
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

// Cache in-memory degli ID delle liste bloccate. Si ripopola da AC ogni
// 10 min per tollerare rinomine/aggiunte senza redeploy. Pagina fino a
// 500 liste (5 pagine da 100) per sicurezza.
let blockedListIdsCache: { ids: Set<string>; expires: number } | null = null;
async function getBlockedListIds(): Promise<Set<string>> {
    if (BLOCKED_LIST_NAMES_NORMALIZED.size === 0) return new Set();
    const now = Date.now();
    if (blockedListIdsCache && blockedListIdsCache.expires > now) {
        return blockedListIdsCache.ids;
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
        console.log(`[AC webhook] getBlockedListIds: ${ids.size} blocked list(s) found — ids=${Array.from(ids).join(',')}`);
    } catch (e) {
        console.error('[AC webhook] getBlockedListIds error:', e);
    }
    blockedListIdsCache = { ids, expires: now + 10 * 60 * 1000 };
    return ids;
}

/**
 * Verifica via AC API se un contatto è iscritto ad almeno una delle
 * liste bloccate. Usato come fallback quando il payload del webhook
 * non include il campo `list` (alcune configurazioni AC non lo
 * mandano). Stato 1 = iscrizione attiva.
 */
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
        console.error(`[AC webhook] isContactInBlockedList error for contact ${contactId}:`, e);
    }
    return { blocked: false, listId: null };
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
        companyId: FENICE_COMPANY,
    });
    await notifyManagersIfNeeded();
}

/**
 * Registra lo skip da lista bloccata in acIntakeFailures con DEDUP:
 * eventi AC ripetuti (subscribe/update) sullo stesso contatto bloccato NON
 * devono accumulare righe (incidente Disk IO da write-storm). Se esiste già
 * una riga blocked_list NON risolta per lo stesso acContactId, aggiorniamo
 * solo il payload dell'esistente invece di inserirne una nuova.
 */
async function recordBlockedListSkip(contactId: string, listId: string | null, rawPayload: Record<string, string>) {
    const [existing] = await db.select({ id: acIntakeFailures.id }).from(acIntakeFailures)
        .where(and(
            eq(acIntakeFailures.companyId, FENICE_COMPANY),
            eq(acIntakeFailures.acContactId, contactId),
            isNull(acIntakeFailures.resolvedAt),
            like(acIntakeFailures.reason, 'blocked_list:%'),
        )).limit(1);
    if (existing) {
        await db.update(acIntakeFailures)
            .set({ payload: rawPayload })
            .where(eq(acIntakeFailures.id, existing.id));
        return;
    }
    await recordFailure({
        reason: `blocked_list:${listId ?? ''}`,
        acContactId: contactId,
        email: rawPayload['contact[email]'] || rawPayload['contact.email'] || null,
        phoneRaw: rawPayload['contact[phone]'] || rawPayload['contact.phone'] || null,
        payload: rawPayload,
    });
}

/**
 * Notifica ai manager: UNA sola notifica ogni 10 minuti di inattività,
 * non una per ogni failure. Messaggio link-style che invita ad aprire la
 * sezione "Lead non importati".
 */
async function notifyManagersIfNeeded() {
    try {
        const managers = await db.select({ id: users.id }).from(users)
            .where(and(
                eq(users.companyId, FENICE_COMPANY),
                sql`${users.role} IN ('MANAGER', 'ADMIN')`,
            ));
        if (managers.length === 0) return;

        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        for (const m of managers) {
            const [recent] = await db.select({ id: notifications.id }).from(notifications)
                .where(and(
                    eq(notifications.companyId, FENICE_COMPANY),
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
                companyId: FENICE_COMPANY,
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
        //
        // Strategia a 2 livelli:
        // 1. Prima fastpath: se il payload include `list` e matcha una
        //    lista bloccata, skippa subito senza chiamate extra.
        // 2. Fallback: interroga /contacts/{id}/contactLists. Necessario
        //    perché alcune configurazioni AC (o trigger indiretti tipo
        //    automazione che aggiunge il contatto alla lista) NON
        //    includono `list` nel payload webhook — si era visto su 2
        //    lead della lista 'Lead Lancio Video Editor 2026' passati
        //    al CRM il 2026-04-24 nonostante il filtro.
        const triggerListId = rawPayload['list'] || rawPayload['list[id]'] || null;
        if (triggerListId) {
            const blocked = await getBlockedListIds();
            if (blocked.has(String(triggerListId))) {
                console.log(`[AC webhook] skip contact ${contactId} — lista bloccata (payload) ${triggerListId}`);
                // Tracciato in acIntakeFailures (reason 'blocked_list:<id>') così l'admin
                // lo vede in /lead-automatici invece che sparire in silenzio. Escluso da
                // "Riprova tutti" (rifinirebbe bloccato in loop): recuperabile solo col
                // retry singolo, per quando la lista viene sbloccata. Con dedup: eventi
                // ripetuti sullo stesso contatto non accumulano righe.
                await recordBlockedListSkip(contactId, String(triggerListId), rawPayload);
                return NextResponse.json({
                    skipped: 'blocked_list',
                    listId: String(triggerListId),
                    acContactId: contactId,
                    via: 'payload',
                });
            }
        }

        // Fallback membership check (run sempre, sia con che senza triggerListId,
        // perché il trigger potrebbe essere una lista non bloccata ma il
        // contatto potrebbe essere ANCHE in una bloccata).
        {
            const membership = await isContactInBlockedList(contactId);
            if (membership.blocked) {
                console.log(`[AC webhook] skip contact ${contactId} — lista bloccata (membership) ${membership.listId}`);
                await recordBlockedListSkip(contactId, membership.listId, rawPayload);
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
        // Se il contatto esiste già nel CRM (importato precedentemente da AC),
        // lo ritroviamo via acContactId e aggiorniamo funnel/UTM se cambiati.
        // Questo gestisce il caso: Provenienza settata DOPO il subscribe.
        if (eventType === 'update') {
            const [existing] = await db.select().from(leads)
                .where(and(eq(leads.companyId, FENICE_COMPANY), eq(leads.acContactId, contactId)))
                .limit(1);
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

            // Optimistic concurrency: il webhook AC non deve sovrascrivere edit
            // contemporanei del manager/GDO sul funnel/UTM. Se la version è
            // cambiata tra la SELECT e l'UPDATE, restituiamo 409 (AC potrà
            // ritentare, oppure il lead arrivato a mano resta autoritativo).
            updatePayload.version = existing.version + 1;
            const updated = await db.update(leads)
                .set(updatePayload)
                .where(and(
                    eq(leads.companyId, FENICE_COMPANY),
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
                companyId: FENICE_COMPANY,
            });
            return NextResponse.json({ success: true, updatedLeadId: existing.id, changes });
        }

        // ===== EVENTO SUBSCRIBE (default) =====

        // Retry sulla Provenienza: AC può creare il contatto + triggerare
        // il webhook PRIMA di aver applicato le automazioni custom field.
        // Aspetto fino a 4 secondi totali che Provenienza compaia.
        if (!provenienza) {
            fieldValues = await fetchFieldValuesWithProvenienzaRetry(contactId, fieldValues);
            provenienza = (readFieldLocal(fieldValues, PROVENIENZA_FIELD_ID) || '').trim();
        }

        // Quarantena funnel: blocca l'ingresso automatico di lead con
        // provenienza in quarantena (es. 'ORG' durante il lancio
        // VideoEditor). Il manager può caricare manualmente via /import,
        // che non passa per questo webhook.
        if (provenienza && QUARANTINED_FUNNELS.has(provenienza.toUpperCase())) {
            console.log(`[AC webhook] skip contact ${contactId} — funnel '${provenienza}' in quarantena`);
            return NextResponse.json({
                skipped: 'quarantined_funnel',
                funnel: provenienza.toUpperCase(),
                acContactId: contactId,
            });
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
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome';
        const newLeadId = crypto.randomUUID();
        const now = new Date();
        const dedupCutoff = new Date(now.getTime() - 10 * 60 * 1000);

        // Giorno solare corrente in Europe/Rome (per la soglia minima dei bot).
        // Lasciamo a Postgres la conversione tz: confronto createdAt >= today 00:00 Rome.
        const todayRome = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(now); // 'YYYY-MM-DD'

        // ===== SEZIONE CRITICA (transazione + advisory lock) =====
        // Dedup + round-robin + insert + update acLastAssignedAt devono
        // essere atomici rispetto ad altri webhook AC che riguardino lo
        // stesso contatto o lo stesso numero. Senza lock succede che
        // due webhook quasi simultanei per lo stesso contactId vedano
        // entrambi "nessun duplicato" e creino due lead assegnati a GDO
        // diversi. Il lock è per-phone (comprende il caso di AC che
        // crea due contact entity distinte con stesso numero) e per
        // contactId.
        const txResult = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${phoneFinal}, 0))`);
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contactId}, 1))`);

            // Dedup: stesso contactId O stesso phone negli ultimi 10 min
            // (scoped al tenant: due aziende possono legittimamente avere lo
            // stesso numero in funnel separati senza essere "duplicati").
            const [existing] = await tx.select({
                id: leads.id,
                assignedToId: leads.assignedToId,
            }).from(leads).where(and(
                eq(leads.companyId, FENICE_COMPANY),
                gte(leads.createdAt, dedupCutoff),
                sql`(${leads.acContactId} = ${contactId} OR ${leads.phone} = ${phoneFinal})`,
            )).orderBy(desc(leads.createdAt)).limit(1);

            if (existing) {
                return { kind: 'duplicate' as const, existingLeadId: existing.id };
            }

            // Guardia cross-azienda: se questo contatto è GIÀ un lead di un'altra
            // azienda (es. Serenamente, gestita via Twilio), NON creare un duplicato
            // Fenice. Evita che i contatti Serenamente finiscano nell'intake Fenice.
            const [crossCompany] = await tx.select({ id: leads.id, companyId: leads.companyId })
                .from(leads)
                .where(and(
                    sql`${leads.companyId} <> ${FENICE_COMPANY}`,
                    or(eq(leads.phone, phoneFinal), email ? eq(leads.email, email) : sql`false`),
                ))
                .limit(1);
            if (crossCompany) {
                return { kind: 'cross_company_skip' as const, otherCompany: crossCompany.companyId };
            }

            // Telefono inventato (000, 3, 0000000000): il lead entra, ma non va
            // a nessuno. Bruciare il tempo di un GDO su un numero che non esiste
            // è un costo certo; scartarlo automaticamente sarebbe più pulito nei
            // numeri ma perderebbe un lead pagato ogni volta che isPlausiblePhone
            // sbaglia — e sbaglia, per esempio sui formati esteri. Resta in una
            // lista admin su /lead-automatici, da bonificare a mano.
            // assignedAt resta null di proposito: il lead NON è entrato in circolo.
            if (phoneSuspicious) {
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
                    phoneSuspicious: true,
                    status: 'NEW',
                    callCount: 0,
                    assignedToId: null,
                    assignedAt: null,
                    createdAt: now,
                    updatedAt: now,
                    companyId: FENICE_COMPANY,
                });
                return { kind: 'quarantined' as const };
            }

            // ===== A chi va questo lead: bot o GDO umani =====
            // La fascia oraria decide (src/lib/bot-fissatore/leadRouting.ts); il
            // round-robin per acLastAssignedAt resta il criterio DENTRO ogni pool,
            // così i turni non si sfasano quando un pool viene saltato.
            const roundRobinOrder = [
                asc(sql`coalesce(${users.acLastAssignedAt}, 'epoch'::timestamptz)`),
                asc(users.id),
            ] as const;

            // Soglia MINIMA giornaliera del bot: lead che gli sono stati assegnati
            // oggi (giorno solare Europe/Rome). Conta anche quelli presi nelle
            // finestre in cui il bot ha l'esclusiva, che sono il grosso del volume.
            const underDailyMin = sql`(
                SELECT count(*) FROM leads l
                WHERE l."assignedToId" = ${users.id}
                  AND l."companyId" = ${FENICE_COMPANY}
                  AND l."createdAt" >= (${todayRome} || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome'
            ) < ${BOT_DAILY_MIN}`;

            const gdoBase = and(
                eq(users.companyId, FENICE_COMPANY),
                eq(users.role, 'GDO'),
                eq(users.isActive, true),
            );

            const selectPool = (where: ReturnType<typeof and>) => tx.select({
                id: users.id,
                isBot: users.isBot,
            }).from(users).where(where).orderBy(...roundRobinOrder);

            /** Pool storico: umani e bot nello stesso giro, il bot esce a soglia raggiunta. */
            const selectLegacyPool = () => selectPool(and(
                gdoBase,
                eq(users.acAutoIntake, true),
                sql`(${users.isBot} = false OR ${underDailyMin})`,
            ));

            /** Solo i GDO umani abilitati all'intake automatico. */
            const selectHumanPool = () => selectPool(and(
                gdoBase,
                eq(users.acAutoIntake, true),
                eq(users.isBot, false),
            ));

            /**
             * Solo il bot. `respectMin` lo esclude quando ha già raggiunto la soglia
             * minima del giorno: serve nelle finestre dei GDO, dove il bot passa
             * avanti solo finché è sotto quota. Nelle finestre del bot non si applica
             * alcun limite (e nemmeno acAutoIntake: la fascia vale di per sé, come
             * per la finestra ferie).
             */
            const selectBotPool = (respectMin: boolean) => selectPool(and(
                gdoBase,
                eq(users.isBot, true),
                respectMin ? underDailyMin : undefined,
            ));

            // La finestra ferie, quando attiva, vince su tutto: nessun umano al lavoro.
            const holidayWindow = isBotHolidayWindow(now);
            const routing: LeadRouting = holidayWindow ? 'bot_only' : getLeadRouting(now);

            // Ogni ramo ha il suo ripiego: una fascia non deve mai poter lasciare
            // un lead senza padrone (bot spento, o tutti i GDO disattivati).
            // `fallbackUsed` marca SOLO i ripieghi anomali: in 'bot_first' passare
            // agli umani a soglia raggiunta è il funzionamento previsto, non un guasto.
            let eligible: { id: string; isBot: boolean }[];
            let fallbackUsed = false;
            if (routing === 'legacy') {
                eligible = await selectLegacyPool();
            } else if (routing === 'gdo_only') {
                // Fascia protetta del sabato: il bot non entra nemmeno se è
                // sotto la soglia minima. Ci finisce solo se non c'è un umano.
                eligible = await selectHumanPool();
                if (eligible.length === 0) { eligible = await selectBotPool(false); fallbackUsed = true; }
            } else if (routing === 'bot_first') {
                eligible = await selectBotPool(true);
                if (eligible.length === 0) eligible = await selectHumanPool();
            } else {
                eligible = await selectBotPool(false);
                if (eligible.length === 0) { eligible = await selectHumanPool(); fallbackUsed = true; }
            }

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
                // Lead da AC: nasce già in carico, ingresso nel funnel = adesso.
                assignedAt: now,
                createdAt: now,
                updatedAt: now,
                companyId: FENICE_COMPANY,
            });

            await tx.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, assignedGdoId));

            return { kind: 'created' as const, assignedGdoId, assignedGdoIsBot: eligible[0].isBot, routing, holidayWindow, fallbackUsed };
        });

        if (txResult.kind === 'duplicate') {
            return NextResponse.json({
                skipped: 'duplicate_within_dedup_window',
                acContactId: contactId,
                existingLeadId: txResult.existingLeadId,
            });
        }

        if (txResult.kind === 'cross_company_skip') {
            return NextResponse.json({
                skipped: 'cross_company_contact',
                otherCompany: txResult.otherCompany,
                acContactId: contactId,
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

        if (txResult.kind === 'quarantined') {
            // Niente push al bot: una chat WhatsApp su 0000000000 non esiste.
            // Niente evento ASSIGNED e niente notifica: non è di nessuno.
            await logLeadEvent({
                leadId: newLeadId,
                eventType: 'IMPORTED',
                // Nessun `toSection`: 'Quarantena telefono' non è una SectionName
                // valida (il tipo in eventLogger.ts elenca solo le sezioni della
                // board GDO) e questo lead non sta in nessuna board — non è di
                // nessuno. La destinazione sta in metadata.
                metadata: {
                    source: 'activecampaign',
                    acContactId: contactId,
                    provenienza: provenienza || null,
                    phoneSuspicious: true,
                    phoneRaw: rawPhone,
                    quarantined: true,
                    section: 'Quarantena telefono',
                },
                companyId: FENICE_COMPANY,
            });
            return NextResponse.json({
                success: true,
                leadId: newLeadId,
                funnel,
                phoneSuspicious: true,
                quarantined: true,
                assignedTo: null,
            });
        }

        const assignedGdoId = txResult.assignedGdoId;

        if (txResult.kind === 'created' && txResult.assignedGdoIsBot) {
            after(() => pushLeadToBot({
                leadId: newLeadId,
                name: fullName,
                phone: phoneFinal,
                email,
                funnel,
                companyId: FENICE_COMPANY,
            }));
        }

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
            companyId: FENICE_COMPANY,
        });
        await logLeadEvent({
            leadId: newLeadId,
            eventType: 'ASSIGNED',
            metadata: {
                assignedToUser: assignedGdoId,
                source: 'activecampaign',
                // Traccia della regola applicata: fra due mesi, guardando i volumi,
                // la spiegazione sta nel DB e non nella memoria di qualcuno.
                routing: txResult.routing,
                ...(txResult.fallbackUsed ? { routingFallback: true } : {}),
                ...(txResult.holidayWindow ? { botHolidayWindow: true } : {}),
            },
            companyId: FENICE_COMPANY,
        });

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
            companyId: FENICE_COMPANY,
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
