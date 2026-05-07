# Marketing Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Esporre 5 eventi del funnel CRM Fenice (`appointment.set`, `appointment.outcome`, `deal.assigned`, `deal.closed_won`, `deal.closed_lost`) al CRM marketing esterno tramite webhook HMAC-firmati con outbox pattern + retry, più endpoint PULL di backfill.

**Architecture:** Outbox queue su Postgres (`marketingWebhookDeliveries`) drenata da `after()` inline + Vercel Cron 1/min con backoff esponenziale. HMAC-SHA256 con timestamp anti-replay. Nessun blocco sui server action: l'enqueue è una sola INSERT in transazione locale, la consegna è async.

**Tech Stack:** Next.js 16.1.6 App Router, Drizzle ORM, Postgres (Supabase), Vercel Cron, HMAC-SHA256 (modulo `node:crypto`), `after()` da `next/server` per delivery speculativa.

**Test approach:** Il progetto **non ha test framework** (no jest/vitest, no `.test.ts` files in source). TDD sostituito con: (1) `npx tsc --noEmit` per type-check, (2) `npm run build` per build verification, (3) manual smoke via debug endpoint `/api/marketing/_debug/send-test` contro `webhook.site`, (4) E2E manuale in dev: crea lead → set appt → conferma → assegna → chiudi → verifica righe `delivered` in `marketingWebhookDeliveries`.

**Riferimento spec:** `docs/superpowers/specs/2026-05-07-marketing-webhooks-design.md`

---

## File map

**CREATE:**
- `src/lib/marketing-webhooks/types.ts` — TypeScript types per eventi e payload
- `src/lib/marketing-webhooks/signing.ts` — HMAC sign/verify
- `src/lib/marketing-webhooks/payload-builders.ts` — builder per ognuno dei 5 eventi
- `src/lib/marketing-webhooks/enqueue.ts` — INSERT in outbox + delivery speculativa
- `src/lib/marketing-webhooks/deliver.ts` — HTTP POST + retry calculation
- `src/app/api/cron/marketing-webhooks-drain/route.ts` — cron worker
- `src/app/api/marketing/leads/route.ts` — PULL endpoint
- `src/app/api/marketing/_debug/send-test/route.ts` — debug send (dev only)
- `vercel.json` — cron config
- `docs/MARKETING-WEBHOOKS-ENV.md` — env var setup guide per deploy

**MODIFY:**
- `src/db/schema.ts` — aggiunta tabella `marketingWebhookDeliveries`
- `src/app/actions/appointmentActions.ts` — hook `appointment.set` su `updateGdoAppointment` + altri set di appointmentDate
- `src/app/actions/confermeActions.ts` — 3 hooks: `appointment.outcome`, `deal.assigned`, `deal.closed_won/lost`

**SQL applicato direttamente in Supabase prod (segue pattern del progetto):**
- `CREATE TABLE marketingWebhookDeliveries` + indici

---

## Task 0: Pre-flight — generare secret e Bearer token

**Files:**
- (nessun file modificato — solo output da consegnare al utente)

- [ ] **Step 1: Generare HMAC secret (64 hex char = 32 byte)**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salvare l'output in un posto sicuro (es. Bitwarden). Verrà impostato come `MARKETING_WEBHOOK_SECRET` su Vercel e condiviso con lo sviluppatore marketing.

- [ ] **Step 2: Generare PULL API token (32 byte base64)**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Salvare l'output. Verrà impostato come `MARKETING_PULL_API_TOKEN` su Vercel.

- [ ] **Step 3: Generare Cron secret (32 byte base64)**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Verrà impostato come `CRON_SECRET` su Vercel (Vercel Cron lo invia automaticamente in header `Authorization`).

- [ ] **Step 4: Comunicare a Bruno i 3 valori generati**

Stampare in chat i 3 valori e ricordare a Bruno di:
1. Salvarli in un password manager
2. Settarli in Vercel: Project → Settings → Environment Variables (Production + Preview)
3. Condividere `MARKETING_WEBHOOK_SECRET` con lo sviluppatore marketing via canale sicuro

---

## Task 1: Schema — aggiungere tabella `marketingWebhookDeliveries`

**Files:**
- Modify: `src/db/schema.ts` (in fondo al file, prima delle ultime righe)

- [ ] **Step 1: Aggiungere tabella in schema.ts**

Trovare la fine del file `src/db/schema.ts` (dopo `appSettings`) e aggiungere:

```ts
// Outbox queue per i webhook al CRM marketing esterno.
// Ogni evento del funnel (appointment.set, appointment.outcome, deal.assigned,
// deal.closed_won, deal.closed_lost) genera una riga qui. Il worker drainer
// (cron + after() inline) la consuma con retry esponenziale.
export const marketingWebhookDeliveries = pgTable('marketingWebhookDeliveries', {
    id: text('id').primaryKey(),                                   // = eventId (UUID v4)
    eventType: text('eventType').notNull(),                        // 'appointment.set' | 'appointment.outcome' | 'deal.assigned' | 'deal.closed_won' | 'deal.closed_lost'
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),                           // envelope completo già pronto da firmare
    targetUrl: text('targetUrl').notNull(),                        // URL del receiver (snapshot al momento dell'enqueue)

    status: text('status').default('pending').notNull(),           // 'pending' | 'delivered' | 'failed_permanent' | 'dead'
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: timestamp('lastAttemptAt', { withTimezone: true, mode: 'date' }),
    nextAttemptAt: timestamp('nextAttemptAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deliveredAt: timestamp('deliveredAt', { withTimezone: true, mode: 'date' }),

    lastResponseStatus: integer('lastResponseStatus'),
    lastError: text('lastError'),                                  // truncato a 1000 char in app

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => {
    return {
        statusNextIdx: index('mkt_webhook_status_next_idx').on(t.status, t.nextAttemptAt),
        leadIdx: index('mkt_webhook_lead_idx').on(t.leadId),
        eventTypeIdx: index('mkt_webhook_event_type_idx').on(t.eventType),
    };
});
```

- [ ] **Step 2: Applicare CREATE TABLE in Supabase prod via MCP**

Usare il tool `mcp__supabase__apply_migration` con:

- name: `create_marketing_webhook_deliveries`
- query:

