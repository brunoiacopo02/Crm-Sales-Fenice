# Marketing Webhooks & PULL API — Design Doc

**Data**: 2026-05-07
**Owner**: Bruno
**Status**: Draft, in attesa di approvazione utente
**Target**: Esporre eventi del funnel CRM Fenice al sistema marketing esterno (`https://dashboardmarketingvendita.vercel.app`).

---

## 1. Goal

Permettere al CRM marketing esterno di ricevere in **tempo reale** gli eventi chiave del funnel di vendita CRM Fenice, così che possano:
- Aggiornare audience custom / lookalike per ads.
- Misurare ROI per funnel (spesa ads → fatturato chiuso).
- Triggerare campagne post-chiusura / nurturing post-perso.
- Riconciliare attribuzione UTM lato marketing.

## 2. Non-goals (V1)

- **No backfill** dello storico: si parte dagli eventi che scattano dal go-live in poi.
- **No** sincronizzazione bidirezionale (il marketing non scrive nel CRM).
- **No** webhook per eventi del `customerPortfolios` (SMM post-vendita): scope futuro.
- **No** sondaggi (`gdoLeadSurveys`, ecc.): scope futuro se richiesto.
- **No** GDPR right-to-be-forgotten cascade: gestito manualmente in V1.

## 3. Architettura

```
┌──────────────────────────┐         ┌──────────────────────────────┐
│ Server Action CRM Fenice │         │  Marketing CRM (Vercel)      │
│ (es. setAppointment,     │         │  POST /api/webhooks/         │
│  confermaAppuntamento,   │         │       crm-fenice             │
│  chiudiVendita, …)       │         └──────────────────────────────┘
└────────────┬─────────────┘                       ▲
             │ enqueue (sync)                      │
             ▼                                     │ HTTPS POST (HMAC-SHA256)
┌──────────────────────────┐                       │
│ marketingWebhookDeliveries│                      │
│ (Postgres, Drizzle)      │                       │
└────────────┬─────────────┘                       │
             │ pending=true                        │
             ▼                                     │
┌──────────────────────────┐    next/after:        │
│ Vercel Cron / waitUntil  │────────────────────────┘
│ Worker drainer           │   exponential backoff
│ (Fluid Compute, 60s tick)│   1m → 5m → 30m → 2h → 6h → DLQ
└──────────────────────────┘

GET /api/marketing/leads?since=…&cursor=…  ◄── PULL backfill, Bearer token
```

**Filosofia**: il server action **non si blocca** sulla consegna del webhook. Inserisce la riga in `marketingWebhookDeliveries` (transazione locale, sub-millisecondo) e ritorna. Un worker async drena la coda con retry e backoff. Questo isolamento garantisce che un downtime del marketing **non rompa mai** il CRM.

## 4. Event taxonomy (V1)

| `eventType` | Trigger DB | Server action sorgente |
|---|---|---|
| `appointment.set` | `leads.appointmentDate` valorizzato (prima era NULL o cambiato) | `appointmentActions.setAppointment` |
| `appointment.outcome` | `leads.confirmationsOutcome` valorizzato dal team Conferme | `confermeActions.setConfirmationsOutcome` |
| `deal.assigned` | `leads.salespersonUserId` valorizzato (assegnazione venditore) | `confermeActions.assignToSalesperson` (o equivalente) |
| `deal.closed_won` | `leads.salespersonOutcome = 'Chiuso'` | `venditoreActions.setSalespersonOutcome` |
| `deal.closed_lost` | `leads.salespersonOutcome IN ('Non chiuso', 'Sparito')` | `venditoreActions.setSalespersonOutcome` |

**Regola chiave**: ogni evento corrisponde a **una transizione di stato**, non al valore corrente. Se un appuntamento viene **rifissato** (cambia `appointmentDate`), si invia un altro `appointment.set` con `eventId` diverso e payload aggiornato. Il marketing deduplica per `eventId`, non per `leadId`.

## 5. Payload schemas (JSON)

