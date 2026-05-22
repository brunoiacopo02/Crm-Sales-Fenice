# Merge CRM Marketing dentro Fenice CRM — Design Doc

**Data**: 2026-05-21
**Owner**: Bruno + Claude
**Deadline duro**: <2026-06-04 — Serenamente inizia a vendere e ha bisogno di tenancy isolata sul lato sales
**Status**: Design approvato in decisioni 1-4, implementazione non ancora iniziata

---

## TL;DR

Assorbiamo `feniceacademy/crm-marketing` dentro questo repo. Tutta la UI marketing vive sotto `/marketing/*` con sidebar, account e RBAC isolati. Lo schema marketing (16 tavoli) entra in `src/db/schema.ts` come Drizzle. Migriamo dati dal loro Supabase (project `njdgmwjbgfzdtopkdswj`) dentro il nostro. Sui tavoli sales esistenti retrofittiamo `companyId text` con default `'fenice'` per compatibilità retroattiva. Tutti gli account marketing diventano utenti Supabase Auth con un campo `area` che li isola dal sales (e viceversa, eccetto super-admin = Bruno). Il sistema attuale di webhook `Sales → enqueue → outbox → POST → marketing receiver` diventa **una singola chiamata in-process** `ingestCrmEvent()` e tutto il codice in `src/lib/marketing-webhooks/*` viene rimosso (-1500 righe).

**Stima onesta**: 16 giorni-dev per il retrofit completo + integrazione. **Deadline**: 14 giorni. Mancano 2 giorni. Due tagli pragmatici (skip PK rebuild + gamification per Serenamente disabilitata al go-live) riportano a **9-10 giorni** — fattibile.

---

## 1. Contesto e obiettivi

### Perché lo facciamo

- Coordinare marketing e vendite: oggi i due team usano CRM separati e si scambiano dati via webhook HMAC con un outbox cron-driven. Errori e ritardi.
- Database condiviso: leggere attribution UTM → lead → appuntamento → deal in una singola query JOIN, non in due sistemi.
- Multi-tenant pulito: Serenamente va live tra 2 settimane. Senza retrofit, i lead Serenamente non hanno dove vivere correttamente nel CRM sales (oggi tutto è implicitamente `fenice`).
- Manutenzione: un solo deploy Vercel, un solo Supabase, un solo CI/CD.

### Cosa NON è in scope

- Migrare i dati Meta/AC storici precedenti al `BACKFILL_FROM_ISO='2026-03-01'` (oggi il marketing CRM ha questo limite hardcoded — lo manteniamo).
- Rifare il sistema gamification per supportare leaderboard cross-tenant (per Serenamente al go-live, gamification disabilitata).
- Migrare i social IG/TikTok endpoint che oggi tornano mock — restano come sono.
- Implementare RLS Supabase come gate primario di sicurezza. Restiamo sull'isolamento applicativo come fa il marketing CRM. RLS sarà eventualmente safety-net in fase 2.

### Successo

- Marketing accede a `/marketing/*` con account propri e vede SOLO il marketing.
- Sales accede a `/` (root) con account esistenti e vede SOLO il sales.
- Bruno (super-admin) vede entrambi.
- Lead Serenamente entrano correttamente, sono visibili solo a operatori Serenamente, generano gamification scoped a Serenamente (o nessuna gamification, vedi shortcut).
- Cron Meta/AC schedulati funzionano nel monorepo target, dati confluiscono in tavoli marketing nel nostro Supabase.
- Zero leak cross-tenant (Serenamente non vede lead Fenice e viceversa).

---

## 2. Decisioni prese (2026-05-21)

| # | Decisione | Scelta | Rationale |
|---|---|---|---|
| 1 | ORM per tavoli marketing | **Port a Drizzle** | Coerenza > velocità. Le loro query supabase-js sono ~75 totali, portabili in 2-3 giorni. Codebase uniforme. |
| 2 | DB unico vs due Supabase | **Unico (il nostro)** | Permette JOIN sales × marketing. Niente cross-project queries (impossibili). Migrazione dati one-shot. |
| 3 | Multi-tenancy retrofit sales | **Subito, non rimandato** | Serenamente vende entro 2026-06-04. Senza `companyId` esplicito, no isolamento. |
| 4 | URL/account marketing | **`/marketing/*` con account isolati** | Layout separato + middleware role-gating. Solo Bruno è super-admin cross-area. |

---

## 3. Architettura target

```
                      Fenice CRM monorepo (questo repo)
   ┌───────────────────────────────────────────────────────────────┐
   │                                                                │
   │  /                          /marketing/                       │
   │  ├── /pipeline-gdo          ├── /dashboard                    │
   │  ├── /conferme              ├── /creative                     │
   │  ├── /vendite               ├── /trend                        │
   │  ├── /store                 ├── /manager                      │
   │  ├── /panoramica            ├── /alert                        │
   │  ├── ...                    ├── ...                           │
   │  Sidebar SALES              Sidebar MARKETING                 │
   │  Ruoli: GDO/CONF/VEND/MGR   Ruoli: media_buyer/copy/...       │
   │                                                                │
   │       └────────── shared Supabase Auth ──────────┘            │
   │                  user_metadata.area = 'sales' | 'marketing'   │
   │                                       | 'both' (Bruno)         │
   │                                                                │
   │   Server Actions sales       /marketing/api/* routes           │
   │   import @/db/schema         import @/db/schema                │
   │                                                                │
   │   ┌────────── shared Drizzle schema (src/db/schema.ts) ─────┐ │
   │   │  TAVOLI SALES (40)             TAVOLI MARKETING (16)    │ │
   │   │  + companyId text              companyId text già PK    │ │
   │   │  ├── leads                     ├── companies            │ │
   │   │  ├── users (+ area)            ├── company_funnels      │ │
   │   │  ├── events                    ├── ac_contacts          │ │
   │   │  ├── gamification_actions      ├── ac_daily_metrics     │ │
   │   │  ├── ...                       ├── ac_sync_state        │ │
   │   │                                ├── ads_daily_insights   │ │
   │   │                                ├── ads_daily_fetches    │ │
   │   │                                ├── meta_account_daily   │ │
   │   │                                ├── marketing_targets    │ │
   │   │                                ├── ad_scripts           │ │
   │   │                                ├── crm_events           │ │
   │   │                                ├── crm_appointments⚠    │ │
   │   │                                └── crm_deals⚠           │ │
   │   │                          ⚠ probabilmente eliminabili    │ │
   │   │                            (vedi §5 sotto)              │ │
   │   └─────────────────────────────────────────────────────────┘ │
   │                                                                │
   │   2 cron Vercel: sync-ac-contacts 02:00, refresh-meta 02:30   │
   │   ─ Marketing webhooks legacy: ELIMINATI ─                    │
   │                                                                │
   └───────────────────────────────────────────────────────────────┘
                              │
                              ▼
                ┌──────────────────────────┐
                │  Supabase (project nostro)│
                │  schema public            │
                │  16 marketing tables +    │
                │  40 sales tables          │
                │  Tutte con companyId       │
                │  Auth: utenti merged       │
                └──────────────────────────┘
```