```sql
CREATE TABLE IF NOT EXISTS "marketingWebhookDeliveries" (
    "id" text PRIMARY KEY NOT NULL,
    "eventType" text NOT NULL,
    "leadId" text NOT NULL,
    "payload" jsonb NOT NULL,
    "targetUrl" text NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "lastAttemptAt" timestamp with time zone,
    "nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
    "deliveredAt" timestamp with time zone,
    "lastResponseStatus" integer,
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "marketingWebhookDeliveries_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "mkt_webhook_status_next_idx"
    ON "marketingWebhookDeliveries" ("status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "mkt_webhook_lead_idx"
    ON "marketingWebhookDeliveries" ("leadId");
CREATE INDEX IF NOT EXISTS "mkt_webhook_event_type_idx"
    ON "marketingWebhookDeliveries" ("eventType");
```

- [ ] **Step 3: Verificare tipi compilano**

Run: `npx tsc --noEmit`
Expected: 0 errori (la nuova tabella è auto-tipata da Drizzle).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(marketing-webhooks): add marketingWebhookDeliveries outbox table"
```

---

## Task 2: Lib — types

**Files:**
- Create: `src/lib/marketing-webhooks/types.ts`

- [ ] **Step 1: Creare il file types**

```ts
// Event taxonomy per i webhook al CRM marketing esterno.
// Vedi docs/superpowers/specs/2026-05-07-marketing-webhooks-design.md

export type MarketingEventType =
    | 'appointment.set'
    | 'appointment.outcome'
    | 'deal.assigned'
    | 'deal.closed_won'
    | 'deal.closed_lost';

export const ALL_EVENT_TYPES: MarketingEventType[] = [
    'appointment.set',
    'appointment.outcome',
    'deal.assigned',
    'deal.closed_won',
    'deal.closed_lost',
];

export interface ActorRef {
    userId: string;
    displayName: string | null;
    role: string;
}

export interface LeadEnvelope {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    funnel: string | null;
    source: string | null;
    createdAt: string; // ISO
    utm: {
        source: string | null;
        medium: string | null;
        campaign: string | null;
        content: string | null;
        term: string | null;
    };
}

export interface BaseEnvelope {
    eventId: string;        // UUID v4 (deterministic)
    eventType: MarketingEventType;
    occurredAt: string;     // ISO
    apiVersion: '1';
    lead: LeadEnvelope;
}

export interface AppointmentSetData {
    appointmentDate: string; // ISO
    appointmentNote: string | null;
    appointmentCreatedAt: string | null;
    callCount: number;
    setBy: ActorRef | null;
}

export interface AppointmentOutcomeData {
    status: 'CONFERMATO' | 'NON_CONFERMATO' | 'DA_RIFISSARE';
    rawOutcome: string;
    discardReason: string | null;
    decidedAt: string;
    appointmentDate: string | null;
    decidedBy: ActorRef | null;
}

export interface DealAssignedData {
    assignedAt: string;
    salesperson: ActorRef | null;
}

export interface DealClosedWonData {
    closedAt: string;
    product: string | null;
    amountEur: number | null;
    notes: string | null;
    salesperson: ActorRef | null;
}

export interface DealClosedLostData {
    closedAt: string;
    outcome: string;
    reason: string | null;
    notes: string | null;
    salesperson: ActorRef | null;
}

export type EventData =
    | AppointmentSetData
    | AppointmentOutcomeData
    | DealAssignedData
    | DealClosedWonData
    | DealClosedLostData;

export interface MarketingWebhookEnvelope extends BaseEnvelope {
    data: EventData;
}
```

- [ ] **Step 2: Verificare tipi compilano**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/lib/marketing-webhooks/types.ts
git commit -m "feat(marketing-webhooks): add types for event envelopes"
```

---

## Task 3: Lib — signing (HMAC sign + verify)

**Files:**
- Create: `src/lib/marketing-webhooks/signing.ts`

- [ ] **Step 1: Creare il modulo signing**

```ts
import crypto from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export interface SignResult {
    signature: string;        // 'sha256=<hex>'
    timestamp: string;        // unix seconds (string for header)
}

/**
 * Firma il body raw con HMAC-SHA256 usando lo schema:
 *   stringToSign = `${timestamp}.${rawBody}`
 *   signature    = sha256=hex(hmac(secret, stringToSign))
 */
export function signPayload(rawBody: string, secret: string, now = new Date()): SignResult {
    const timestamp = Math.floor(now.getTime() / 1000).toString();
    const stringToSign = `${timestamp}.${rawBody}`;
    const hex = crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');
    return { signature: `${SIGNATURE_PREFIX}${hex}`, timestamp };
}

/**
 * Verifica una firma HMAC. Costant-time compare per evitare timing attacks.
 * `maxAgeSeconds`: rifiuta se il timestamp è più vecchio di N secondi (anti-replay).
 */
export function verifySignature(
    rawBody: string,
    timestampHeader: string,
    signatureHeader: string,
    secret: string,
    maxAgeSeconds = 300
): { valid: boolean; reason?: string } {
    if (!timestampHeader || !signatureHeader) return { valid: false, reason: 'missing_headers' };
    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) return { valid: false, reason: 'bad_prefix' };

    const ts = parseInt(timestampHeader, 10);
    if (Number.isNaN(ts)) return { valid: false, reason: 'bad_timestamp' };

    const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (ageSec > maxAgeSeconds) return { valid: false, reason: 'expired' };

    const expectedHex = crypto
        .createHmac('sha256', secret)
        .update(`${timestampHeader}.${rawBody}`)
        .digest('hex');
    const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(providedHex, 'hex');
    if (a.length !== b.length) return { valid: false, reason: 'length_mismatch' };

    return crypto.timingSafeEqual(a, b)
        ? { valid: true }
        : { valid: false, reason: 'signature_mismatch' };
}
```

- [ ] **Step 2: Verifica round-trip manuale (smoke check)**

Creare `scripts/test-signing.mjs` (file temporaneo, NON committare):

```js
import { signPayload, verifySignature } from '../src/lib/marketing-webhooks/signing.js';

const body = JSON.stringify({ hello: 'world' });
const secret = 'a'.repeat(64);
const { signature, timestamp } = signPayload(body, secret);
console.log('signature:', signature);
console.log('timestamp:', timestamp);

const r1 = verifySignature(body, timestamp, signature, secret);
console.log('valid (correct):', r1);

const r2 = verifySignature(body, timestamp, signature, secret + 'x');
console.log('valid (wrong secret):', r2);

const r3 = verifySignature(body, '1', signature, secret); // expired
console.log('valid (expired):', r3);
```

