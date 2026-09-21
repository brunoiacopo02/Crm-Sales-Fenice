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
import { getLeadRouting, finestraRientro, BOT_DAILY_MIN, type LeadRouting } from "@/lib/bot-fissatore/leadRouting";
import { numeroBotPerNuovoLead } from "@/lib/bot-fissatore/numeroBot";

/**
 * Quanti lead sono gia' andati a bot 2 oggi (giorno civile di Roma).
 *
 * Si contano gli EVENTI di push, non un contatore a parte: un contatore si
 * sfasa al primo riavvio e mente proprio nel momento in cui serve. Se la query
 * non riesce torna -1, che `numeroBotPerNuovoLead` legge come "non lo so" e
 * fa ricadere il lead sul numero storico.
 */
async function contaBot2Oggi(): Promise<number> {
    try {
        const [riga] = await db.select({ n: sql<number>`COUNT(*)::int` })
            .from(leadEvents)
            .where(and(
                eq(leadEvents.companyId, FENICE_COMPANY),
                eq(leadEvents.eventType, 'BOT_PUSHED'),
                sql`${leadEvents.metadata}->>'numeroBot' = '2'`,
                sql`${leadEvents.timestamp} >= date_trunc('day', now() AT TIME ZONE 'Europe/Rome')`,
            ));
        return riga?.n ?? -1;
    } catch (e) {
        console.error('[numeroBot] conteggio di bot 2 non riuscito: il lead va al numero storico', e);
        return -1;
    }
}
import {
    isLancioIntakeEnabled, decideLancioIntake, buildLancioLeadRow, buildLancioIntakeEventRows,
    lancioPayloadField, LANCIO_LIST_NAME_NORMALIZED, LANCIO_BUCKET, LANCIO_FUNNEL, type LancioDecision,
} from "@/lib/lancio/intake";
import { db } from "@/db";
import { leads, leadEvents, users, acIntakeFailures, notifications } from "@/db/schema";
import { eq, and, asc, sql, isNull, gte, desc, or, like } from "drizzle-orm";
import crypto from "crypto";
import { logLeadEvent } from "@/lib/eventLogger";
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from "@/lib/phoneNormalize";
import { leggiBurstConfig, decidiBurst } from "@/lib/acIntake/burstGuard";
// UTM: id dei custom field e lettura, condivisi col sync di recupero del lancio
// (src/lib/acIntake/utmFields.ts). Prima vivevano qui e il sync non poteva riusarli.
import { UTM_FIELD_IDS, readFieldLocal, readUtmFields } from "@/lib/acIntake/utmFields";
// Pipeline autonoma del venditore: dirotta i primi N lead freschi. Tocca SOLO
// l'intake normale qui sotto, mai il ramo del lancio (handleLancioIntake).
import { decideDiversion } from "@/lib/salesPipeline/feeding";
import { readSalesPipelineConfig } from "@/app/actions/salesPipelineConfigActions";

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
//
// "Lista Pre lancio 2026" è qui dal 15/09/2026: è una lista di raccolta da
// DATABASE, e un'automazione AC l'ha riversata nel CRM a ~140 lead/minuto.
// Prima che la bloccassimo erano entrati 7.955 lead, 7.882 dei quali pushati
// al bot: il numero WhatsApp è passato da 75-80% di messaggi letti a 54,9% e
// da <1% di falliti a 5,5%, con la qualità Meta scesa a LOW, e il Supabase del
// bot è andato in saturazione. Il blocco viveva solo nella env di produzione:
// toglierla riaprirebbe il rubinetto, quindi sta anche qui.
const BLOCKED_LIST_NAMES_NORMALIZED = new Set(
    (process.env.ACTIVECAMPAIGN_BLOCKED_LIST_NAMES || 'Lead Lancio Video Editor 2026,Lead Lancio Black Summer 2026,Lancio Web Developer AI,Lista Pre lancio 2026')
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

// Cache in-memory nome-normalizzato → id di TUTTE le liste AC. Si ripopola
// da AC ogni 10 min per tollerare rinomine/aggiunte senza redeploy. Pagina
// fino a 500 liste (5 pagine da 100). Serve sia alle liste bloccate sia alla
// lista del lancio: una sola chiamata AC per entrambe.
//
// Il valore e' un SET di id e non un id solo: su AC possono esistere due liste
// con lo stesso nome (campagna ricreata). Tenendone una sola, il contatto
// iscritto al doppione sfuggirebbe al blocco — che e' esattamente quello che
// le liste bloccate devono impedire.
const LIST_CACHE_TTL_MS = 10 * 60 * 1000;
/** Su errore la cache vale poco: 10 minuti di mappa vuota = 10 minuti di liste sbloccate. */
const LIST_CACHE_ERROR_TTL_MS = 30 * 1000;
let listIdsByNameCache: { byName: Map<string, Set<string>>; expires: number } | null = null;
async function getListIdsByName(): Promise<Map<string, Set<string>>> {
    const now = Date.now();
    if (listIdsByNameCache && listIdsByNameCache.expires > now) {
        return listIdsByNameCache.byName;
    }
    const byName = new Map<string, Set<string>>();
    let errore = false;
    try {
        for (let offset = 0; offset < 500; offset += 100) {
            const res = await acGet(`/lists?limit=100&offset=${offset}`);
            const lists = Array.isArray(res.lists) ? res.lists : [];
            if (lists.length === 0) break;
            for (const l of lists) {
                const nameNorm = String(l?.name ?? '').trim().toLowerCase();
                if (!nameNorm || l?.id == null) continue;
                const ids = byName.get(nameNorm) ?? new Set<string>();
                ids.add(String(l.id));
                byName.set(nameNorm, ids);
            }
            if (lists.length < 100) break;
        }
    } catch (e) {
        errore = true;
        console.error('[AC webhook] getListIdsByName error (cache tenuta 30s, non 10 min):', e);
    }
    // 200 con zero liste non è una risposta buona: un account AC che ha liste
    // bloccate da risolvere ne ha almeno una. Mapparlo a "nessuna lista" per 10
    // minuti vorrebbe dire 10 minuti di liste bloccate sbloccate (e di lancio
    // non riconosciuto). Vale come errore: TTL 30 s e si riprova.
    if (!errore && byName.size === 0 && BLOCKED_LIST_NAMES_NORMALIZED.size > 0) {
        errore = true;
        console.error('[AC webhook] getListIdsByName: /lists ha risposto senza nessuna lista — cache tenuta 30s, non 10 min');
    }
    listIdsByNameCache = { byName, expires: now + (errore ? LIST_CACHE_ERROR_TTL_MS : LIST_CACHE_TTL_MS) };
    // Log SOLO al refresh della cache (una volta ogni 10 min), non a ogni
    // webhook: e' la riga che serviva a capire quali liste risultano bloccate,
    // e la risoluzione dei nomi ora avviene qui.
    const blockedIds = Array.from(BLOCKED_LIST_NAMES_NORMALIZED).flatMap((n) => Array.from(byName.get(n) ?? []));
    const lancioIds = Array.from(byName.get(LANCIO_LIST_NAME_NORMALIZED) ?? []);
    const riga = `[AC webhook] liste AC in cache: ${byName.size} — bloccate: ${blockedIds.join(',')} — lancio: ${lancioIds.join(',') || '-'}`;
    if (errore) console.error(`${riga} (INCOMPLETA: /lists ha fallito)`);
    else console.log(riga);
    return byName;
}

/**
 * Liste bloccate per ID NUMERICO, non per nome.
 *
 * Il blocco per nome ha un punto cieco: basta rinominare la lista su AC e non
 * la riconosce più. Dopo il flood del 15/09/2026 il PO ha deciso di lasciare
 * accesa l'automazione che riempie la lista 133 (serve ad altro), quindi il
 * blocco è l'unica cosa che ci separa da quei lead: gli id sono la difesa che
 * sopravvive a una rinomina, e non dipendono dalla chiamata /lists.
 */
const BLOCKED_LIST_IDS = new Set(
    (process.env.ACTIVECAMPAIGN_BLOCKED_LIST_IDS || '133')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);

async function getBlockedListIds(): Promise<Set<string>> {
    // Gli id espliciti valgono sempre, anche se /lists è irraggiungibile.
    const ids = new Set<string>(BLOCKED_LIST_IDS);
    if (BLOCKED_LIST_NAMES_NORMALIZED.size === 0) return ids;
    const byName = await getListIdsByName();
    for (const name of BLOCKED_LIST_NAMES_NORMALIZED) {
        for (const id of byName.get(name) ?? []) ids.add(id);
    }
    return ids;
}

/**
 * Gli id della lista del lancio (per nome normalizzato), o null se su AC non
 * ce n'e' nessuna. Piu' di uno = liste omonime: valgono tutte.
 */
async function getLancioListIds(): Promise<ReadonlySet<string> | null> {
    const byName = await getListIdsByName();
    const ids = byName.get(LANCIO_LIST_NAME_NORMALIZED);
    return ids && ids.size > 0 ? ids : null;
}

/**
 * Le liste a cui il contatto e' iscritto con stato attivo (status '1'), via
 * /contacts/{id}/contactLists. Una chiamata sola, riusata dal ramo lancio e
 * dal ramo liste bloccate. In errore torna un set vuoto (come prima: il
 * contatto passa, non e' bloccato).
 */
async function getContactActiveListIds(contactId: string): Promise<Set<string>> {
    return (await leggiListeContatto(contactId)).ids;
}

/**
 * Come sopra, ma dice anche SE la lettura è riuscita.
 *
 * La differenza conta: in errore l'insieme torna vuoto, e un insieme vuoto è
 * indistinguibile da "il contatto non è in nessuna lista bloccata". Fino al
 * 15/09/2026 quel caso lasciava passare il contatto — cioè, proprio quando AC
 * non risponde, il filtro delle liste bloccate si spegne in silenzio. Con
 * un'automazione che riempie una lista bloccata di continuo, è il momento
 * peggiore per aprire.
 */
async function leggiListeContatto(contactId: string): Promise<{ ids: Set<string>; ok: boolean }> {
    const ids = new Set<string>();
    try {
        const res = await acGet(`/contacts/${contactId}/contactLists`);
        const memberships = Array.isArray(res.contactLists) ? res.contactLists : [];
        for (const m of memberships) {
            const listId = String(m?.list ?? '');
            const status = String(m?.status ?? '');
            if (listId && status === '1') ids.add(listId);
        }
        return { ids, ok: true };
    } catch (e) {
        console.error(`[AC webhook] getContactActiveListIds error for contact ${contactId}:`, e);
        return { ids, ok: false };
    }
}

/** La prima lista bloccata fra le membership attive del contatto, o null. */
function blockedListOf(activeListIds: Set<string>, blocked: Set<string>): string | null {
    for (const id of activeListIds) if (blocked.has(id)) return id;
    return null;
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
 * Registra uno skip in acIntakeFailures con DEDUP: eventi AC ripetuti
 * (subscribe/update) sullo stesso contatto NON devono accumulare righe
 * (incidente Disk IO da write-storm). Se esiste già una riga NON risolta con
 * lo stesso motivo (match su `likeMotivo`) per lo stesso acContactId,
 * aggiorniamo solo il payload dell'esistente invece di inserirne una nuova.
 */
async function recordDedupedSkip(
    contactId: string,
    reason: string,
    likeMotivo: string,
    rawPayload: Record<string, string>,
) {
    const [existing] = await db.select({ id: acIntakeFailures.id }).from(acIntakeFailures)
        .where(and(
            eq(acIntakeFailures.companyId, FENICE_COMPANY),
            eq(acIntakeFailures.acContactId, contactId),
            isNull(acIntakeFailures.resolvedAt),
            like(acIntakeFailures.reason, likeMotivo),
        )).limit(1);
    if (existing) {
        await db.update(acIntakeFailures)
            .set({ payload: rawPayload })
            .where(eq(acIntakeFailures.id, existing.id));
        return;
    }
    await recordFailure({
        reason,
        acContactId: contactId,
        email: rawPayload['contact[email]'] || rawPayload['contact.email'] || null,
        phoneRaw: rawPayload['contact[phone]'] || rawPayload['contact.phone'] || null,
        payload: rawPayload,
    });
}

/** Skip da lista bloccata: reason 'blocked_list:<id>', escluso da "Riprova tutti". */
async function recordBlockedListSkip(contactId: string, listId: string | null, rawPayload: Record<string, string>) {
    await recordDedupedSkip(contactId, `blocked_list:${listId ?? ''}`, 'blocked_list:%', rawPayload);
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

/**
 * L'interruttore di sovraccarico è scattato: lo devono sapere subito.
 *
 * Il 15/09/2026 il flood è andato avanti quasi dodici ore prima che qualcuno se
 * ne accorgesse. Una difesa che ferma i lead senza dirlo a nessuno sposta il
 * problema: i lead si accumulano in /lead-automatici e intanto una campagna
 * vera potrebbe essere ferma. Una notifica ogni 10 minuti, non una per lead.
 */
async function notificaBurstAgliAdmin(conteggio: number, finestraMinuti: number) {
    try {
        const destinatari = await db.select({ id: users.id }).from(users)
            .where(and(
                eq(users.companyId, FENICE_COMPANY),
                sql`${users.role} IN ('MANAGER', 'ADMIN')`,
            ));
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
        for (const m of destinatari) {
            const [recent] = await db.select({ id: notifications.id }).from(notifications)
                .where(and(
                    eq(notifications.companyId, FENICE_COMPANY),
                    eq(notifications.recipientUserId, m.id),
                    eq(notifications.type, 'ac_intake_burst'),
                    gte(notifications.createdAt, tenMinAgo),
                )).limit(1);
            if (recent) continue;

            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: m.id,
                type: 'ac_intake_burst',
                title: 'Ingresso lead bloccato: troppi lead insieme',
                body: `Sono arrivati ${conteggio} lead in ${finestraMinuti} minuti da ActiveCampaign. `
                    + `L'ingresso è sospeso per sicurezza: i lead restano in Lead Automatici. `
                    + `Se è un import previsto, si riapre alzando la soglia.`,
                metadata: { link: '/lead-automatici', conteggio, finestraMinuti },
                companyId: FENICE_COMPANY,
            });
        }
    } catch (e) {
        // Una notifica che non parte non deve far fallire il webhook: il blocco
        // ha già funzionato, ed è quello che conta.
        console.error('notificaBurstAgliAdmin error:', e);
    }
}

/**
 * Ingresso di un lead del lancio (spec §4.1). Bypassa fasce orarie, tetto del
 * bot, finestra ferie e acAutoIntake: va al bot e basta, e il bot lo riceve
 * subito con provenienza lancio. Dedup come il sync: acContactId dentro il
 * bucket, telefono su bucket ∪ funnel del lancio. Un contatto gia' lead di un
 * ALTRO funnel entra lo stesso (duplicati cross-funnel voluti, decisione
 * 14/09 n.1); lo stesso numero gia' nel lancio no.
 */
async function handleLancioIntake(
    contactId: string,
    rawPayload: Record<string, string>,
    decision: Extract<LancioDecision, { lancio: true }>,
): Promise<NextResponse> {
    // Tipizzato invece di `any` (il flusso storico sotto usa any): qui servono
    // solo questi quattro campi del contatto AC.
    let contact: { firstName?: string; lastName?: string; email?: string; phone?: string } | null = null;
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
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome';

    if (!rawPhone) {
        await recordFailure({ reason: 'Telefono assente', acContactId: contactId, provenienza: LANCIO_FUNNEL, email, phoneRaw: null, payload: rawPayload });
        return NextResponse.json({ skipped: 'missing phone', lancio: true });
    }
    const phoneStrict = normalizePhoneStrict(rawPhone);
    const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone);
    const phoneFinal = phoneFinalNormalized?.startsWith('+39') ? phoneFinalNormalized.slice(3) : phoneFinalNormalized;
    if (!phoneFinal) {
        await recordFailure({ reason: `Telefono non utilizzabile (nessuna cifra): "${rawPhone}"`, acContactId: contactId, provenienza: LANCIO_FUNNEL, email, phoneRaw: rawPhone, payload: rawPayload });
        return NextResponse.json({ skipped: 'invalid phone', lancio: true });
    }
    const phoneSuspicious = !isPlausiblePhone(phoneStrict);

    const utm = readUtmFields(fieldValues);

    const now = new Date();
    const newLeadId = crypto.randomUUID();

    const txResult = await db.transaction(async (tx) => {
        // Stessi lock del flusso normale: due webhook sullo stesso contatto o
        // numero non devono creare due lead nel bucket.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${phoneFinal}, 0))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contactId}, 1))`);

        // Stessa dedup del sync (leggiEsistenti): l'acContactId vale SOLO
        // dentro il bucket — un contatto AC gia' lead di un altro funnel deve
        // poter entrare nel lancio (duplicati cross-funnel voluti) — mentre il
        // telefono vale sul bucket E sul funnel del lancio. Il funnel senza
        // bucket oggi non esiste, ma un import manuale della stessa lista lo
        // creerebbe, e un doppione di numero sono due aperture WhatsApp alla
        // stessa persona.
        const [existing] = await tx.select({ id: leads.id }).from(leads).where(and(
            eq(leads.companyId, FENICE_COMPANY),
            or(
                and(eq(leads.launchBucket, LANCIO_BUCKET), eq(leads.acContactId, contactId)),
                and(
                    or(eq(leads.launchBucket, LANCIO_BUCKET), eq(leads.funnel, LANCIO_FUNNEL)),
                    eq(leads.phone, phoneFinal),
                ),
            ),
        )).limit(1);
        if (existing) return { kind: 'duplicate' as const, existingLeadId: existing.id };

        const [bot] = await tx.select({ id: users.id }).from(users).where(and(
            eq(users.companyId, FENICE_COMPANY),
            eq(users.role, 'GDO'),
            eq(users.isBot, true),
            eq(users.isActive, true),
        )).limit(1);
        const botId = bot?.id ?? null;

        const row = buildLancioLeadRow({
            id: newLeadId, name: fullName, phone: phoneFinal, email,
            acContactId: contactId, phoneSuspicious, botId, now, utm,
        });
        await tx.insert(leads).values(row);
        if (row.assignedToId) {
            await tx.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, row.assignedToId));
        }
        return { kind: 'created' as const, assignedToId: row.assignedToId };
    });

    if (txResult.kind === 'duplicate') {
        return NextResponse.json({ skipped: 'lancio_duplicate', acContactId: contactId, existingLeadId: txResult.existingLeadId });
    }

    // Gli eventi PRIMA del push: se l'insert fallisce, l'errore risale al
    // catch del POST (500 + failure record) e il lead non resta pushato al bot
    // senza IMPORTED/ASSIGNED/LANCIO_INTAKE che lo raccontino.
    await db.insert(leadEvents).values(buildLancioIntakeEventRows({
        leadId: newLeadId,
        botId: txResult.assignedToId,
        adminId: null,
        acContactId: contactId,
        source: 'activecampaign',
        via: decision.via,
        listId: decision.listId,
        now,
    }));

    // Il push parte in after() a risposta inviata. Niente notifica al bot:
    // non legge la UI.
    if (txResult.assignedToId) {
        after(() => pushLeadToBot({
            leadId: newLeadId,
            name: fullName,
            phone: phoneFinal,
            email,
            funnel: LANCIO_FUNNEL,
            companyId: FENICE_COMPANY,
            lancio: lancioPayloadField('lista'),
        }));
    } else if (!phoneSuspicious) {
        console.error(`[AC webhook] lancio: account bot non trovato, lead ${newLeadId} nel bucket senza padrone`);
    }

    return NextResponse.json({
        success: true,
        leadId: newLeadId,
        lancio: true,
        funnel: LANCIO_FUNNEL,
        phoneSuspicious,
        assignedTo: txResult.assignedToId,
        via: decision.via,
    });
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

        // ===== RAMO LANCIO (spec 2026-09-14 §4.1) — PRIMA delle liste bloccate =====
        // La lista del lancio sta ANCHE nel default di BLOCKED_LIST_NAMES_NORMALIZED:
        // a interruttore spento (LANCIO_WEBDEV_INTAKE != 'on') si cade nel ramo
        // sotto e il contatto finisce in acIntakeFailures come oggi, da dove il
        // sync di recupero su /import lo ripesca. Le membership del contatto si
        // leggono UNA volta e si riusano per il controllo delle liste bloccate.
        //
        // Solo subscribe e update entrano nel ramo lancio. Un `unsubscribe` (o
        // qualunque altro evento AC) non deve creare un lead del lancio e far
        // partire un WhatsApp a chi si e' appena disiscritto: cade nel flusso di
        // oggi, cioe' nella riga blocked_list.
        const lancioEventoAmmesso = eventType === 'subscribe' || eventType === 'update';
        const lancioEnabled = isLancioIntakeEnabled() && lancioEventoAmmesso;
        const lancioListIds = lancioEnabled ? await getLancioListIds() : null;
        let activeListIds: Set<string> | null = null;
        let lancioDecision: LancioDecision = decideLancioIntake({
            enabled: lancioEnabled, lancioListIds, triggerListId, activeListIds: null,
        });
        if (!lancioDecision.lancio && lancioDecision.motivo === 'lista_sconosciuta') {
            // Interruttore acceso ma la lista del lancio non si risolve (errore
            // /lists, o lista oltre le 500 paginate). NON si lascia passare il
            // contatto nel flusso normale: prenderebbe il funnel sbagliato, senza
            // bucket e senza campo `lancio` nel push, e domani sarebbe un doppione
            // che il dedup del bucket non vede. Fallisce chiuso: resta in
            // /lead-automatici e lo ripescano il retry e il sync di recupero.
            console.error(`[AC webhook] lancio acceso ma lista non risolvibile — contatto ${contactId} messo da parte`);
            await recordDedupedSkip(contactId, 'lancio_list_unresolved', 'lancio_list_unresolved%', rawPayload);
            return NextResponse.json({ skipped: 'lancio_list_unresolved', acContactId: contactId });
        }
        if (!lancioDecision.lancio && lancioDecision.motivo === 'non_in_lista') {
            activeListIds = await getContactActiveListIds(contactId);
            lancioDecision = decideLancioIntake({ enabled: lancioEnabled, lancioListIds, triggerListId, activeListIds });
        }
        if (lancioDecision.lancio) {
            if (eventType === 'update') {
                // Un update su un lead del lancio GIA' nel bucket non ha niente da
                // aggiornare (il funnel non e' SCONOSCIUTO) e NON deve produrre una
                // riga blocked_list in /lead-automatici. Se invece il contatto nel
                // bucket non c'e' — succede quando AC applica le automazioni dopo la
                // creazione e il primo webhook che ci arriva e' l'update — allora
                // l'update E' l'ingresso del lead: si prosegue come per un subscribe,
                // altrimenti il contatto sparirebbe senza lead, senza failure e
                // senza eventi.
                const [giaNelBucket] = await db.select({ id: leads.id }).from(leads).where(and(
                    eq(leads.companyId, FENICE_COMPANY),
                    eq(leads.launchBucket, LANCIO_BUCKET),
                    eq(leads.acContactId, contactId),
                )).limit(1);
                if (giaNelBucket) {
                    return NextResponse.json({ skipped: 'lancio_update', acContactId: contactId });
                }
            }
            return await handleLancioIntake(contactId, rawPayload, lancioDecision);
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
        const blocked = await getBlockedListIds();
        if (triggerListId && blocked.has(String(triggerListId))) {
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

        // Fallback membership check (run sempre, sia con che senza triggerListId,
        // perché il trigger potrebbe essere una lista non bloccata ma il
        // contatto potrebbe essere ANCHE in una bloccata).
        if (blocked.size > 0) {
            let letturaOk = true;
            if (activeListIds === null) {
                const lettura = await leggiListeContatto(contactId);
                activeListIds = lettura.ids;
                letturaOk = lettura.ok;
            }
            // AC non ha risposto: non sappiamo in che liste sia questo contatto.
            // Si chiude, non si apre — il contatto resta in /lead-automatici e lo
            // recupera il retry, invece di entrare come lead di una lista che
            // magari è proprio una di quelle bloccate.
            if (!letturaOk) {
                console.error(`[AC webhook] liste del contatto ${contactId} non leggibili: messo da parte invece che fatto passare`);
                await recordDedupedSkip(contactId, 'liste_non_leggibili', 'liste_non_leggibili%', rawPayload);
                return NextResponse.json({ skipped: 'liste_non_leggibili', acContactId: contactId });
            }
            const blockedListId = blockedListOf(activeListIds, blocked);
            if (blockedListId) {
                console.log(`[AC webhook] skip contact ${contactId} — lista bloccata (membership) ${blockedListId}`);
                await recordBlockedListSkip(contactId, blockedListId, rawPayload);
                return NextResponse.json({
                    skipped: 'blocked_list',
                    listId: blockedListId,
                    acContactId: contactId,
                    via: 'membership',
                });
            }
        }

        // ===== Interruttore di sovraccarico =====
        // Ultima difesa, e l'unica che non ha bisogno di sapere DA DOVE arrivano
        // i lead. I filtri sopra conoscono solo le liste che qualcuno si è
        // ricordato di configurare; questo guarda il volume, e ferma anche la
        // lista di domani che oggi non sappiamo che esisterà.
        //
        // Sta DOPO le liste bloccate (un contatto bloccato non deve consumare la
        // soglia) e PRIMA della fetch del contatto, così in piena raffica non
        // tempestiamo AC di chiamate che poi buttiamo.
        //
        // Il ramo lancio è già uscito sopra con un return: le sue raffiche sono
        // volute e non passano di qui.
        const burst = leggiBurstConfig();
        if (burst.attivo) {
            // Solo i lead entrati DA QUESTO webhook: un import manuale dalla UI
            // può benissimo caricare 500 lead in un minuto, ed è un'operazione
            // voluta. Contarli farebbe scattare l'interruttore sui lead veri di
            // AC per i dieci minuti successivi.
            const [conteggio] = await db.select({ n: sql<number>`count(*)::int` })
                .from(leads)
                .where(and(
                    eq(leads.companyId, FENICE_COMPANY),
                    eq(leads.source, 'activecampaign'),
                    gte(leads.createdAt, new Date(Date.now() - burst.finestraMinuti * 60_000)),
                ));
            const decisione = decidiBurst({ conteggioInFinestra: conteggio?.n ?? 0, config: burst });
            if (decisione.blocca) {
                console.error(
                    `[AC webhook] INTERRUTTORE DI SOVRACCARICO: ${conteggio?.n} lead in ${burst.finestraMinuti} min ` +
                    `(soglia ${burst.limite}). Contatto ${contactId} messo da parte.`,
                );
                await recordDedupedSkip(contactId, decisione.motivo!, 'burst_guard:%', rawPayload);
                await notificaBurstAgliAdmin(conteggio?.n ?? 0, burst.finestraMinuti);
                return NextResponse.json({ skipped: 'burst_guard', acContactId: contactId, inFinestra: conteggio?.n });
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
        // 24 ore e non 10 minuti: le ricomparse entro un giorno sono doppi
        // submit veri (439 misurate sullo storico), non persone che rientrano.
        // Oltre, chi rientra È un lead nuovo e va richiamato — la mediana fra
        // una comparsa e l'altra è di 10,8 giorni.
        // Vale solo per questo flusso: i pool database e Black Summer duplicano
        // di proposito (decisione PO 20/07) e non passano di qui.
        const dedupCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Giorno solare corrente in Europe/Rome (per la soglia minima dei bot).
        // Lasciamo a Postgres la conversione tz: confronto createdAt >= today 00:00 Rome.
        const todayRome = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(now); // 'YYYY-MM-DD'

        // Config della pipeline del venditore: letta QUI, FUORI dalla
        // transazione, e non dentro dove la si usa.
        //
        // `readSalesPipelineConfig()` gira su `db`, e `db` dentro una
        // `db.transaction` chiede un SECONDO client allo stesso pool mentre il
        // primo e' occupato: su Vercel il pool ha max 5: cinque webhook
        // simultanei si bloccherebbero a vicenda per 15 secondi
        // (connectionTimeoutMillis) e poi fallirebbero tutti. In tutto il CRM
        // non esiste un solo punto in cui `db` viene usato dentro una
        // transazione, e l'intake AC non e' il posto dove inaugurare la cosa.
        //
        // Letta fuori NON e' del tutto senza conseguenze, e vale scriverlo com'e':
        // fra questa riga e il commit della transazione passa tutta la sezione
        // critica, e in quella finestra una richiesta gia' in volo dirotta anche
        // se il PO ha appena spento l'interruttore. Il tetto pero' regge lo
        // stesso — quello si conta sotto lock dentro `tx` — quindi il danno
        // massimo e' qualche lead dirottato dopo lo spegnimento, mai uno di
        // troppo oltre il tetto. E questa funzione non lancia mai: se il DB non
        // risponde torna "pipeline spenta" e il routing di sempre prosegue.
        const salesPipelineCfg = await readSalesPipelineConfig();

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

            /**
             * Tetto giornaliero di lead FRESCHI per singolo GDO (PO 2026-09-15).
             * `dailyFreshCap` null = nessun tetto, e il GDO resta sempre eleggibile.
             *
             * Si contano i lead CREATI oggi e assegnati a lui: i lead che il bot
             * restituisce sono nati in giornate precedenti e vanno comunque a un
             * altro pool (`botReturnIntake`), quindi qui non inquinano il conteggio.
             */
            const underFreshCap = sql`(
                ${users.dailyFreshCap} IS NULL OR (
                    SELECT count(*) FROM leads l
                    WHERE l."assignedToId" = ${users.id}
                      AND l."companyId" = ${FENICE_COMPANY}
                      AND l."createdAt" >= (${todayRome} || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome'
                ) < ${users.dailyFreshCap}
            )`;

            /** Solo i GDO umani abilitati all'intake automatico e sotto il loro tetto. */
            const selectHumanPool = () => selectPool(and(
                gdoBase,
                eq(users.acAutoIntake, true),
                eq(users.isBot, false),
                underFreshCap,
            ));

            /**
             * Le SCORTE: prendono i freschi in eccedenza quando tutti i GDO del pool
             * hanno raggiunto il tetto. Senza nessuna scorta accesa la funzione torna
             * vuota e il chiamante ripiega sul pool ignorando il tetto, così un tetto
             * configurato male non può mai lasciare un lead senza padrone.
             */
            const selectScortaPool = () => selectPool(and(
                gdoBase,
                eq(users.freshOverflowScorta, true),
                eq(users.isBot, false),
            ));

            /** Pool umano ignorando il tetto: ultima rete, mai un lead orfano. */
            const selectHumanPoolNoCap = () => selectPool(and(
                gdoBase,
                eq(users.acAutoIntake, true),
                eq(users.isBot, false),
            ));

            /**
             * I freschi: prima chi è sotto tetto, poi le scorte, poi il BOT, poi il
             * pool senza tetto. Quattro livelli perché l'eccedenza ha una
             * destinazione voluta ma nessun errore di configurazione deve poter
             * fermare l'intake.
             *
             * Il bot in terza posizione dal 17/09/2026. Prima l'eccedenza, finite le
             * scorte umane, tornava ai GDO ignorando il tetto — e un tetto che si
             * scavalca da solo non è un tetto: i 60 al giorno servono proprio a non
             * far bloccare 106/112/119 sui lead migliori. Da quando GDO 114 chiama
             * solo ridati non c'è più nessuna scorta umana, quindi senza questo
             * livello il tetto sarebbe rimasto scritto e mai applicato.
             *
             * `selectBotPool(true)` e non `false`: il bot prende l'eccedenza solo
             * finché è sotto la sua soglia giornaliera. Sopra quella soglia si
             * ricade sul pool senza tetto, perché un lead orfano è peggio di un
             * tetto sforato.
             */
            const selectFreshWithOverflow = async () => {
                const sotto = await selectHumanPool();
                if (sotto.length > 0) return sotto;
                const scorte = await selectScortaPool();
                if (scorte.length > 0) return scorte;
                const botSottoSoglia = await selectBotPool(true);
                if (botSottoSoglia.length > 0) return botSottoSoglia;
                return await selectHumanPoolNoCap();
            };

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

            /**
             * Tappa "metà e metà" del rientro del bot: prende il lead solo se
             * oggi ne ha meno della metà del totale. Si autocorregge da sé — se
             * resta indietro torna eleggibile — senza tenere un contatore a parte
             * che potrebbe sfasarsi.
             */
            const botUnderHalf = sql`(
                SELECT count(*) FROM leads l
                WHERE l."assignedToId" = ${users.id}
                  AND l."companyId" = ${FENICE_COMPANY}
                  AND l."createdAt" >= (${todayRome} || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome'
            ) * 2 < GREATEST(1, (
                SELECT count(*) FROM leads l
                WHERE l."companyId" = ${FENICE_COMPANY}
                  AND l."createdAt" >= (${todayRome} || ' 00:00')::timestamp AT TIME ZONE 'Europe/Rome'
            ))`;

            const selectBotPoolHalf = () => selectPool(and(
                gdoBase,
                eq(users.isBot, true),
                botUnderHalf,
            ));

            // La finestra ferie, quando attiva, vince su tutto: nessun umano al lavoro.
            //
            // ECCEZIONE dal 15/09/2026: il rientro graduale del bot vince sulla
            // finestra ferie. Sono due decisioni sullo stesso interruttore, e la
            // piu' recente deve avere ragione: la finestra ferie di settembre e'
            // stata aperta SENZA data di fine ("2026-09-09..") e quindi non scade
            // da sola, mentre il rientro e' la decisione presa oggi per far
            // risalire la qualita' del numero WhatsApp. Senza questa riga la
            // finestra vecchia continuerebbe a mandare tutti i lead al bot e il
            // rientro non partirebbe mai — verificato sul campo: dopo il deploy
            // delle env, 12 lead su 12 stavano ancora andando al bot.
            const rientro = finestraRientro(now);
            const holidayWindow = !rientro && isBotHolidayWindow(now);
            const routing: LeadRouting = holidayWindow ? 'bot_only' : getLeadRouting(now);

            // Pipeline autonoma venditore: i primi N lead freschi vanno a lui, poi
            // tutto torna esattamente come prima.
            //
            // `funnel !== LANCIO_FUNNEL` e' ridondante — i lead del lancio non
            // passano di qui, escono molto prima in `handleLancioIntake` — ma la
            // guardia su `launchBucket` dentro `shouldDivertFreshLead` qui e'
            // codice morto (si passa `null` in duro), mentre il funnel in questo
            // punto e' un dato vero. Costa un confronto fra stringhe e chiude
            // l'unica strada per cui un iscritto al webinar del 5/10 potrebbe
            // finire al venditore.
            let divertedTo: string | null = null;
            if (salesPipelineCfg.enabled && salesPipelineCfg.salesUserId && funnel !== LANCIO_FUNNEL) {
                /**
                 * Il conteggio dei dirottati. Su `tx` e non su `db`: quando lo si
                 * rilegge sotto lock, il lock vive nella transazione, e contare da
                 * un'altra connessione mentre lo si tiene e' proprio il modo di
                 * leggersi un numero vecchio.
                 */
                const contaDirottati = async () => {
                    const righe = await tx.select({ n: sql<number>`count(*)::int` })
                        .from(leadEvents).where(and(
                            eq(leadEvents.companyId, FENICE_COMPANY),
                            eq(leadEvents.eventType, 'SALES_PIPELINE_ASSIGNED'),
                            sql`${leadEvents.metadata}->>'source' = 'fresh'`,
                        ));
                    return righe[0]?.n ?? 0;
                };

                // Double-checked locking. `pg_advisory_xact_lock` si rilascia al
                // COMMIT, non a fine blocco: prenderlo qui significa tenere un
                // lock GLOBALE esclusivo per tutta la sezione critica e
                // serializzare l'intake AC. A tetto pieno — cioe' da sempre, dal
                // sesto lead in poi — non deve succedere. Quindi prima si conta
                // senza lock: se il tetto e' gia' pieno si esce, e il costo torna
                // a essere una lettura e un return.
                //
                // La lettura senza lock puo' mentire solo per difetto (qualcuno
                // sta dirottando adesso), e in quel caso si va al ramo prudente:
                // si prende il lock e si ricontano sul serio.
                if (await contaDirottati() < salesPipelineCfg.freshCap) {
                    // Chi e' `salesUserId`, davvero. `parseSalesPipelineConfig`
                    // accetta qualunque stringa non vuota e nessuno garantisce che
                    // sia un utente vero: un id inesistente violerebbe la FK di
                    // `leads.assignedToId`, farebbe rollback dell'INTERA
                    // transazione e restituirebbe 500 su OGNI lead AC in arrivo
                    // finche' qualcuno non se ne accorge. Le varianti silenziose
                    // sono peggio: un utente di un'altra azienda (lead invisibile
                    // in entrambe le board) o un venditore disattivato (lead
                    // pagati fermi).
                    //
                    // Si verifica PRIMA di prendere il lock: se la config e'
                    // sbagliata il tetto non si riempie mai, e prendendo il lock
                    // qui si serializzerebbe l'intake per sempre.
                    const [venditore] = await tx.select({ id: users.id }).from(users).where(and(
                        eq(users.id, salesPipelineCfg.salesUserId),
                        eq(users.companyId, FENICE_COMPANY),
                        eq(users.role, 'VENDITORE'),
                        eq(users.isActive, true),
                    )).limit(1);

                    if (!venditore) {
                        // Fallire chiuso, come fa tutto il resto di questa config:
                        // il lead segue il routing di sempre e nessuno si accorge
                        // di niente tranne i log.
                        console.error(`[sales-pipeline] salesUserId '${salesPipelineCfg.salesUserId}' non e' un VENDITORE attivo di ${FENICE_COMPANY}: nessun dirottamento, routing normale`);
                    } else {
                        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('sales-pipeline:fresh', 4))`);
                        // Il conteggio che DECIDE: sotto lock, e quindi vede tutto
                        // cio' che e' stato committato prima di noi. Senza, due
                        // webhook nello stesso istante leggono entrambi "4
                        // dirottati" e ne dirottano un sesto.
                        //
                        // Dipende dall'isolamento READ COMMITTED (il default): con
                        // REPEATABLE READ lo snapshot sarebbe stato preso all'inizio
                        // della transazione, prima del lock, e questa rilettura non
                        // vedrebbe i commit altrui — la garanzia del tetto salterebbe
                        // in silenzio. Se un domani a questa `db.transaction` viene
                        // aggiunto un `isolationLevel`, va rivisto questo punto.
                        const diverted = await contaDirottati();
                        // `launchBucket: null` e' corretto per costruzione: questo
                        // flusso non ne scrive mai uno (pool e lancio passano da
                        // altrove). `phoneSuspicious` qui e' sempre false — la
                        // quarantena e' gia' uscita sopra — ma resta nella chiamata
                        // perche' la regola sta tutta in un posto solo.
                        //
                        // `decideDiversion` e' la regola INTERA, funzione pura e
                        // testata (feeding.test.ts): pipeline spenta, funnel del
                        // lancio, qualunque launchBucket, quarantena e tetto pieno
                        // tornano tutti `null`, cioe' "routing di sempre". La
                        // guardia larga qui sopra resta solo per non pagare i due
                        // conteggi quando la pipeline e' spenta.
                        if (decideDiversion({
                            cfg: salesPipelineCfg, diverted, funnel, launchBucket: null, phoneSuspicious,
                        })) {
                            divertedTo = venditore.id;
                        }
                    }
                }
            }

            // Ogni ramo ha il suo ripiego: una fascia non deve mai poter lasciare
            // un lead senza padrone (bot spento, o tutti i GDO disattivati).
            // `fallbackUsed` marca SOLO i ripieghi anomali: in 'bot_first' passare
            // agli umani a soglia raggiunta è il funzionamento previsto, non un guasto.
            //
            // Con `divertedTo` valorizzato il giro dei pool non si fa nemmeno:
            // il lead ha gia' un padrone e non deve consumare il turno di nessuno.
            // `routing` e `holidayWindow` restano calcolati sopra in ENTRAMBI i
            // casi, cosi' il `return` finale ha la stessa forma per tutti e due i
            // percorsi (li legge l'evento ASSIGNED a valle).
            let eligible: { id: string; isBot: boolean }[] = [];
            let fallbackUsed = false;
            if (!divertedTo) {
                if (routing === 'legacy') {
                    eligible = await selectLegacyPool();
                } else if (routing === 'gdo_only') {
                    // Fascia protetta del sabato: il bot non entra nemmeno se è
                    // sotto la soglia minima. Ci finisce solo se non c'è un umano.
                    eligible = await selectFreshWithOverflow();
                    if (eligible.length === 0) { eligible = await selectBotPool(false); fallbackUsed = true; }
                } else if (routing === 'bot_half') {
                    // Rientro graduale: il bot entra solo finché è sotto metà del
                    // volume di oggi. Sopra metà tocca ai GDO, e se non ce n'è
                    // nessuno disponibile il lead torna al bot invece di restare
                    // orfano — il rientro non deve poter fermare l'intake.
                    eligible = await selectBotPoolHalf();
                    if (eligible.length === 0) eligible = await selectFreshWithOverflow();
                    if (eligible.length === 0) { eligible = await selectBotPool(false); fallbackUsed = true; }
                } else if (routing === 'bot_first') {
                    eligible = await selectBotPool(true);
                    if (eligible.length === 0) eligible = await selectFreshWithOverflow();
                    // Rete finale: il bot anche sopra soglia. Era l'unico ramo senza,
                    // e dal 18/09/2026 si puo' arrivare qui davvero — da quando i GDO
                    // ricevono solo ridati, `selectFreshWithOverflow` torna vuota
                    // appena il bot supera la soglia, e il lead restava orfano.
                    if (eligible.length === 0) { eligible = await selectBotPool(false); fallbackUsed = true; }
                } else {
                    eligible = await selectBotPool(false);
                    if (eligible.length === 0) { eligible = await selectFreshWithOverflow(); fallbackUsed = true; }
                }

                if (eligible.length === 0) {
                    return { kind: 'no_gdo' as const };
                }
            }
            const assignedGdoId = divertedTo ?? eligible[0].id;

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

            if (divertedTo) {
                // Il round robin dei GDO non si muove: questo lead non e' passato di li'.
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: newLeadId,
                    eventType: 'SALES_PIPELINE_ASSIGNED',
                    userId: divertedTo, timestamp: now,
                    metadata: { source: 'fresh' },
                    companyId: FENICE_COMPANY,
                });
                // `assignedGdoIsBot: false` e' cio' che impedisce al
                // `after(() => pushLeadToBot(...))` a valle di partire: il lead
                // e' di una persona, non del bot.
                return { kind: 'created' as const, assignedGdoId, assignedGdoIsBot: false, routing, holidayWindow, fallbackUsed: false, divertedToSales: true };
            }

            await tx.update(users).set({ acLastAssignedAt: now }).where(eq(users.id, assignedGdoId));

            return { kind: 'created' as const, assignedGdoId, assignedGdoIsBot: eligible[0].isBot, routing, holidayWindow, fallbackUsed, divertedToSales: false };
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
            // Quale dei due numeri del bot apre questa chat. Si contano i lead
            // che oggi sono gia' andati a bot 2: se il conteggio non riesce si
            // passa -1, che vale "non lo so" e manda al numero storico.
            const numeroBot = numeroBotPerNuovoLead(await contaBot2Oggi());
            after(() => pushLeadToBot({
                leadId: newLeadId,
                name: fullName,
                phone: phoneFinal,
                email,
                funnel,
                companyId: FENICE_COMPANY,
                numeroBot,
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
                // Su un lead dirottato la fascia era stata calcolata ma non
                // seguita (il giro dei pool non si fa nemmeno): scriverla
                // racconterebbe una regola che non ha deciso niente.
                routing: txResult.divertedToSales ? 'sales_pipeline' : txResult.routing,
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