### Isolamento sales ↔ marketing (3 layer)

1. **Middleware** (`src/middleware.ts`): se URL inizia con `/marketing/*` e `user.area NOT INCLUDE 'marketing'` → 403. Se URL è sales root e `user.area NOT INCLUDE 'sales'` → 403. Bruno ha `area = ['sales','marketing']` (alias `'both'`).
2. **Server Action guards**: ogni action sales chiama `assertSalesArea(user)`, ogni route marketing chiama `assertMarketingArea(user)`. Throw 403 prima di toccare DB.
3. **Sidebar/Layout separati**: route group `(sales)` e `(marketing)` con layout distinti. Una sidebar non appare nell'area dell'altra per costruzione.

Niente RLS Supabase per ora — coerente col pattern del marketing CRM. RLS resta safety-net da aggiungere in fase 2 (dopo go-live).

---

## 4. Schema mapping: tavoli marketing → `src/db/schema.ts`

Tutti i tavoli del marketing CRM entrano nello schema Drizzle nostro. Pattern: `companyId text not null references companies.id` come prima colonna, PK composite, indici composti già da migration loro.

| Tavolo SQL marketing | Drizzle table name (proposta) | PK | Note migrazione |
|---|---|---|---|
| `companies` | `companies` | `id` | Seed: fenice, serenamente, fcd |
| `company_funnels` | `companyFunnels` | `(companyId, id)` | Già seedato Fenice (6 funnel) |
| `ac_daily_metrics` | `acDailyMetrics` | `(companyId, funnelId, date, metric)` | Schema EAV con payload jsonb |
| `ac_contacts` | `acContacts` | `(companyId, contactId)` | ~10-50k righe |
| `ac_sync_state` | `acSyncState` | `(companyId, key)` | Cursore incrementale |
| `ads_daily_insights` | `adsDailyInsights` | `(companyId, adId, date)` | ~10-100k righe |
| `ads_daily_fetches` | `adsDailyFetches` | `(companyId, funnelId, date)` | Markers idempotenza |
| `meta_account_daily` | `metaAccountDaily` | `(companyId, accountId, date)` | ~160 righe |
| `marketing_targets` | `marketingTargets` | `(companyId, funnelId, period)` | Target mensili |
| `ad_scripts` | `adScripts` | `id` + idx companyId | Solo idx, no PK composita |
| `crm_events` | `crmEvents` | `eventId` | Append-only event log — **MANTENERE** |
| `crm_appointments` | `crmAppointments` | uuid + unique(companyId, leadId, apptDate) | ⚠ **READ MODEL** — vedi §5 |
| `crm_deals` | `crmDeals` | uuid + unique(companyId, eventId) | ⚠ **READ MODEL** — vedi §5 |

### Decisione su `crm_appointments` e `crm_deals`

Sono read model alimentati dai webhook che oggi **noi** mandiamo dal sales al marketing. Dopo il merge, gli stessi dati vivono nel nostro `leads` + `leadEvents`. Tre opzioni:

- **(A)** Eliminarli completamente e riscrivere ogni reader marketing (`crm-deals-reader.ts`, `getSalesAttributionFromDeals`, ecc.) per query su `leads`. **Costo**: ~1-2 giorni di refactor delle pagine `/vendite` e `/marketing/dashboard`. **Pulizia**: massima.
- **(B)** Mantenerli come read model proiettato in-process dai Server Action sales. `ingestCrmEvent()` chiamato dentro le action di outcome scrive `crm_events` + aggiorna `crm_appointments`/`crm_deals` nella stessa transazione. **Costo**: 0 giorni (codice marketing legge ancora come oggi).
- **(C)** Mantenere `crm_events` come append-only event log, eliminare `crm_appointments`/`crm_deals` e riscrivere reader. Compromesso fra (A) e (B).

**Raccomandazione: (B) per il go-live, (C) come refactor in fase 2.** Motivo: a 14 giorni di deadline, riscrivere i reader marketing è non-essenziale e introduce rischio di regressione. Tenere il read model ridondante è duplicazione di dato (poco), ma il codice marketing resta intoccato. Eliminare i webhook HTTP è il guadagno principale e si ottiene ugualmente.

### Tavoli sales esistenti — vedi §6

---

## 5. Webhook marketing legacy — DA RIMUOVERE

Stato attuale: ogni outcome sales (appointmentSet, appointmentOutcome, dealClosedWon, dealClosedLost) chiama `enqueueMarketingWebhook()` che scrive su tavolo `marketingWebhookDeliveries` (outbox). Un cron `/api/cron/marketing-webhooks-drain` legge le righe, firma HMAC, POSTa al marketing receiver.

**Post-merge**: questo flusso diventa una chiamata in-process. Esempio:

```typescript
// PRIMA (in appointmentActions.ts)
await enqueueMarketingWebhook(db, {
  eventType: 'appointment.set',
  leadId: lead.id,
  payload: buildAppointmentSetPayload(lead, ...),
});

// DOPO
import { ingestCrmEvent } from '@/lib/crm-ingest';
await ingestCrmEvent('fenice', {  // o ctx.companyId
  eventId: crypto.randomUUID(),
  eventType: 'appointment.set',
  occurredAt: new Date().toISOString(),
  apiVersion: '1',
  lead: buildLeadPayload(lead),
  data: { ... },
});
```