Run: `npx tsx scripts/test-signing.mjs`
Expected:
- `valid (correct): { valid: true }`
- `valid (wrong secret): { valid: false, reason: 'signature_mismatch' }`
- `valid (expired): { valid: false, reason: 'expired' }`

Eliminare lo script dopo: `rm scripts/test-signing.mjs`

- [ ] **Step 3: Commit**

```bash
git add src/lib/marketing-webhooks/signing.ts
git commit -m "feat(marketing-webhooks): add HMAC-SHA256 sign/verify helpers"
```

---

## Task 4: Lib — payload builders

**Files:**
- Create: `src/lib/marketing-webhooks/payload-builders.ts`

- [ ] **Step 1: Creare i builder**

Mapping per `confirmationsOutcome` (valori reali confermati nel DB: `"confermato"`, `"scartato"`):
- `"confermato"` → `CONFERMATO`
- `"scartato"` → `NON_CONFERMATO`
- qualsiasi altro valore (incluso eventuale `"da_rifissare"`) → `DA_RIFISSARE`

```ts
import crypto from 'node:crypto';
import type { InferSelectModel } from 'drizzle-orm';
import type { leads, users } from '@/db/schema';
import type {
    MarketingWebhookEnvelope,
    MarketingEventType,
    LeadEnvelope,
    ActorRef,
    AppointmentSetData,
    AppointmentOutcomeData,
    DealAssignedData,
    DealClosedWonData,
    DealClosedLostData,
} from './types';

type Lead = InferSelectModel<typeof leads>;
type User = InferSelectModel<typeof users>;

/**
 * eventId deterministico: UUID v5-like derivato da (eventType + leadId + occurredAt-al-secondo).
 * Doppio click utente con stesso payload → stesso eventId → INSERT con ON CONFLICT DO NOTHING.
 */
export function deterministicEventId(
    eventType: MarketingEventType,
    leadId: string,
    occurredAt: Date
): string {
    const seconds = Math.floor(occurredAt.getTime() / 1000);
    const seed = `${eventType}|${leadId}|${seconds}`;
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    // Format come UUID v4-shape (8-4-4-4-12)
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function actorFromUser(u: Pick<User, 'id' | 'displayName' | 'name' | 'role'> | null | undefined): ActorRef | null {
    if (!u) return null;
    return {
        userId: u.id,
        displayName: u.displayName ?? u.name ?? null,
        role: u.role,
    };
}

function leadEnvelope(lead: Lead): LeadEnvelope {
    return {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        funnel: lead.funnel,
        source: lead.source,
        createdAt: lead.createdAt.toISOString(),
        utm: {
            source: lead.utmSource,
            medium: lead.utmMedium,
            campaign: lead.utmCampaign,
            content: lead.utmContent,
            term: lead.utmTerm,
        },
    };
}

export interface BuildContext {
    lead: Lead;
    actor?: Pick<User, 'id' | 'displayName' | 'name' | 'role'> | null;
    occurredAt?: Date;
}

export function buildAppointmentSet(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    if (!lead.appointmentDate) {
        throw new Error(`buildAppointmentSet: lead ${lead.id} has no appointmentDate`);
    }
    const data: AppointmentSetData = {
        appointmentDate: lead.appointmentDate.toISOString(),
        appointmentNote: lead.appointmentNote,
        appointmentCreatedAt: lead.appointmentCreatedAt?.toISOString() ?? null,
        callCount: lead.callCount,
        setBy: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('appointment.set', lead.id, occurredAt),
        eventType: 'appointment.set',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

function mapConfirmationsOutcome(raw: string | null): AppointmentOutcomeData['status'] {
    if (raw === 'confermato') return 'CONFERMATO';
    if (raw === 'scartato') return 'NON_CONFERMATO';
    return 'DA_RIFISSARE';
}

export function buildAppointmentOutcome(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: AppointmentOutcomeData = {
        status: mapConfirmationsOutcome(lead.confirmationsOutcome),
        rawOutcome: lead.confirmationsOutcome ?? '',
        discardReason: lead.confirmationsDiscardReason,
        decidedAt: (lead.confirmationsTimestamp ?? occurredAt).toISOString(),
        appointmentDate: lead.appointmentDate?.toISOString() ?? null,
        decidedBy: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('appointment.outcome', lead.id, occurredAt),
        eventType: 'appointment.outcome',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

export function buildDealAssigned(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: DealAssignedData = {
        assignedAt: (lead.salespersonAssignedAt ?? occurredAt).toISOString(),
        salesperson: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('deal.assigned', lead.id, occurredAt),
        eventType: 'deal.assigned',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

export function buildDealClosedWon(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: DealClosedWonData = {
        closedAt: (lead.salespersonOutcomeAt ?? occurredAt).toISOString(),
        product: lead.closeProduct,
        amountEur: lead.closeAmountEur,
        notes: lead.salespersonOutcomeNotes,
        salesperson: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('deal.closed_won', lead.id, occurredAt),
        eventType: 'deal.closed_won',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

export function buildDealClosedLost(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: DealClosedLostData = {
        closedAt: (lead.salespersonOutcomeAt ?? occurredAt).toISOString(),
        outcome: lead.salespersonOutcome ?? '',
        reason: lead.notClosedReason,
        notes: lead.salespersonOutcomeNotes,
        salesperson: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('deal.closed_lost', lead.id, occurredAt),
        eventType: 'deal.closed_lost',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}
```

- [ ] **Step 2: Verificare tipi compilano**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/lib/marketing-webhooks/payload-builders.ts
git commit -m "feat(marketing-webhooks): add payload builders for 5 event types"
```

---

## Task 5: Lib — deliver (HTTP POST + retry calc)

**Files:**
- Create: `src/lib/marketing-webhooks/deliver.ts`

- [ ] **Step 1: Creare il modulo deliver**

```ts
import { signPayload } from './signing';
import type { MarketingWebhookEnvelope } from './types';

export interface DeliverResult {
    delivered: boolean;
    permanentFailure: boolean;     // 4xx (eccetto 429): non ritentare
    httpStatus: number | null;
    error: string | null;
}

const DELIVERY_TIMEOUT_MS = 10_000;