### Common envelope (presente in tutti gli eventi)

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "appointment.set",
  "occurredAt": "2026-05-07T10:14:32.123Z",
  "apiVersion": "1",
  "lead": {
    "id": "lead_abc123",
    "name": "Mario Rossi",
    "email": "mario.rossi@example.com",
    "phone": "+393331234567",
    "funnel": "ECOMMERCE",
    "source": "activecampaign",
    "createdAt": "2026-04-30T09:00:00.000Z",
    "utm": {
      "source": "facebook",
      "medium": "cpc",
      "campaign": "spring-2026",
      "content": "video-ad-3",
      "term": null
    }
  },
  "data": { /* event-specific, vedi sotto */ }
}
```

### `appointment.set`

```json
{
  "data": {
    "appointmentDate": "2026-05-12T15:30:00.000Z",
    "appointmentNote": "Preferisce videochiamata",
    "appointmentCreatedAt": "2026-05-07T10:14:32.000Z",
    "callCount": 2,
    "setBy": {
      "userId": "user_xyz",
      "displayName": "Sara (GDO #105)",
      "role": "GDO"
    }
  }
}
```

### `appointment.outcome`

```json
{
  "data": {
    "status": "CONFERMATO",            // 'CONFERMATO' | 'NON_CONFERMATO' | 'DA_RIFISSARE'
    "rawOutcome": "Confermato",         // valore raw da confirmationsOutcome
    "discardReason": null,              // valorizzato se NON_CONFERMATO
    "decidedAt": "2026-05-08T11:20:00.000Z",
    "appointmentDate": "2026-05-12T15:30:00.000Z",
    "decidedBy": {
      "userId": "user_conf01",
      "displayName": "Luca (Conferme)",
      "role": "CONFERME"
    }
  }
}
```

**Mapping `confirmationsOutcome` → `status`** (TBD-confermare valori reali in DB durante implementazione):
- `"Confermato"` → `CONFERMATO`
- `"Non confermato"` / `"Sparito"` → `NON_CONFERMATO`
- `"Da rifissare"` → `DA_RIFISSARE`

### `deal.assigned`

```json
{
  "data": {
    "assignedAt": "2026-05-09T14:00:00.000Z",
    "salesperson": {
      "userId": "user_sales04",
      "displayName": "Marco (Sales 004)",
      "role": "VENDITORE"
    }
  }
}
```

### `deal.closed_won`

```json
{
  "data": {
    "closedAt": "2026-05-12T17:45:00.000Z",
    "product": "gold",                  // 'advance' | 'gold' | 'exclusive'
    "amountEur": 4500.00,
    "notes": "Cliente paga 50% upfront",
    "salesperson": {
      "userId": "user_sales04",
      "displayName": "Marco (Sales 004)",
      "role": "VENDITORE"
    }
  }
}
```

### `deal.closed_lost`

```json
{
  "data": {
    "closedAt": "2026-05-12T17:45:00.000Z",
    "outcome": "Non chiuso",            // 'Non chiuso' | 'Sparito'
    "reason": "Prezzo troppo alto",     // notClosedReason
    "notes": "Promette di richiamare a settembre",
    "salesperson": {
      "userId": "user_sales04",
      "displayName": "Marco (Sales 004)",
      "role": "VENDITORE"
    }
  }
}
```

## 6. HMAC signing & headers

Ogni POST include questi headers:

| Header | Esempio | Note |
|---|---|---|
| `Content-Type` | `application/json` | UTF-8 |
| `User-Agent` | `CrmFenice-Webhooks/1.0` | identificazione |
| `X-CRM-Event-Id` | UUID v4 | duplicato in body, per dedup |
| `X-CRM-Event-Type` | `appointment.set` | uno dei 5 valori |
| `X-CRM-Timestamp` | `1715074472` | unix seconds, anti-replay |
| `X-CRM-Signature` | `sha256=abc123…` | HMAC del body |

**Algoritmo firma**:
```ts
const stringToSign = `${timestamp}.${rawBody}`;
const signature = `sha256=${hmacSha256(secret, stringToSign).toString('hex')}`;
```

Il marketing deve:
1. Verificare che `X-CRM-Timestamp` sia entro ±5 minuti dal proprio `now()` (anti-replay).
2. Ricalcolare la firma sul body raw e confrontare con `X-CRM-Signature` in costant-time (`crypto.timingSafeEqual`).
3. Rifiutare con `401` se firma non valida.

**Secret**: 32 byte random hex (64 char). Generato da noi, condiviso via canale sicuro (Bitwarden/1Password/Signal — **non** email, **non** Slack DM). Memorizzato in env var `MARKETING_WEBHOOK_SECRET` (CRM Fenice) e analoga lato loro.

## 7. Retry policy

| Tentativo | Delay dal precedente | Cumulativo |
|---|---|---|
| 1 | immediato | 0 |
| 2 | 1 min | 1 min |
| 3 | 5 min | 6 min |
| 4 | 30 min | 36 min |
| 5 | 2 ore | ~2.5 ore |
| 6 | 6 ore | ~8.5 ore |
| DLQ | — | dopo 6 fallimenti, marca `status='dead'` e alert manager |

**Cosa conta come fallimento**:
- HTTP 5xx → retry
- Timeout > 10s → retry
- HTTP 4xx (eccetto 429) → **niente retry**, marca `status='failed_permanent'`. Il marketing ha rifiutato per validazione/firma → fix umano richiesto.
- HTTP 429 → retry rispettando `Retry-After` header se presente.

**Worker**: Vercel Cron (`* * * * *` = ogni minuto). Query `WHERE status='pending' AND nextAttemptAt <= now()` LIMIT 50. Inviato in parallelo (Promise.allSettled). Aggiorna stato a `delivered` / `pending` (con next attempt aggiornato) / `dead`.

**In aggiunta al cron**: invio "speculativo" inline tramite `waitUntil()` di Vercel (Fluid Compute) **subito dopo** l'enqueue. Se va al primo colpo, marca subito `delivered` senza aspettare il cron. Best of both worlds: latenza low quando tutto va bene, robustezza quando qualcosa rompe.

## 8. PULL endpoint (backfill / recovery)

```
GET /api/marketing/leads
  ?since=2026-05-01T00:00:00Z   // ISO timestamp, optional
  &until=2026-05-31T23:59:59Z   // ISO timestamp, optional
  &funnel=ECOMMERCE             // optional, esatto match
  &eventType=deal.closed_won    // optional, filtra per stato finale
  &cursor=lead_xxx              // optional, paginazione
  &limit=100                    // default 100, max 500