`ingestCrmEvent()` è la funzione del marketing CRM che oggi gira sul receiver: scrive `crm_events` (PK = eventId per dedup), poi switch su eventType per aggiornare il read model. Importata nel monorepo, gira nella stessa transazione DB.

**Da eliminare**:
- `src/lib/marketing-webhooks/enqueue.ts`
- `src/lib/marketing-webhooks/payload-builders.ts`
- `src/lib/marketing-webhooks/types.ts`
- `src/lib/marketing-webhooks/deliver.ts` (se esiste)
- `src/lib/marketing-webhooks/signing.ts` (se esiste)
- `src/app/api/marketing/*` (4 endpoint outbox)
- `src/app/api/cron/marketing-webhooks-drain/route.ts`
- Schema `marketingWebhookDeliveries`
- Schema `pipelineSnapshots` — **NO**, questo va mantenuto (è audit lead spariti, unrelated)
- Env vars: `WEBHOOK_SECRET_CRM`, `WEBHOOK_SECRET_CRM_TEST`, `MARKETING_WEBHOOK_URL_*`, `MARKETING_WEBHOOK_ENABLED`
- Script `scripts/backfillMarketingEventsWindow.ts` (era per il backfill 2026-01-01 → 2026-05-07, ormai esaurito)

**Cosa rimane invariato**:
- `crm_events` come append-only event log (utile per replay/audit)
- `crm_appointments` + `crm_deals` come read model (vedi §4 decisione B)
- `ingestCrmEvent()` come unica entry point (sia sincrona da Server Action sia eventualmente esposta come endpoint testing)

**Risparmio**: ~1500 righe di codice + 1 tavolo + 1 cron + 3 env vars.

---

## 6. Retrofit multi-tenancy sui tavoli sales (40 tavoli)

### Pattern

Su ogni tavolo aggiungiamo:

```typescript
companyId: text('company_id').notNull().default('fenice').references(() => companies.id, { onUpdate: 'cascade' }),
```

`DEFAULT 'fenice'` è temporaneo, serve per non rompere il codice esistente durante la fase di refactor. Sarà rimosso a fine implementazione (Migration M5) — coerente con la strategia di `20260516999900_finalize_remove_defaults.sql` del marketing CRM.

### Decisione pragmatica: SKIP PK rebuild

Il marketing CRM ha PK composite `(companyId, ...)` su tutti i tavoli. È pulito ma rebuildare PK su tavoli sales grandi (es. `leads` con potenziali milioni di righe) richiede `DROP CONSTRAINT pkey + ADD PRIMARY KEY` con locking pesante.

**Decisione**: NON rebuildare PK. UUID `gen_random_uuid()` dei nostri `leads.id` sono globalmente univoci → no collision risk cross-tenant. Aggiungiamo SOLO indici composti `(companyId, ...)` + check applicativo `where(and(eq(table.companyId, ctx.companyId), eq(table.id, id)))`. Pulito quanto basta, zero downtime.

PK rebuild posticipato a fase 2 come hardening.

### Tavoli da retrofittare (dall'audit #6)

40 tavoli totali. Tutti tranne `creatures` (decidere: globale o per-tenant — proposta = per-tenant per estetica brand-specific).

Vedi **Appendix A** per la lista completa con PK proposta.

### Lead intake — punti critici (3)

1. **`src/app/api/webhooks/activecampaign/route.ts`** — webhook AC in entrata, oggi tutti i lead vanno a `fenice`. Scelta:
   - **Endpoint separati per tenant**: `/api/webhooks/activecampaign` (Fenice, default) + `/api/webhooks/activecampaign/serenamente` con secret diversi. **Raccomandato** — evita misrouting.
2. **`src/app/actions/importLeads.ts`** — CSV import + manual lead creation. `companyId` deriva da `currentCompanyId(user)`.
3. **`src/app/actions/acIntakeActions.ts`** — retry su intake failures. Stessa logica del 2.

### Helper centrale

Nuovo file `src/lib/tenancy.ts`:

```typescript
import { auth } from '@/lib/auth'; // existing Supabase auth helper
import { db } from '@/db';
import { leads } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export async function currentCompanyId(): Promise<string> {
  const user = await auth.getUser();
  const cid = user?.user_metadata?.companyId ?? 'fenice'; // fallback safe
  return cid;
}

export async function assertLeadInCompany(leadId: string, companyId: string): Promise<void> {
  const [row] = await db.select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.companyId, companyId)))
    .limit(1);
  if (!row) throw new Error('Lead not found or not in current tenant');
}

export function withCompanyFilter<T>(companyId: string, ...conditions: any[]) {
  return and(eq(leads.companyId, companyId), ...conditions);
}
```

Usato in ogni Server Action: prima cosa = `const cid = await currentCompanyId()`.

### Migration sequence

1. **M1 — Companies table + seed**
   ```sql
   CREATE TABLE companies (
     id text PRIMARY KEY,
     name text NOT NULL,
     display_name text NOT NULL,
     short_code text NOT NULL,
     currency text NOT NULL DEFAULT 'EUR',
     is_active boolean NOT NULL DEFAULT true,
     sort_order int NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   INSERT INTO companies VALUES ('fenice','Fenice Academy','Fenice Academy','FA','EUR',true,1,now(),now()),
                                ('serenamente','Serenamente','Serenamente','SE','EUR',true,2,now(),now()),
                                ('fcd','FCD Enterprise','FCD Enterprise','FCD','EUR',true,3,now(),now());
   ```

2. **M2 — ADD COLUMN company_id DEFAULT 'fenice' su tutti i 40 tavoli sales**
   Single transaction, idempotente.

3. **M3 — Indici composti `(company_id, <col_critica>)` sui tavoli con query frequenti**
   `leads`: 7 indici esistenti, aggiungere `(company_id, status)`, `(company_id, assigned_to_id)`, `(company_id, funnel)`, `(company_id, created_at)`, ecc.
   `leadEvents`: `(company_id, lead_id)`.
   `callLogs`: `(company_id, user_id)`.
   `userAchievements`: `(company_id, user_id)`.
   `customerPortfolios`: `(company_id, salesperson_user_id)`.
   Usare `CREATE INDEX CONCURRENTLY` per non bloccare.

4. **M5 — DROP DEFAULT 'fenice'** (a fine refactor, prevenire future regressioni)