export async function deliverWebhook(
    targetUrl: string,
    envelope: MarketingWebhookEnvelope,
    secret: string
): Promise<DeliverResult> {
    const body = JSON.stringify(envelope);
    const { signature, timestamp } = signPayload(body, secret);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
        const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'CrmFenice-Webhooks/1.0',
                'X-CRM-Event-Id': envelope.eventId,
                'X-CRM-Event-Type': envelope.eventType,
                'X-CRM-Timestamp': timestamp,
                'X-CRM-Signature': signature,
            },
            body,
            signal: controller.signal,
        });

        const ok = res.status >= 200 && res.status < 300;
        const permanentFailure = res.status >= 400 && res.status < 500 && res.status !== 429;

        let errSnippet: string | null = null;
        if (!ok) {
            try {
                errSnippet = (await res.text()).slice(0, 1000);
            } catch {
                errSnippet = null;
            }
        }

        return {
            delivered: ok,
            permanentFailure,
            httpStatus: res.status,
            error: ok ? null : errSnippet,
        };
    } catch (e: any) {
        const isTimeout = e?.name === 'AbortError';
        return {
            delivered: false,
            permanentFailure: false,
            httpStatus: null,
            error: isTimeout ? 'timeout_10s' : (e?.message ?? 'unknown_error'),
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Backoff esponenziale: 1m → 5m → 30m → 2h → 6h → DLQ (dopo 6 fallimenti).
 * Ritorna NULL se è il caso di mandare in dead-letter.
 */
export function nextAttemptDelay(attempts: number): number | null {
    const ladderSeconds = [
        60,         // attempt 2 (after 1st fail)
        5 * 60,     // attempt 3
        30 * 60,    // attempt 4
        2 * 60 * 60,// attempt 5
        6 * 60 * 60,// attempt 6
    ];
    if (attempts >= ladderSeconds.length + 1) return null;
    return ladderSeconds[attempts - 1] * 1000;
}
```

- [ ] **Step 2: Verifica tipi**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/lib/marketing-webhooks/deliver.ts
git commit -m "feat(marketing-webhooks): add HTTP delivery with HMAC + retry calc"
```

---

## Task 6: Lib — enqueue (con delivery speculativa via after())

**Files:**
- Create: `src/lib/marketing-webhooks/enqueue.ts`

- [ ] **Step 1: Creare il modulo enqueue**

```ts
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { leads, users, marketingWebhookDeliveries } from '@/db/schema';
import { deliverWebhook, nextAttemptDelay } from './deliver';
import {
    buildAppointmentSet,
    buildAppointmentOutcome,
    buildDealAssigned,
    buildDealClosedWon,
    buildDealClosedLost,
} from './payload-builders';
import type { MarketingEventType, MarketingWebhookEnvelope } from './types';

export interface EnqueueInput {
    eventType: MarketingEventType;
    leadId: string;
    actorUserId?: string | null;
    occurredAt?: Date;
}

/**
 * Punto unico di ingresso dai server action. Carica il lead, costruisce
 * l'envelope, lo inserisce in outbox, e fa un tentativo di consegna inline
 * via after() (non blocca la response del server action).
 *
 * Idempotenza: eventId è deterministico → ON CONFLICT DO NOTHING evita duplicati.
 *
 * Kill-switch: se MARKETING_WEBHOOK_ENABLED !== 'true', non fa nulla.
 */
export async function enqueueMarketingWebhook(input: EnqueueInput): Promise<void> {
    if (process.env.MARKETING_WEBHOOK_ENABLED !== 'true') return;

    const targetUrl = process.env.MARKETING_WEBHOOK_URL_PROD;
    const secret = process.env.MARKETING_WEBHOOK_SECRET;
    if (!targetUrl || !secret) {
        console.error('[marketing-webhooks] missing env: MARKETING_WEBHOOK_URL_PROD or MARKETING_WEBHOOK_SECRET');
        return;
    }

    // 1. Carica lead
    const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId));
    if (!lead) {
        console.warn(`[marketing-webhooks] lead ${input.leadId} not found, skipping ${input.eventType}`);
        return;
    }

    // 2. Carica actor (opzionale)
    let actor = null;
    if (input.actorUserId) {
        const [u] = await db.select({
            id: users.id, name: users.name, displayName: users.displayName, role: users.role,
        }).from(users).where(eq(users.id, input.actorUserId));
        actor = u ?? null;
    }

    // 3. Build envelope
    const ctx = { lead, actor, occurredAt: input.occurredAt ?? new Date() };
    let envelope: MarketingWebhookEnvelope;
    switch (input.eventType) {
        case 'appointment.set':       envelope = buildAppointmentSet(ctx); break;
        case 'appointment.outcome':   envelope = buildAppointmentOutcome(ctx); break;
        case 'deal.assigned':         envelope = buildDealAssigned(ctx); break;
        case 'deal.closed_won':       envelope = buildDealClosedWon(ctx); break;
        case 'deal.closed_lost':      envelope = buildDealClosedLost(ctx); break;
    }

    // 4. INSERT in outbox (ON CONFLICT DO NOTHING per idempotenza)
    await db.insert(marketingWebhookDeliveries).values({
        id: envelope.eventId,
        eventType: envelope.eventType,
        leadId: lead.id,
        payload: envelope,
        targetUrl,
        status: 'pending',
        nextAttemptAt: new Date(),
    }).onConflictDoNothing({ target: marketingWebhookDeliveries.id });

    // 5. Delivery speculativa (non blocca la response)
    after(async () => {
        try {
            const result = await deliverWebhook(targetUrl, envelope, secret);
            if (result.delivered) {
                await db.update(marketingWebhookDeliveries).set({
                    status: 'delivered',
                    deliveredAt: new Date(),
                    lastAttemptAt: new Date(),
                    attempts: 1,
                    lastResponseStatus: result.httpStatus,
                }).where(eq(marketingWebhookDeliveries.id, envelope.eventId));
            } else {
                const delay = nextAttemptDelay(1);
                const newStatus = result.permanentFailure
                    ? 'failed_permanent'
                    : (delay === null ? 'dead' : 'pending');
                await db.update(marketingWebhookDeliveries).set({
                    status: newStatus,
                    attempts: 1,
                    lastAttemptAt: new Date(),
                    nextAttemptAt: delay ? new Date(Date.now() + delay) : new Date(),
                    lastResponseStatus: result.httpStatus,
                    lastError: result.error,
                }).where(eq(marketingWebhookDeliveries.id, envelope.eventId));
            }
        } catch (e: any) {
            console.error('[marketing-webhooks] inline delivery error', e);
            // Lasciamo lo stato pending; il cron rigenererà.
        }
    });
}
```

- [ ] **Step 2: Verifica tipi**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/lib/marketing-webhooks/enqueue.ts
git commit -m "feat(marketing-webhooks): add enqueue with after() speculative delivery"
```

---

## Task 7: Hook in `appointmentActions.ts` — `appointment.set`

**Files:**
- Modify: `src/app/actions/appointmentActions.ts`

- [ ] **Step 1: Identificare TUTTI i punti che assegnano `appointmentDate`**

Run: `grep -n "appointmentDate:" src/app/actions/appointmentActions.ts`

I punti già noti:
- `updateGdoAppointment` (line ~68): set di `appointmentDate` da parte del GDO
- Altri eventuali (cancellazioni a `null` NON triggerano evento — solo set valorizzato)

NB: il file potrebbe avere altre funzioni che chiamano `db.update(leads).set({ appointmentDate })`. Esaminare ciascuna e decidere se è un set significativo (nuovo appuntamento o reschedule) — in entrambi i casi va emesso `appointment.set`. Se è un reset a NULL, niente evento.

- [ ] **Step 2: Aggiungere import in cima al file**

Trovare la sezione import e aggiungere:

```ts
import { enqueueMarketingWebhook } from '@/lib/marketing-webhooks/enqueue';
```

- [ ] **Step 3: In `updateGdoAppointment`, dopo l'update riuscito, prima del return**

Trovare il blocco (intorno alla riga 76-80):

```ts
    if (updated.length === 0) {
        return { success: false, error: 'CONCURRENCY_ERROR' };
    }

    return { success: true };
```

Aggiungere PRIMA del `return { success: true }`:

```ts
    // Marketing webhook: appointment.set
    await enqueueMarketingWebhook({
        eventType: 'appointment.set',
        leadId,
        actorUserId: supabaseUser.id,
    });
```

- [ ] **Step 4: Per ogni altra funzione che valorizza `appointmentDate` con un Date (non null)**

Ripetere il pattern dello Step 3: dopo l'update riuscito, chiamare `enqueueMarketingWebhook({ eventType: 'appointment.set', leadId, actorUserId: <id-utente> })`.

In particolare, controllare se esiste una `setAppointment` nel pipelineActions.ts — se sì, hookare anche lì:

Run: `grep -rn "appointmentDate:" src/app/actions/`

Per OGNI corrispondenza che è un assignment a Date (non null/undefined) in un `db.update(leads).set({...})`, aggiungere il hook subito dopo l'update.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/appointmentActions.ts src/app/actions/pipelineActions.ts
git commit -m "feat(marketing-webhooks): emit appointment.set on appointmentDate assignments"
```

---

## Task 8: Hooks in `confermeActions.ts` — `appointment.outcome`, `deal.assigned`

**Files:**
- Modify: `src/app/actions/confermeActions.ts`

- [ ] **Step 1: Aggiungere import in cima al file**

```ts
import { enqueueMarketingWebhook } from '@/lib/marketing-webhooks/enqueue';
```

- [ ] **Step 2: Identificare le 2 funzioni di interesse**

Run: `grep -n "confirmationsOutcome:\|salespersonUserId:" src/app/actions/confermeActions.ts`

Risultati attesi (verificati in fase di plan):
- Line ~378: `confirmationsOutcome: outcome` (= dentro la funzione che il team Conferme chiama per esitare)
- Line ~383: `salespersonUserId: salespersonAssigned || null` (= stessa funzione, set venditore se outcome è confermato)
- Line ~601: secondo punto dove `confirmationsOutcome` viene messo a 'scartato'
- Line ~725: `appointmentDate: null` (reset, non emette evento)
- Line ~727: legge `confirmationsOutcome` (no write)

- [ ] **Step 3: Hook nella funzione che esita la conferma (line ~378)**

Aprire la funzione che contiene il blocco:

```ts
            confirmationsOutcome: outcome,
            ...
            salespersonUserId: salespersonAssigned || null,
```

Dopo il `db.update(...).set({...}).where(...)` riuscito e dopo eventuali side effects, aggiungere:

```ts
    // Marketing webhook: appointment.outcome
    await enqueueMarketingWebhook({
        eventType: 'appointment.outcome',
        leadId,
        actorUserId: session.user.id,
    });

    // Se è stato assegnato un venditore in questo stesso step, emette anche deal.assigned
    if (salespersonAssigned) {
        await enqueueMarketingWebhook({
            eventType: 'deal.assigned',
            leadId,
            actorUserId: session.user.id,
        });
    }
```

(Il nome esatto della variabile `session` / `leadId` potrebbe variare — adattare al codice reale della funzione.)

- [ ] **Step 4: Hook nel secondo punto (line ~601, `confirmationsOutcome = 'scartato'`)**

Aprire la funzione che contiene `toUpdate.confirmationsOutcome = 'scartato'`. Dopo l'update riuscito, aggiungere:

```ts
    // Marketing webhook: appointment.outcome (scartato)
    await enqueueMarketingWebhook({
        eventType: 'appointment.outcome',
        leadId,
        actorUserId: session.user.id,
    });
```

- [ ] **Step 5: Identificare set di `salespersonOutcome` (line ~547)**

Run: `grep -n "salespersonOutcome:" src/app/actions/confermeActions.ts`

Risultato atteso: line ~547 ha `salespersonOutcome: outcome`. Questa funzione è chiamata sia per `Chiuso` che per `Non chiuso`/`Sparito`. Dopo l'update riuscito:

```ts
    // Marketing webhook: deal.closed_won o deal.closed_lost a seconda dell'outcome
    const closedEventType = outcome === 'Chiuso' ? 'deal.closed_won' : 'deal.closed_lost';
    await enqueueMarketingWebhook({
        eventType: closedEventType,
        leadId,
        actorUserId: session.user.id,
    });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/confermeActions.ts
git commit -m "feat(marketing-webhooks): emit outcome/assigned/closed events from confermeActions"
```

---

## Task 9: Verificare se `venditoreActions.ts` è hook point separato

**Files:**
- Modify (eventuale): `src/app/actions/venditoreActions.ts`

- [ ] **Step 1: Cercare set di `salespersonOutcome` in venditoreActions.ts**

Run: `grep -n "salespersonOutcome\|closeProduct\|closeAmountEur" src/app/actions/venditoreActions.ts`

Se trova set di `salespersonOutcome`/`closeProduct`/`closeAmountEur` in funzioni distinte rispetto a `confermeActions.ts:547`, sono hook point separati. Se non trova → skip questo task.

- [ ] **Step 2: Per ogni funzione trovata, aggiungere hook**

Pattern:

```ts
    // Marketing webhook
    const closedEventType = outcome === 'Chiuso' ? 'deal.closed_won' : 'deal.closed_lost';
    await enqueueMarketingWebhook({
        eventType: closedEventType,
        leadId,
        actorUserId: session.user.id,
    });
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`

Se ci sono modifiche:
```bash
git add src/app/actions/venditoreActions.ts
git commit -m "feat(marketing-webhooks): emit closed events from venditoreActions"
```

---

## Task 10: Cron worker — drainer

**Files:**
- Create: `src/app/api/cron/marketing-webhooks-drain/route.ts`

- [ ] **Step 1: Creare il route handler**

```ts
import { NextResponse } from 'next/server';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '@/db';
import { marketingWebhookDeliveries } from '@/db/schema';
import { deliverWebhook, nextAttemptDelay } from '@/lib/marketing-webhooks/deliver';
import type { MarketingWebhookEnvelope } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Fluid Compute, max 300 ma 60 basta

const BATCH_SIZE = 50;

export async function GET(req: Request) {
    // Vercel Cron invia Authorization: Bearer <CRON_SECRET>
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (process.env.MARKETING_WEBHOOK_ENABLED !== 'true') {
        return NextResponse.json({ skipped: true, reason: 'kill_switch_off' });
    }

    const secret = process.env.MARKETING_WEBHOOK_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'missing_secret' }, { status: 500 });
    }

    const now = new Date();

    // Pesca i pending pronti
    const batch = await db.select()
        .from(marketingWebhookDeliveries)
        .where(and(
            eq(marketingWebhookDeliveries.status, 'pending'),
            lte(marketingWebhookDeliveries.nextAttemptAt, now),
        ))
        .limit(BATCH_SIZE);

    let delivered = 0;
    let failed = 0;
    let dead = 0;

    await Promise.allSettled(batch.map(async (row) => {
        const envelope = row.payload as MarketingWebhookEnvelope;
        const result = await deliverWebhook(row.targetUrl, envelope, secret);
        const newAttempts = row.attempts + 1;

        if (result.delivered) {
            await db.update(marketingWebhookDeliveries).set({
                status: 'delivered',
                deliveredAt: new Date(),
                lastAttemptAt: new Date(),
                attempts: newAttempts,
                lastResponseStatus: result.httpStatus,
                lastError: null,
            }).where(eq(marketingWebhookDeliveries.id, row.id));
            delivered++;
        } else {
            const delay = nextAttemptDelay(newAttempts);
            const newStatus = result.permanentFailure
                ? 'failed_permanent'
                : (delay === null ? 'dead' : 'pending');
            await db.update(marketingWebhookDeliveries).set({
                status: newStatus,
                attempts: newAttempts,
                lastAttemptAt: new Date(),
                nextAttemptAt: delay ? new Date(Date.now() + delay) : new Date(),
                lastResponseStatus: result.httpStatus,
                lastError: result.error,
            }).where(eq(marketingWebhookDeliveries.id, row.id));
            if (newStatus === 'dead') dead++;
            else failed++;
        }
    }));

    return NextResponse.json({ scanned: batch.length, delivered, failed, dead });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/marketing-webhooks-drain/route.ts
git commit -m "feat(marketing-webhooks): add cron drainer with backoff"
```

---

## Task 11: Vercel cron config

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Verificare che vercel.json non esista già**

Run: `ls vercel.json 2>/dev/null && echo "EXISTS" || echo "NOT EXISTS"`

Se esiste, mergeare la sezione `crons` invece di sovrascrivere.

- [ ] **Step 2: Creare vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/cron/marketing-webhooks-drain",
      "schedule": "* * * * *"
    }
  ]
}
```

NB: schedule `* * * * *` = ogni minuto. Richiede Vercel Pro plan (Hobby permette solo 1/giorno). Se il progetto è su Hobby, cambiare in `*/5 * * * *` o `0 * * * *` e accettare retry più lenti.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(marketing-webhooks): add Vercel cron 1/min for drainer"
```