```

**Auth**: header `Authorization: Bearer <token>`. Token in env var `MARKETING_PULL_API_TOKEN`. **Non lo stesso** del webhook secret.

**Response**:
```json
{
  "items": [ /* array di payload formato uguale al webhook (envelope + data) */ ],
  "nextCursor": "lead_yyy",   // null se non ci sono altre pagine
  "hasMore": true
}
```

**Source of truth**: la tabella `leads` direttamente (non `marketingWebhookDeliveries`). Il PULL è una vista dei lead nello stato richiesto, **non** un replay degli eventi inviati. Questo evita lock-in fra storico webhook e storico DB.

**Rate limit**: 60 req/min per token. Ritorna 429 con `Retry-After` se sforato.

## 9. Nuova tabella Drizzle

```ts
// src/db/schema.ts
export const marketingWebhookDeliveries = pgTable('marketingWebhookDeliveries', {
    id: text('id').primaryKey(),                                   // = eventId (UUID v4)
    eventType: text('eventType').notNull(),                        // 'appointment.set' | …
    leadId: text('leadId').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),                           // envelope completo, già firmabile
    targetUrl: text('targetUrl').notNull(),                        // URL del receiver (snapshot al momento dell'enqueue)

    status: text('status').default('pending').notNull(),           // 'pending' | 'delivered' | 'failed_permanent' | 'dead'
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: timestamp('lastAttemptAt', { withTimezone: true, mode: 'date' }),
    nextAttemptAt: timestamp('nextAttemptAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    deliveredAt: timestamp('deliveredAt', { withTimezone: true, mode: 'date' }),

    lastResponseStatus: integer('lastResponseStatus'),             // HTTP code dell'ultimo tentativo
    lastError: text('lastError'),                                  // body o error message dell'ultimo fallimento (truncato a 1000 char)

    createdAt: timestamp('createdAt', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
}, (t) => ({
    statusNextIdx: index('mkt_webhook_status_next_idx').on(t.status, t.nextAttemptAt),
    leadIdx: index('mkt_webhook_lead_idx').on(t.leadId),
    eventTypeIdx: index('mkt_webhook_event_type_idx').on(t.eventType),
}));
```

L'indice composito `(status, nextAttemptAt)` rende la query del worker O(log n) anche con milioni di righe.

## 10. Server action hook points

Modifiche **minimali**, una sola riga aggiunta in fondo a ogni server action interessato:

```ts
// src/app/actions/appointmentActions.ts (estratto)
export async function setAppointment(input: SetAppointmentInput) {
    // … codice esistente di update DB …
    await db.update(leads).set({ appointmentDate: input.date, /* … */ }).where(...);

    // NUOVO: enqueue webhook (non-blocking, non rompe il flow se fallisce)
    waitUntil(enqueueMarketingWebhook({
        eventType: 'appointment.set',
        leadId: input.leadId,
    }));

    revalidatePath(...);
    return { success: true };
}
```

`enqueueMarketingWebhook` (in `src/lib/marketing-webhooks.ts`):
1. Carica il lead (snapshot completo) con relazioni minime (user del setter).
2. Costruisce l'envelope.
3. Inserisce riga in `marketingWebhookDeliveries` (status=pending, nextAttemptAt=now).
4. Tenta consegna inline (best effort, 5s timeout). Se ok, marca `delivered`. Se ko, lascia `pending` per il cron.

**Hook points concreti**:
- `appointment.set` → `appointmentActions.ts` (al momento dell'update di `appointmentDate`)
- `appointment.outcome` → `confermeActions.ts` (dove si scrive `confirmationsOutcome`)
- `deal.assigned` → `confermeActions.ts` o `venditoreActions.ts` (dove si scrive `salespersonUserId`)
- `deal.closed_won` / `deal.closed_lost` → `venditoreActions.ts` (dove si scrive `salespersonOutcome`)

**Idempotenza enqueue**: se un server action viene eseguito due volte con lo stesso input (doppio click utente), si genera **un solo** evento. Realizzato calcolando `eventId` come UUID **deterministico** dai campi (eventType + leadId + occurredAt al secondo). Collisione = stesso evento → la tabella ha PK su `id`, il secondo INSERT fa ON CONFLICT DO NOTHING.

## 11. Configuration (env vars)

| Var | Esempio | Note |
|---|---|---|
| `MARKETING_WEBHOOK_URL_PROD` | `https://dashboardmarketingvendita.vercel.app/api/webhooks/crm-fenice` | URL prod |
| `MARKETING_WEBHOOK_URL_TEST` | `https://…/api/webhooks/crm-fenice-test` | optional, usato in preview deployments |
| `MARKETING_WEBHOOK_SECRET` | `<64 hex char>` | HMAC secret |
| `MARKETING_WEBHOOK_ENABLED` | `true` / `false` | kill-switch globale |
| `MARKETING_PULL_API_TOKEN` | `<random 32 byte b64>` | per il PULL endpoint |

In Vercel: settati a livello environment `Production` e `Preview`. **Non** mettere in `.env.local` versionato.

## 12. Rollout plan

1. **Sprint 0** (dev locale, ~2 ore): tabella + libreria `marketing-webhooks.ts` + endpoint test interno (`/api/marketing/_debug/send-test`).
2. **Sprint 1** (~1 giorno): hook nei 4 server action, dietro feature flag `MARKETING_WEBHOOK_ENABLED=false` di default. PR su staging Vercel.
3. **Sprint 2** (~30 min): PULL endpoint + auth Bearer + rate limit.
4. **Sprint 3** (~1 ora): cron drainer su Vercel Cron, monitoring (log + DLQ alert).
5. **Sync col marketing dev**: scambiamo URL receiver + secret.
6. **QA congiunto** (~30 min): inviamo eventi finti dal `/api/marketing/_debug/send-test`, lui verifica firma e dedup.
7. **Go-live**: settiamo `MARKETING_WEBHOOK_ENABLED=true` in production. Da quel momento in poi tutti gli eventi reali fluiscono.
8. **Monitoring 7 giorni**: dashboard interna che mostra `count(*) by status` su `marketingWebhookDeliveries` ultimi 7g.

## 13. Testing strategy

- **Unit**: HMAC firma + verifica round-trip, costruzione envelope, dedup eventId.
- **Integration**: hit `/api/marketing/_debug/send-test` contro `webhook.site` (URL temporanea), verifica payload manualmente.
- **E2E**: in staging, esegui un flow completo (crea lead → set appt → conferma → assegna → chiudi vinto) e verifica le 5 righe `delivered` in `marketingWebhookDeliveries`.
- **Resilience**: forza un ritorno 500 dal receiver di test, verifica che retry parta correttamente con backoff.

## 14. Open questions / future scope

- **`customerPortfolios` events**: se il marketing vuole anche eventi sul follow-up post-vendita SMM (`portfolio.appointment_set`, `portfolio.upsell_won`), aggiungere V2.
- **Sondaggi**: se vogliono signal qualitativi (es. fascia età, motivazione), V2.
- **GDPR delete cascade**: quando un lead viene cancellato per richiesta utente, mandare `lead.deleted` evento. V2.
- **Backfill on demand**: se in futuro serve, esiste già il PULL endpoint — basta che il marketing chiami `/api/marketing/leads?since=...`.
- **Bidirezionale**: se il marketing ha info da spingere indietro (es. tagging audience), serve un endpoint INBOUND lato CRM. Out of scope V1.

## 15. Cosa serve dallo sviluppatore marketing (riferimento)

Già comunicato in chat — riassunto:

**Da CREARE lato loro:**
1. Endpoint `POST /api/webhooks/crm-fenice` (HTTPS, dedup per `X-CRM-Event-Id`, verifica HMAC, timeout 10s).
2. (Opzionale) Endpoint `/api/webhooks/crm-fenice-test` per staging.

**Da FORNIRE a noi:**
3. URL definitivo prod (e test se ne hanno).
4. Conferma supporto HMAC-SHA256 con secret condiviso.
5. (Opzionale) IP allowlist se la vogliono.

**Da CONFERMARE:**
6. Codici risposta gestiti (2xx ok, 4xx perma-fail, 5xx/timeout retry).