PK rebuild **non incluso** in M4 — saltato per pragmatismo (vedi sopra).

---

## 7. Auth + permessi unificati

### Stato attuale marketing (da rimuovere)

- JWT custom HS256 via `jose`, cookie `elixir_session` 7d, secret env con fallback hardcoded
- 4 utenti hardcoded in `src/lib/users.ts` + override env `DASHBOARD_USERS_JSON`
- Cookie `selected_company` separato
- 2 middleware (root dead + `src/` attivo)
- `/api/*` non gatato dal middleware

**Tutto buttato.** Marketing va sotto Supabase Auth nostro.

### Schema users target

Aggiungere a `users` table (nostro schema):

```typescript
area: text('area').notNull().default('sales'),  // 'sales' | 'marketing' | 'both'
marketingRole: text('marketing_role'),           // 'manager' | 'media_buyer' | 'copywriter' | 'social' | null
companyId: text('company_id').notNull().default('fenice').references(() => companies.id),
```

- `role` esistente (`GDO`/`CONFERME`/`VENDITORE`/`MANAGER`/`ADMIN`) resta come ruolo sales
- `marketingRole` nullable popolato solo per utenti marketing
- `area` discrimina visibilità

### Migrazione utenti marketing

Script one-shot. I 4 utenti default del marketing diventano:

```typescript
[
  { email: 'manager@fenice.it',    marketingRole: 'manager',     area: 'marketing', companyId: 'fenice' },
  { email: 'mediabuyer@fenice.it', marketingRole: 'media_buyer', area: 'marketing', companyId: 'fenice' },
  { email: 'copywriter@fenice.it', marketingRole: 'copywriter',  area: 'marketing', companyId: 'fenice' },
  { email: 'social@fenice.it',     marketingRole: 'social',      area: 'marketing', companyId: 'fenice' },
]
```

Per ognuno: `supabase.auth.admin.createUser()` con password temporanea + invio invite via Supabase magic link / reset. **Mai trasferire le password plaintext**.

Bruno (super-admin): `area: 'both'`, `role: 'MANAGER'`, `marketingRole: 'manager'`.

### Permissions matrix

```typescript
// src/lib/permissions.ts (esteso)
export const MARKETING_ROLE_PATHS: Record<string, string[]> = {
  manager:     ['/marketing'],  // wildcard, vede tutto sotto /marketing
  media_buyer: ['/marketing/dashboard','/marketing/creative','/marketing/trend','/marketing/testing','/marketing/select-company'],
  copywriter:  ['/marketing/email','/marketing/scripts','/marketing/best-creative','/marketing/select-company'],
  social:      ['/marketing/social','/marketing/select-company'],
};
```

### Middleware

`src/middleware.ts` (nuovo o esteso):

```typescript
const user = await getSupabaseUser(request);
const path = request.nextUrl.pathname;

if (path.startsWith('/marketing/')) {
  if (!user || !user.user_metadata.area?.includes('marketing')) return redirect('/login');
  if (!canAccess(user.user_metadata.marketingRole, path, MARKETING_ROLE_PATHS)) return new Response('403', { status: 403 });
} else if (isSalesPath(path)) {
  if (!user || !user.user_metadata.area?.includes('sales')) return redirect('/login');
  if (!canAccess(user.role, path, SALES_ROLE_PATHS)) return new Response('403', { status: 403 });
}
```

### Cookie company switcher

Resta come pattern. Marketing CRM ha `selected_company` cookie HttpOnly 30 giorni. Lo manteniamo per la UI `/marketing/*` (manager marketing che vuole vedere dati di Serenamente). Lato sales, **per ora non c'è company switcher** — un utente sales appartiene a una sola company (`users.companyId` letto da DB).

---

## 8. Migrazione dati (Supabase → Supabase)

Loro Supabase: `njdgmwjbgfzdtopkdswj`. Nostro: vedi `reference_infra_ids.md`.

### Sequenza

1. **Schema migration nel nostro DB**:
   - Drizzle migration con tutti i 13 tavoli marketing (CREATE TABLE + indici + seed companies + seed company_funnels)
   - Applicare via `drizzle-kit push` su preview Vercel prima, poi prod
2. **Data dump dal loro Supabase**:
   ```bash
   pg_dump -h <their-host> -U postgres -d postgres --data-only \
     --table=companies --table=company_funnels --table=ac_contacts \
     --table=ac_daily_metrics --table=ac_sync_state --table=ads_daily_insights \
     --table=ads_daily_fetches --table=meta_account_daily --table=marketing_targets \
     --table=ad_scripts --table=crm_events --table=crm_appointments --table=crm_deals \
     > marketing_data.sql
   ```
3. **Restore nel nostro Supabase** via SQL editor (oppure psql). Tempo stimato: pochi minuti per i volumi attesi (~50-150k righe totali).
4. **Verifica integrità**: count per tavolo, FK checks, sample query.
5. **Disattivare il loro Supabase project** (pausa, non delete — backup di sicurezza per 30 giorni).

### Env vars da migrare