---

## Task 12: Debug endpoint per smoke test

**Files:**
- Create: `src/app/api/marketing/_debug/send-test/route.ts`

- [ ] **Step 1: Creare il route**

```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { enqueueMarketingWebhook } from '@/lib/marketing-webhooks/enqueue';
import type { MarketingEventType } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/marketing/_debug/send-test
 * Body: { eventType: MarketingEventType, leadId: string }
 *
 * Solo per ADMIN/MANAGER. Forza l'invio di un evento contro la URL configurata.
 * Utile per QA prima del go-live.
 */
export async function POST(req: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const role = user.user_metadata?.role;
    if (role !== 'MANAGER' && role !== 'ADMIN') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: { eventType?: MarketingEventType; leadId?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'bad_json' }, { status: 400 });
    }

    if (!body.eventType || !body.leadId) {
        return NextResponse.json({ error: 'missing_eventType_or_leadId' }, { status: 400 });
    }

    await enqueueMarketingWebhook({
        eventType: body.eventType,
        leadId: body.leadId,
        actorUserId: user.id,
    });

    return NextResponse.json({ enqueued: true });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/marketing/_debug/send-test/route.ts
git commit -m "feat(marketing-webhooks): add debug send-test endpoint"
```

---

## Task 13: PULL endpoint per backfill / recovery

**Files:**
- Create: `src/app/api/marketing/leads/route.ts`

- [ ] **Step 1: Creare il PULL endpoint**

```ts
import { NextResponse } from 'next/server';
import { and, eq, gte, lte, gt, isNotNull, asc, SQL } from 'drizzle-orm';
import { db } from '@/db';
import { leads, users } from '@/db/schema';
import {
    buildAppointmentSet,
    buildAppointmentOutcome,
    buildDealAssigned,
    buildDealClosedWon,
    buildDealClosedLost,
} from '@/lib/marketing-webhooks/payload-builders';
import type { MarketingEventType } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(req: Request) {
    // Auth: Bearer token (NON il webhook secret)
    const auth = req.headers.get('authorization');
    const expected = process.env.MARKETING_PULL_API_TOKEN;
    if (!expected) return NextResponse.json({ error: 'pull_disabled' }, { status: 503 });
    if (auth !== `Bearer ${expected}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const since = url.searchParams.get('since');
    const until = url.searchParams.get('until');
    const funnel = url.searchParams.get('funnel');
    const eventType = url.searchParams.get('eventType') as MarketingEventType | null;
    const cursor = url.searchParams.get('cursor');
    const limitRaw = parseInt(url.searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10);
    const limit = Math.min(Math.max(1, limitRaw), MAX_LIMIT);

    // Determina il "campo data" e i filtri di stato in base a eventType.
    // Se eventType non è specificato, ritorna tutti i lead modificati nel range — l'envelope viene scelto in base allo stato corrente.
    const conditions: SQL[] = [];

    let dateField = leads.updatedAt;
    if (eventType === 'appointment.set') {
        dateField = leads.appointmentCreatedAt;
        conditions.push(isNotNull(leads.appointmentDate));
    } else if (eventType === 'appointment.outcome') {
        dateField = leads.confirmationsTimestamp;
        conditions.push(isNotNull(leads.confirmationsOutcome));
    } else if (eventType === 'deal.assigned') {
        dateField = leads.salespersonAssignedAt;
        conditions.push(isNotNull(leads.salespersonUserId));
    } else if (eventType === 'deal.closed_won') {
        dateField = leads.salespersonOutcomeAt;
        conditions.push(eq(leads.salespersonOutcome, 'Chiuso'));
    } else if (eventType === 'deal.closed_lost') {
        dateField = leads.salespersonOutcomeAt;
        // Lost = Non chiuso O Sparito (manageremo entrambi i valori)
    }

    if (since) conditions.push(gte(dateField, new Date(since)));
    if (until) conditions.push(lte(dateField, new Date(until)));
    if (funnel) conditions.push(eq(leads.funnel, funnel));
    if (cursor) conditions.push(gt(leads.id, cursor));

    // Special case deal.closed_lost (OR su 2 valori)
    // Per semplicità V1: se eventType=deal.closed_lost, filtriamo a livello applicativo dopo la fetch
    const rows = await db.select().from(leads)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(leads.id))
        .limit(limit + 1);

    let filtered = rows;
    if (eventType === 'deal.closed_lost') {
        filtered = rows.filter(l => l.salespersonOutcome === 'Non chiuso' || l.salespersonOutcome === 'Sparito');
    }

    const hasMore = filtered.length > limit;
    const items = filtered.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    // Carica gli actors per i lead in batch (best effort, alcuni potrebbero essere null)
    const actorIds = new Set<string>();
    for (const l of items) {
        if (l.assignedToId) actorIds.add(l.assignedToId);
        if (l.confirmationsUserId) actorIds.add(l.confirmationsUserId);
        if (l.salespersonUserId) actorIds.add(l.salespersonUserId);
    }
    const actorsMap = new Map<string, { id: string; name: string | null; displayName: string | null; role: string }>();
    if (actorIds.size > 0) {
        const us = await db.select({
            id: users.id, name: users.name, displayName: users.displayName, role: users.role,
        }).from(users);
        for (const u of us) {
            if (actorIds.has(u.id)) actorsMap.set(u.id, u);
        }
    }

    const envelopes = items.map(lead => {
        const ctx = (actorId: string | null) => ({
            lead,
            actor: actorId ? (actorsMap.get(actorId) ?? null) : null,
        });
        switch (eventType) {
            case 'appointment.set':       return buildAppointmentSet(ctx(lead.assignedToId));
            case 'appointment.outcome':   return buildAppointmentOutcome(ctx(lead.confirmationsUserId));
            case 'deal.assigned':         return buildDealAssigned(ctx(lead.salespersonUserId));
            case 'deal.closed_won':       return buildDealClosedWon(ctx(lead.salespersonUserId));
            case 'deal.closed_lost':      return buildDealClosedLost(ctx(lead.salespersonUserId));
            default:
                // Senza eventType, deduce: il PIÙ AVANZATO stato disponibile
                if (lead.salespersonOutcome === 'Chiuso')
                    return buildDealClosedWon(ctx(lead.salespersonUserId));
                if (lead.salespersonOutcome === 'Non chiuso' || lead.salespersonOutcome === 'Sparito')
                    return buildDealClosedLost(ctx(lead.salespersonUserId));
                if (lead.salespersonUserId)
                    return buildDealAssigned(ctx(lead.salespersonUserId));
                if (lead.confirmationsOutcome)
                    return buildAppointmentOutcome(ctx(lead.confirmationsUserId));
                if (lead.appointmentDate)
                    return buildAppointmentSet(ctx(lead.assignedToId));
                return null;
        }
    }).filter(x => x !== null);

    return NextResponse.json({ items: envelopes, nextCursor, hasMore });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/marketing/leads/route.ts