Vedi **Appendix B**. Tutte le credenziali Meta/AC restano env-based (raccomandazione audit #4). Le 3 chiavi legacy `META_ACCESS_TOKEN`, `AC_API_URL`, `AC_API_KEY` sufficienti finché Fenice è l'unico tenant marketing attivo.

Vercel CLI:
```bash
# Pull dal loro project
vercel env pull --environment=production .env.marketing.tmp --token <their-token> --scope <their-team>
# Push sul nostro project (filtrando le 3-4 chiavi)
vercel env add META_ACCESS_TOKEN production
vercel env add AC_API_URL production
vercel env add AC_API_KEY production
vercel env add CRON_SECRET production  # condiviso con il nostro
```

---

## 9. Cutover plan in 3 fasi

### Fase 1 — Sblocco Serenamente sul lato sales (giorni 1-4)

**Obiettivo**: Serenamente può ricevere lead e venderli, anche senza UI marketing ancora pronta.

1. M1 (companies table + seed) — 1 ora
2. M2 (companyId DEFAULT 'fenice' su tutti 40 tavoli sales) — 2 ore
3. M3 (indici composti sui tavoli critici: `leads`, `leadEvents`, `callLogs`, `userAchievements`) — 1 ora
4. `src/lib/tenancy.ts` (helper + assert) — 0.5 giorno
5. Estendere `users` con `area`, `marketingRole`, `companyId` — 0.5 giorno
6. Estendere `useAuth` per esporre `companyId` — 0.5 giorno
7. Refactor 11 file critici (importLeads, acIntake, AC webhook, appointmentActions, confermeActions, pipelineActions, venditoreActions, targetActions, eventLogger, gamificationEngine, leaderboardActions) — 3 giorni
8. Endpoint AC webhook separato `/api/webhooks/activecampaign/serenamente` — 0.5 giorno
9. Test funzionali: creare 3 lead Serenamente test, processarli via pipeline GDO, verificare zero leak cross-tenant — 0.5 giorno

**Output Fase 1**: Serenamente vende. Marketing CRM separato continua a funzionare invariato sul vecchio Supabase (NON ancora migrato).

### Fase 2 — Merge codice + dati marketing (giorni 5-10)

**Obiettivo**: marketing vive dentro Fenice repo. Lo storico marketing dati è migrato.

1. Aggiungere 13 tavoli marketing a `src/db/schema.ts` (port da migration loro) — 0.5 giorno
2. Migration Drizzle CREATE TABLE + indici + seed company_funnels — 0.5 giorno
3. Port libreria: copiare e adattare a Drizzle
   - `meta.ts`, `meta-sync.ts`, `meta-credentials.ts`, `ads-cache.ts` — 1 giorno
   - `activecampaign.ts`, `ac-sync.ts`, `ac-credentials.ts`, `ac-cache.ts`, `ac-contacts-query.ts` — 1 giorno
   - `crm-ingest.ts`, `crm-funnel.ts`, `crm-deals-reader.ts`, `webhook.ts` (solo l'helper, no receiver) — 0.5 giorno
   - `company.ts`, `company-funnels.ts` — 0.5 giorno
4. Port API routes `/marketing/api/*` (Meta, AC, CRM, admin, targets, scripts, alerts) — 1.5 giorni
5. Port UI must-have:
   - Layout `(marketing)/marketing/layout.tsx` + Sidebar + Topbar + CompanySwitcher + NotificationBell — 1 giorno
   - `/marketing/dashboard`, `/marketing/creative`, `/marketing/manager`, `/marketing/alert`, `/marketing/target`, `/marketing/vendite`, `/marketing/select-company` — 2 giorni
6. CSS scoping: `globals-marketing.css` con classi `card`, `btn`, `kpi`, `tbl`, `badge-*`, `alert-*` prefissate `mk-` o scopate via CSS modules — 0.5 giorno
7. Cron Vercel nel monorepo: aggiungere 2 entry a `vercel.json` (sync-ac-contacts, refresh-meta) + sostituire path → `/marketing/api/cron/*` se basePath → ridefinire — 0.5 giorno
8. Migrazione dati marketing → nostro Supabase — 1 giorno (inclusi test integrità)

**Output Fase 2**: marketing girá dentro Fenice repo. Cron Meta/AC scrivono sul nostro DB. UI marketing accessibile a utenti marketing.

### Fase 3 — Cutover finale + decommissioning (giorni 11-14)

**Obiettivo**: il vecchio CRM marketing viene spento. Marketing webhook legacy rimossi.

1. Rimuovere `src/lib/marketing-webhooks/*`, `marketingWebhookDeliveries` schema, cron drain, env vars HMAC — 0.5 giorno
2. Sostituire chiamate `enqueueMarketingWebhook(...)` con `await ingestCrmEvent(...)` nei Server Action sales — 0.5 giorno
3. Migrazione 4 utenti marketing su Supabase Auth nostro (script) + invite email — 0.5 giorno
4. Aggiungere Bruno come super-admin (`area: 'both'`) — 5 minuti
5. DNS / redirect: il vecchio dominio marketing CRM (Vercel del loro project) deve fare redirect 301 verso `https://nostrodominio.it/marketing/*` — 1 ora
6. Pausare loro Supabase project (non delete) — 1 minuto
7. M5: DROP DEFAULT 'fenice' da tutte le colonne companyId sales — 1 ora
8. Smoke test bilaterale: utente marketing manager su Fenice → dashboard funziona; utente GDO Serenamente → vede solo lead Serenamente; Bruno → vede entrambi — 0.5 giorno
9. Monitor 48h post-cutover (log Vercel, count lead in entrata, cron success) — passivo

**Output Fase 3**: cutover completato. Un solo CRM, un solo deploy, un solo Supabase.

### Refactor differiti (post-cutover, fase 2 estesa)

- Refactor capillare dei restanti file gamification/KPI/analytics (60+ file Drizzle) con `companyId` filter — distribuito su 5+ giorni, dopo il go-live, sicuro perché tutto già funziona con default 'fenice'
- PK rebuild su tavoli sales (da `id` a `(companyId, id)`) — 1-2 giorni con `CONCURRENTLY` o pg_repack
- Migrare `crm_appointments`/`crm_deals` da read model a query diretta su `leads` (elimina duplicazione)
- Eliminare `useAuth` deprecato in pagine marketing una volta passate tutte a Supabase Auth (oggi sono ancora `useEffect+fetch` client-side)
- Aggiungere RLS Supabase come safety-net sui tavoli sensibili
- Migrare credenziali Meta/AC da env a tabella DB cifrata quando il 2° tenant marketing va live

---

## 10. Lista esaustiva file da toccare (Fase 1 critica)

### Tavoli sales — DROP/EXTEND in `src/db/schema.ts`

Vedi **Appendix A** per la lista completa con PK proposta. 40 tavoli totali da modificare con `companyId text not null default 'fenice'`.

### File Server Action (Drizzle queries, ordinati per criticità)

**Critici Fase 1 (must per Serenamente go-live)** — ~190 query, 11 file:
- `src/app/actions/importLeads.ts` (360 r, ~11 q) — CSV + manual lead intake. Linee chiave 219, 330.
- `src/app/actions/acIntakeActions.ts` (349 r, ~8 q)
- `src/app/api/webhooks/activecampaign/route.ts` (~7 q) — webhook AC in entrata
- `src/app/actions/appointmentActions.ts` (200 r, ~8 q) — outcome appuntamenti. Linee 58, 117, 192.
- `src/app/actions/confermeActions.ts` (1196 r, ~40 q) — flusso conferme
- `src/app/actions/pipelineActions.ts` (334 r, ~10 q) — pipeline GDO
- `src/app/actions/venditoreActions.ts` (~4 q)
- `src/app/actions/venditoriMonitorActions.ts` (~3 q)
- `src/app/actions/targetActions.ts` (452 r, ~10 q) — target/dailyKpiSnapshots
- `src/lib/eventLogger.ts` (1 q) — usato dovunque
- `src/lib/gamificationEngine.ts` (~4 q)
- `src/app/actions/leaderboardActions.ts` (~17 q) — **prioritizzare anche se "ancillare"** perché leak visibile

**Importanti Fase 2** — ~135 query, 12 file (KPI/Analytics):
- `panoramicaActions.ts` (24), `surveyActions.ts` (33), `confermeKpiActions.ts` (10), `confermeAnalyticsActions.ts` (9), `kpiAdvancedActions.ts` (7), `kpiActions.ts` (1), `kpiTeamActions.ts` (2), `kpiVenditoriActions.ts` (2), `marketingActions.ts` (7), `gdoPerformanceActions.ts` (19), `customerPortfolioActions.ts` (11)

**Differibili Fase 2 estesa** — ~230 query, ~30 file (Gamification):
- `achievementActions.ts` (29), `questActions.ts` (28), `adventureActions.ts` (21), `shopActions.ts` (17), `bossBattleActions.ts` (16), `teamAdventureActions.ts` (15), `managerRpgActions.ts` (14), `duelActions.ts` (13), `sprintActions.ts` (12), `tradingActions.ts` (11), `teamGoalActions.ts` (11), `lootDropActions.ts` (10) + altri

**Da rimuovere**:
- `src/lib/marketing-webhooks/{enqueue,payload-builders,types,deliver,signing}.ts`
- `src/app/api/marketing/*` (4 endpoint)
- `src/app/api/cron/marketing-webhooks-drain/route.ts`
- `scripts/backfillMarketingEventsWindow.ts`

### File da aggiungere

- `src/lib/tenancy.ts` (helper centrale)
- `src/lib/crm-ingest.ts` (port dal marketing — `ingestCrmEvent`, `upsertAppointmentFromSet/Outcome`, `insertDealFromClosed`)
- `src/lib/crm-funnel.ts` (port)
- `src/lib/crm-deals-reader.ts` (port)
- `src/lib/meta.ts`, `src/lib/meta-sync.ts`, `src/lib/meta-credentials.ts`, `src/lib/ads-cache.ts` (port)
- `src/lib/activecampaign.ts`, `src/lib/ac-sync.ts`, `src/lib/ac-credentials.ts`, `src/lib/ac-cache.ts`, `src/lib/ac-contacts-query.ts` (port)
- `src/lib/company.ts`, `src/lib/company-funnels.ts` (port, adattati a Drizzle)
- `src/lib/projections.ts`, `src/lib/aggregate.ts`, `src/lib/date-utils.ts` (port)
- `src/lib/marketing-permissions.ts` (matrice ruoli marketing)
- `src/app/(marketing)/marketing/layout.tsx` + page.tsx per ogni rotta must-have
- `src/components/marketing/Sidebar.tsx`, `Topbar.tsx`, `CompanySwitcher.tsx`, `NotificationBell.tsx`, `DateRangePicker.tsx`, `SingleCompanyRequired.tsx` (port)
- `src/styles/globals-marketing.css` (CSS scopato)
- Migration files `drizzle/migrations/<timestamp>_*_*.sql` (M1, M2, M3, M4, M5)
- `scripts/migrateMarketingUsers.ts` (script one-shot Supabase Auth)
- `scripts/migrateMarketingData.ts` (pg_dump + restore wrapper)

---

## 11. Stima onesta + scenario realistico

### Stima totale full retrofit (no shortcut)

| Macro-blocco | Giorni |
|---|---|
| Schema migration sales + companies | 1 |
| Helper + AuthProvider + Supabase user_metadata | 0.5 |
| 11 file critici sales (importLeads, conferme, pipeline, AC webhook, ecc.) | 3 |
| 60+ file ancillari (gamification, KPI, analytics) | 5 |
| Decommissioning marketing-webhooks | 0.5 |
| Schema migration marketing in nostro Drizzle + dati migration | 1.5 |
| Port lib marketing (meta, AC, crm-ingest) a Drizzle | 2.5 |
| Port API routes marketing | 1.5 |
| Port UI must-have marketing | 2 |
| CSS scoping + asset porting | 0.5 |
| Cron Vercel + env vars Vercel | 0.5 |
| Migrazione utenti marketing + auth iso | 0.5 |
| Cutover finale + DNS redirect + decommissioning | 0.5 |
| QA bilaterale (2 tenant attivi, no leak) | 2 |
| Buffer imprevisti | 2 |
| **Totale** | **23** |

Più dell'ottimistico iniziale. **Sopravvalutato? No. Sottovalutato? Possibile, su porting UI marketing.**

### Scenario realistico per deadline 2026-06-04 (14 giorni)

Due tagli obbligatori:

1. **SKIP refactor capillare gamification/KPI per Serenamente al go-live**: i 60+ file restano filtrati implicitamente da `default 'fenice'` sui dati esistenti. Serenamente parte con gamification visibile come `companyId = 'serenamente'` di default sui nuovi dati, ma la UI gamification non filtra per company → leaderboard mostra Fenice + Serenamente mescolati. **Mitigazione**: disabilitare gamification per utenti Serenamente al go-live (flag `users.gamificationEnabled = false` o check `companyId === 'serenamente'` come kill switch nelle pagine `/store`, `/avventura`, `/duels`, `/leaderboard`). Solo `leaderboardActions.ts` va comunque toccato perché è visibile a tutti.
   **Risparmio**: ~5 giorni.

2. **SKIP migrazione UI nice-to-have**: porting di `/marketing/best-ads`, `/marketing/best-creative`, `/marketing/trend`, `/marketing/testing`, `/marketing/email`, `/marketing/scripts`, `/marketing/social/*`, `/marketing/admin/*` posticipato. Marketing usa il vecchio CRM per queste pagine fino a fase 2 estesa.
   **Risparmio**: ~2.5 giorni.

3. **SKIP PK rebuild** (già deciso).

**Stima ridotta**: 23 - 5 - 2.5 = **15.5 giorni**, ancora oltre i 14. Aggiungere:

4. **Porting cron e UI marketing in parallelo a refactor sales**: alcuni giorni dei due blocchi possono sovrapporsi se Bruno fa una parte e Claude un'altra. Sgravo ~1.5 giorni.

**Stima realistica con tutti i tagli**: **~14 giorni** — pareggiamo la deadline, no margine.

### Raccomandazione

- Iniziare LUNEDÌ prossimo 2026-05-26 con Fase 1 (sblocco Serenamente).
- Tagliare aggressivamente come da sopra.
- Avere un piano B: se a metà strada vediamo che non ce la facciamo, **Serenamente parte con CRM marketing legacy** (loro deploy attuale resta attivo) e Fenice si fonde dopo. Il taglio in più: Serenamente sales mono-tenant fittizio per le prime 2 settimane (companyId 'fenice' applicato ai loro lead temporaneamente — dati misti ma niente UI breakage).

---

## 12. Rischi e mitigazioni

| Rischio | Severità | Probabilità | Mitigazione |
|---|---|---|---|
| Query dimenticata in pagina poco frequentata → leak cross-tenant | ALTA | ALTA | ESLint custom rule che marca `.from(<businessTable>)` senza filtro su `companyId`. O alternativa: RLS Supabase come safety-net. Per ora: code review accurato. |
| Race su AC intake con 2 tenant simultanei | MEDIA | MEDIA | Endpoint webhook separati per tenant. Deduplica scoped per tenant (la finestra dedupe attuale è 10min). |
| Leaderboard mescolata cross-tenant (gamification non refatto) | MEDIA | ALTA (se non mitigato) | Disabilitare gamification per Serenamente al go-live + refattorare almeno `leaderboardActions.ts`. |
| PK rebuild bloccante su `leads` grande | BASSA (skippato) | N/A | Saltato. UUID già globalmente univoci. |
| Migrazione dati Supabase incompleta o corrotta | ALTA | BASSA | Test su preview Supabase prima. Confronto count per tavolo pre/post. Backup `pg_dump` completo prima di pausare loro project. |
| Env vars Meta/AC mancanti su Vercel nostro → cron fail post-cutover | MEDIA | MEDIA | Pull dal loro Vercel via CLI + verifica esplicita con `vercel env ls` prima del cutover. Test cron manuale con `?dryRun=true` se supportato. |
| Password marketing trasferite plaintext per errore | ALTA | BASSA | Iron rule scritta nel design doc: MAI trasferire plaintext. Solo reset+invite. |
| Bruno non riceve invite super-admin in tempo | BASSA | MEDIA | Test invite flow su un utente test prima del cutover. |
| CSS marketing collide con classi sales esistenti (`card`, `btn`) | MEDIA | ALTA | Scoping CSS modules O prefisso `mk-` su tutte le classi custom marketing. |
| Cron sync-ac-contacts in fail loop perché schema mismatch tra port Drizzle e dati migrati | MEDIA | BASSA | Test cron su preview deploy con dati copiati prima del cutover prod. |
| Dipendenza next.config.ts `basePath: '/marketing'`: non vogliamo basePath globale sul nostro Next | BASSA | N/A | NON copiamo `basePath` nel nostro `next.config.ts`. I fetch nelle pagine portate restano `/marketing/api/*` perché le abbiamo messe sotto `src/app/marketing/api/`. Letteralmente, niente basePath. |
| Vercel cron limit (Hobby plan ha 2 cron) | BASSA | BASSA | Verificare il piano prima. Probabilmente Pro/Enterprise. |

---

## 13. Decisioni differite / aperti

1. **Quali utenti marketing reali esistono oggi?** Default 4 utenti hardcoded, ma DASHBOARD_USERS_JSON può aver aggiunto altri. **Action**: chiedere al team marketing la lista reale prima della migrazione utenti.
2. **`crm_appointments` / `crm_deals` — mantenere o eliminare?** Decisione provvisoria (B). Rivedere in fase 2 estesa.
3. **`creatures` table — globale o per-tenant?** Decisione provvisoria: per-tenant. Confermare con Bruno se le creature gamification devono differire per brand.
4. **`appSettings.key` — singola riga per chiave o per-tenant?** Probabilmente per-tenant. Verificare contenuto attuale.
5. **Endpoint AC webhook secret separato per Serenamente** — chi gestisce la creazione del secret? Va passato al team AC di Serenamente.
6. **Gamification per Serenamente — disabilitata al go-live, ma quando va abilitata?** Probabilmente in fase 2 estesa dopo refactor capillare. Definire criterio di "abilitazione".
7. **Storico dati Serenamente esistente?** Se ci sono dati Serenamente già nel marketing CRM (in `company_funnels`, eventuali `ac_contacts`), si migrano tutti insieme.

---

## 14. Appendix A — Tavoli sales con `companyId` (40)

(Estratto dall'audit retrofit multi-tenancy, dopo lettura schema completo)

| Tavolo | PK proposta dopo Fase 1 (no rebuild) | PK proposta Fase 2 estesa (rebuild) | Note |
|---|---|---|---|
| `users` | id (invariato) | (companyId, id) | + unique(companyId,email) |
| `leads` | id (invariato) | (companyId, id) | 7 indici esistenti +(companyId,...) |
| `callLogs` | id | (companyId, id) | |
| `leadEvents` | id | (companyId, id) | |
| `breakSessions` | id | (companyId, id) | |
| `notifications` | id | (companyId, id) | |
| `assignmentSettings` | id | (companyId, id) | |
| `importLogs` | id | (companyId, id) | |
| `sprints` | id | (companyId, id) | |
| `shopItems` | id | (companyId, id) | premi per company |
| `userPurchases` | id | (companyId, id) | |
| `coinTransactions` | id | (companyId, id) | |
| `confirmationsNotes` | id | (companyId, id) | |
| `internalAlerts` | id | (companyId, id) | broadcast scope per tenant |
| `calendarConnections` | id | (companyId, id) | unique(companyId, userId) |
| `calendarEvents` | id | (companyId, id) | |
| `teamGoals` | id | (companyId, id) | |
| `marketingBudgets` | id | (companyId, id) | per-funnel/month/company |
| `monthlyTargets` | id | (companyId, id) | unique(companyId, month) |
| `dailyKpiSnapshots` | id | (companyId, id) | unique(companyId, date) |
| `pipelineSnapshots` | id | (companyId, id) | |
| `gdoNotes` | id | (companyId, id) | |
| `quests` | id | (companyId, id) | per-tenant content |
| `questProgress` | id | (companyId, id) | |
| `achievements` | id | (companyId, id) | catalogo per-tenant |
| `userAchievements` | id | (companyId, id) | unique +companyId |
| `lootDrops` | id | (companyId, id) | |
| `bossBattles` | id | (companyId, id) | |
| `bossContributions` | id | (companyId, id) | |
| `seasonalEvents` | id | (companyId, id) | |
| `weeklyGamificationRules` | id | (companyId, id) | unique(companyId, month) |
| `creatures` | id | (companyId, id) | proposta per-tenant — confermare |
| `userCreatures` | id | (companyId, id) | |
| `adventureProgress` | id | (companyId, id) | |
| `adventureBosses` | id | (companyId, id) | |
| `actionChests` | id | (companyId, id) | |
| `teamRpgProfile` | id | (companyId, id) | |
| `teamCreatures` | id | (companyId, id) | |
| `tradingOffers` | id | (companyId, id) | intra-tenant only |
| `duels` | id | (companyId, id) | intra-tenant only |
| `manualAdjustments` | id | (companyId, id) | |
| `monthlyLeadTargets` | id | (companyId, id) | unique(companyId, yearMonth) |
| `acIntakeFailures` | id | (companyId, id) | |
| `gdoLeadSurveys` | id | (companyId, id) | unique(companyId, leadId) |
| `confermeLeadSurveys` | id | (companyId, id) | idem |
| `salesLeadSurveys` | id | (companyId, id) | idem |
| `monthlyFunnelBaselines` | id | (companyId, id) | unique +companyId |
| `customerPortfolios` | id | (companyId, id) | |
| `appSettings` | key | (companyId, key) | key globale → per-tenant |
| `marketingWebhookDeliveries` | DA RIMUOVERE | — | parte di marketing-webhooks legacy |

---

## 15. Appendix B — Env vars migration

### Da rimuovere (post-cutover Fase 3)

- `WEBHOOK_SECRET_CRM`
- `WEBHOOK_SECRET_CRM_TEST`
- `MARKETING_WEBHOOK_URL_PROD`
- `MARKETING_WEBHOOK_URL_TEST`
- `MARKETING_WEBHOOK_ENABLED`

### Da aggiungere al nostro Vercel project (Fase 2)

```
# Meta Marketing API
META_ACCESS_TOKEN                # legacy slug fenice (sufficiente per ora)

# ActiveCampaign API
AC_API_URL                       # legacy slug fenice
AC_API_KEY                       # legacy slug fenice
AC_SALES_TAG_ID_TELEGRAM         # solo se popolato nel marketing project
AC_SALES_TAG_ID_CORSO
AC_SALES_TAG_ID_JOB
AC_UTM_TERM_FIELD_ID

# Cron (riutilizziamo CRON_SECRET esistente sales se già presente)
CRON_SECRET                      # esistente, condiviso

# Client-side
NEXT_PUBLIC_AC_URL               # link UI verso pannello AC

# Auth (NON portare — buttiamo JWT custom)
# JWT_SECRET, DASHBOARD_USERNAME, DASHBOARD_PASSWORD, DASHBOARD_USERS_JSON
```

Per Serenamente quando va live in marketing (fase 2 estesa): aggiungere `META_ACCESS_TOKEN_SERENAMENTE`, `AC_API_URL_SERENAMENTE`, `AC_API_KEY_SERENAMENTE`.

---

## 16. Appendix C — Codice da rimuovere (~1500 righe)

```
src/lib/marketing-webhooks/enqueue.ts
src/lib/marketing-webhooks/payload-builders.ts
src/lib/marketing-webhooks/types.ts
src/lib/marketing-webhooks/deliver.ts          (se esiste)
src/lib/marketing-webhooks/signing.ts          (se esiste)
src/app/api/marketing/queue/route.ts           (o equivalenti)
src/app/api/marketing/replay/route.ts          (o equivalenti)
src/app/api/marketing/status/route.ts          (o equivalenti)
src/app/api/marketing/backfill-window/route.ts (o equivalenti)
src/app/api/cron/marketing-webhooks-drain/route.ts
scripts/backfillMarketingEventsWindow.ts
src/db/schema.ts — marketingWebhookDeliveries
```

### Schema da eliminare in M5 finale

```sql
DROP TABLE IF EXISTS marketing_webhook_deliveries;
```

### Chiamate da sostituire

```typescript
// CERCA in src/:
enqueueMarketingWebhook(

// SOSTITUISCI con (sempre await):
await ingestCrmEvent(currentCompanyId, {...payload})
```

File coinvolti (dall'audit retrofit):
- `src/app/actions/appointmentActions.ts` (linee 85, 93)
- `src/app/actions/confermeActions.ts` (linea 14 e altre)
- `src/app/actions/pipelineActions.ts` (linea 18 e altre)
- Outcome handler venditore (es. `venditoreActions.ts`)

---

## 17. Next steps — azioni immediate

1. **Bruno** conferma decisioni 1-7 in §13 (specie utenti reali, creature globale/tenant).
2. **Bruno** chiede al team marketing: (a) lista utenti reali oggi, (b) dump `pg_dump --schema-only` dal loro Supabase per ricostruire `ac_*`/`ads_*`/`meta_*` esatti, (c) eventuale presenza di rotte/feature non documentate.
3. **Claude** parte con Fase 1 implementazione lunedì 2026-05-26 (o subito se Bruno approva).
4. Setup Vercel: confermare piano (cron limit ≥ 2) e accesso al loro Vercel project per `vercel env pull` quando si arriva al cutover.
5. Setup Supabase: confermare il nostro project ha spazio + plan per i nuovi tavoli + dati (~150k righe stimate, no issue).

---

**Fine design doc. Tutto da qui in poi è implementazione.**