git commit -m "feat(marketing-webhooks): add PULL endpoint for backfill"
```

---

## Task 14: Doc env vars

**Files:**
- Create: `docs/MARKETING-WEBHOOKS-ENV.md`

- [ ] **Step 1: Creare la guida env vars**

```md
# Marketing Webhooks — Setup Env Vars

Per attivare l'invio dei webhook al CRM marketing esterno, settare in Vercel
(Project Settings → Environment Variables, scope: Production + Preview):

| Variabile | Valore | Scope |
|---|---|---|
| `MARKETING_WEBHOOK_ENABLED` | `true` (kill-switch globale) | Production |
| `MARKETING_WEBHOOK_URL_PROD` | URL del receiver del marketing | Production |
| `MARKETING_WEBHOOK_URL_TEST` | URL receiver di staging (se esiste) | Preview |
| `MARKETING_WEBHOOK_SECRET` | 64 hex char (generato Task 0) | Production + Preview |
| `MARKETING_PULL_API_TOKEN` | base64url 32 byte (generato Task 0) | Production + Preview |
| `CRON_SECRET` | base64url 32 byte (generato Task 0) | Production |

## Test locale

In `.env.local` (NON commitare):

```bash
MARKETING_WEBHOOK_ENABLED=true
MARKETING_WEBHOOK_URL_PROD=https://webhook.site/<your-uuid>
MARKETING_WEBHOOK_SECRET=<hex 64>
MARKETING_PULL_API_TOKEN=<base64url 32>
CRON_SECRET=<base64url 32>
```

Avvia `npm run dev`, poi triggera un evento dal CRM (es. fissa un appuntamento)
e verifica su webhook.site che il POST sia arrivato firmato.

## Disattivare temporaneamente

Settare `MARKETING_WEBHOOK_ENABLED=false` su Vercel e fare redeploy.
Gli eventi non vengono più enqueued. Le righe già in coda restano in stato
`pending` ma il cron skippa la consegna finché il flag torna `true`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/MARKETING-WEBHOOKS-ENV.md
git commit -m "docs(marketing-webhooks): env var setup guide"
```

---

## Task 15: QA pre-go-live (manuale, prima dell'attivazione in prod)

**Files:**
- (nessuno — solo verifiche manuali)

- [ ] **Step 1: Setup env vars locali con webhook.site**

Andare su https://webhook.site, copiare la URL univoca, settarla in `.env.local` come `MARKETING_WEBHOOK_URL_PROD`. Settare `MARKETING_WEBHOOK_ENABLED=true`.

- [ ] **Step 2: Avviare dev server**

Run: `npm run dev`
Expected: dev server up su http://localhost:3000.

- [ ] **Step 3: Trigger via debug endpoint**

Loggati come MANAGER nel CRM. In una console browser sulla pagina del CRM:

```js
fetch('/api/marketing/_debug/send-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType: 'appointment.set', leadId: '<un-lead-id-reale>' })
}).then(r => r.json()).then(console.log);
```

Expected: `{ enqueued: true }`.

- [ ] **Step 4: Verifica su webhook.site**

Sulla pagina webhook.site dovrebbe apparire una richiesta POST con:
- Body JSON con eventId, eventType: 'appointment.set', lead: {...}, data: {...}
- Headers: `X-CRM-Event-Id`, `X-CRM-Event-Type: appointment.set`, `X-CRM-Timestamp`, `X-CRM-Signature: sha256=...`

- [ ] **Step 5: Verifica DB**

Query in Supabase:

```sql
SELECT id, "eventType", status, attempts, "deliveredAt", "lastResponseStatus"
FROM "marketingWebhookDeliveries"
ORDER BY "createdAt" DESC
LIMIT 5;
```

Expected: la riga corrispondente con `status='delivered'`, `attempts=1`, `lastResponseStatus=200`.

- [ ] **Step 6: Test retry — forzare 500 dal receiver**

Su webhook.site, configurare risposta custom HTTP 500. Triggera un altro evento. Verifica:
- DB: status='pending', attempts=1, nextAttemptAt = now+1min, lastResponseStatus=500
- Aspetta che il cron giri (o triggera manualmente con `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/marketing-webhooks-drain`)
- Dopo il giro: attempts=2, nextAttemptAt = now+5min

- [ ] **Step 7: Test E2E reale**

Riportare URL su webhook.site (200 ok). Esegui un flow completo:
1. Crea/scegli un lead di test
2. Fissa un appuntamento → verifica `appointment.set`
3. Conferma da team Conferme con esito `confermato` + assegna venditore → verifica `appointment.outcome` + `deal.assigned`
4. Da venditore, chiudi `Chiuso` con prodotto e amount → verifica `deal.closed_won`

Tutti e 4 (anzi 4-5 webhook) dovrebbero arrivare in webhook.site nell'ordine corretto.

- [ ] **Step 8: Test PULL endpoint**

```bash
curl -H "Authorization: Bearer $MARKETING_PULL_API_TOKEN" \
     "http://localhost:3000/api/marketing/leads?eventType=deal.closed_won&limit=10"
```

Expected: JSON `{ items: [...], nextCursor: ..., hasMore: ... }` con N envelope già firmabili (formato uguale al webhook payload).

- [ ] **Step 9: Verificare che con kill-switch off NIENTE accada**

Setta `MARKETING_WEBHOOK_ENABLED=false` in `.env.local`, restart dev. Triggera evento. Verifica:
- DB: NESSUNA nuova riga in `marketingWebhookDeliveries`
- webhook.site: NESSUN POST

- [ ] **Step 10: Re-enable + commit messaggio finale**

Riportare `.env.local` a `true`. Nessun commit (env vars non sono in git).

---

## Task 16: Comunicare allo sviluppatore marketing + go-live

**Files:**
- (nessuno)

- [ ] **Step 1: Mandare il secret HMAC + URL convenuti**

Via canale sicuro (Bitwarden/1Password/Signal — NON email/Slack DM):
- Secret HMAC (`MARKETING_WEBHOOK_SECRET` valore generato Task 0)
- (Opzionale) PULL API token se gli serve fare backfill o riconciliare

- [ ] **Step 2: Mandare schema dei payload**

Condividere il file `docs/superpowers/specs/2026-05-07-marketing-webhooks-design.md` (sezione 5 + 6) per riferimento.

- [ ] **Step 3: Test congiunto contro endpoint staging**

Settare `MARKETING_WEBHOOK_URL_PROD` su Vercel preview = URL staging del marketing. Fare un deploy preview. Inviare evento di test via debug endpoint. Loro confermano ricezione + firma valida + dedup.

- [ ] **Step 4: Configurare prod su Vercel**

Una volta confermato funzionamento staging:
- Settare `MARKETING_WEBHOOK_URL_PROD` su Vercel Production = URL prod del marketing
- Settare `MARKETING_WEBHOOK_ENABLED=true` su Vercel Production
- Promuovere il deploy da preview a production (o redeploy main)

- [ ] **Step 5: Monitor 7 giorni**

Query giornaliera:

```sql
SELECT status, COUNT(*) FROM "marketingWebhookDeliveries"
WHERE "createdAt" > now() - interval '24 hours'
GROUP BY status;
```

Aspettativa: ~95%+ `delivered`, eventuali `pending` momentanei (drenati al cron successivo), zero `dead` o `failed_permanent`.

Se appaiono `dead` o `failed_permanent`, esaminare `lastError` e `lastResponseStatus` e contattare lo sviluppatore marketing.

---

## Self-review checklist (post-write)

- [x] Tutti i 5 eventi del design coperti (Task 7-9)
- [x] Tabella outbox creata in DB + schema (Task 1)
- [x] HMAC sign + verify (Task 3)
- [x] Idempotenza via deterministic eventId + ON CONFLICT DO NOTHING (Task 4 + 6)
- [x] Retry esponenziale con DLQ (Task 5 + 10)
- [x] Kill-switch (Task 6 + 10)
- [x] Cron config (Task 11)
- [x] PULL endpoint (Task 13)
- [x] QA E2E manuale (Task 15)
- [x] Go-live procedurale (Task 16)
- [x] Nessun placeholder TBD/TODO non risolto
- [x] Type consistency: `MarketingEventType`, `EnqueueInput`, `MarketingWebhookEnvelope` usati uniformemente
- [x] No test framework in progetto → TDD sostituito con type-check + smoke + E2E manuale (esplicitato all'inizio)
