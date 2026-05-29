# Schema mapping — Legacy `crm-marketing` → Drizzle ORM

Derived from `C:\Users\bruno\Desktop\crm-marketing\` source code on 2026-05-29.
Goal: enable porting these tables into the merged CRM Fenice Drizzle schema.

The original `CREATE TABLE` statements for the 8 EAV/cache marketing tables are
NOT in the migration files — they predate the multi-tenant retrofit. Column
types below are reconstructed by reading TS lib files (`db.from(...)` calls,
upsert payloads, row interfaces) and confirmed against the retrofit migrations
(`20260516120200..120400`) that added `company_id` + composite PKs/indexes.

For PK/composite-index information the migrations are authoritative.

---

## Table: `ac_daily_metrics`

EAV (Entity-Attribute-Value) cache for ActiveCampaign metrics. One row per
(company, funnel, day, metric). Used by `src/lib/ac-cache.ts`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `funnel_id` text NOT NULL
  - `date` date NOT NULL — ISO `YYYY-MM-DD`
  - `metric` text NOT NULL — values: `'leads' | 'leads_by_ad'`
  - `payload` jsonb NOT NULL — shape depends on metric: `{count:number}` for `leads`, `Record<string,number>` (ad_name → count) for `leads_by_ad`
  - `fetched_at` timestamptz NOT NULL — set explicitly on upsert (no DB default in TS)
- PK: `(company_id, funnel_id, date, metric)`
- Indexes: `ac_daily_metrics_company_funnel_date_idx (company_id, funnel_id, date)`
- Notes: EAV / lazy cache. "Today" (Europe/Rome) is never cached.

---

## Table: `ac_contacts`

Per-contact mirror of ActiveCampaign records, populated by `src/lib/ac-sync.ts`.
Read-side in `src/lib/ac-contacts-query.ts`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `contact_id` text NOT NULL — AC contact id
  - `email` text NULL
  - `first_name` text NULL
  - `last_name` text NULL
  - `phone` text NULL
  - `cdate` timestamptz NOT NULL — AC "created" ISO string (ambiguous: stored as ISO, queried with `>= 'YYYY-MM-DDT00:00:00Z'`, so almost certainly timestamptz; could be text — flag)
  - `udate` timestamptz NULL — AC "updated" ISO string
  - `funnel_id` text NULL — resolved from `provenienza` against `company_funnels.ac_provenienza_patterns`
  - `provenienza_raw` text NULL — raw value of AC custom field id=2
  - `utm_source` text NULL
  - `utm_medium` text NULL
  - `utm_campaign` text NULL
  - `utm_term` text NULL — holds `ad_name`
  - `utm_content` text NULL
  - `is_cliente` boolean NOT NULL — true if "Cliente" tag (id=35) is applied
  - `contract_date` date NULL — earliest `cdate` of the Cliente tag application, sliced to 10 chars
  - `contract_value` numeric(12,2) NULL — parsed from custom field id=43 (importo contratto)
  - `synced_at` timestamptz NOT NULL — set explicitly on upsert
  - `manually_excluded` boolean NOT NULL DEFAULT false — used in read filters (`.eq('manually_excluded', false)`). Default inferred (not seen in inserts).
- PK: `(company_id, contact_id)`
- Indexes: `ac_contacts_company_contact_idx (company_id, contact_id)` (redundant with PK, kept for clarity)
- Notes: Ambiguity on `cdate`/`udate` storage type — could be `timestamptz` or `text` (ISO strings). Code treats them as text comparable to ISO ranges, so PostgreSQL handles both.

---

## Table: `ac_sync_state`

Sync cursor (single row per company). Used by `src/lib/ac-sync.ts`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `key` text NOT NULL — currently only `'last_synced_at'`
  - `value` text NOT NULL — ISO timestamp string
  - `updated_at` timestamptz NOT NULL — set explicitly on upsert
- PK: `(company_id)` per migration `120400`
  - WARNING: code does `upsert(..., { onConflict: 'company_id,key' })` — the PK on `company_id` alone implies only ONE row per company (the migration comment confirms "single-row per company"). If a second key/value were ever introduced, the PK would conflict. Flag for review.
- Indexes: `ac_sync_state_company_idx (company_id)` (redundant with PK)
- Notes: PK + onConflict mismatch — see above.

---

## Table: `ads_daily_insights`

Per-ad per-day Meta Ads insights cache. Used by `src/lib/ads-cache.ts`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `ad_id` text NOT NULL
  - `date` date NOT NULL
  - `account_id` text NOT NULL — Meta ad-account id (`act_XXXX`)
  - `funnel_id` text NOT NULL
  - `campaign_name` text NULL
  - `adset_name` text NULL
  - `ad_name` text NULL
  - `spend` numeric NOT NULL — read back as `Number(...)`; type ambiguous (could be `numeric(14,2)` or `double precision`). Flag.
  - `impressions` bigint NOT NULL — Meta returns large counts; could be `int`. Flag.
  - `clicks` bigint NOT NULL
  - `cpm` numeric NOT NULL
  - `ctr` numeric NOT NULL
  - `cpc` numeric NOT NULL
  - `leads_meta` int NOT NULL
  - `effective_status` text NULL
  - `post_url` text NULL
- PK: `(company_id, ad_id, date)`
- Indexes:
  - `ads_daily_insights_company_funnel_date_idx (company_id, funnel_id, date)`
  - `ads_daily_insights_company_ad_date_idx (company_id, ad_id, date)` (redundant with PK)
- Notes: Numeric types are best-effort. Recommend `numeric(14,4)` for spend/cpm/cpc and `bigint` for impressions/clicks to be safe.

---

## Table: `ads_daily_fetches`

"Fetched marker" table — confirms that for a given (company, funnel, date) the
Meta data has been pulled, even if zero ads existed. Used by `src/lib/ads-cache.ts`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `funnel_id` text NOT NULL
  - `date` date NOT NULL
- PK: `(company_id, funnel_id, date)`
- Indexes: `ads_daily_fetches_company_funnel_date_idx (company_id, funnel_id, date)` (redundant with PK)
- Notes: Likely also has a `fetched_at timestamptz default now()` originally, but the upsert in `ads-cache.ts` only writes the 3 PK columns. If present, add it as `fetched_at timestamptz NOT NULL DEFAULT now()` — flag for verification against prod schema.

---

## Table: `meta_account_daily`

Account-level (no keyword filter) per-day spend totals. Used by `src/lib/meta-sync.ts`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `account_id` text NOT NULL — Meta ad-account id
  - `date` date NOT NULL
  - `spend` numeric NOT NULL — read with `Number(r.spend ?? 0)`. Likely `numeric(14,2)`.
  - `impressions` bigint NOT NULL — written from Meta response
  - `clicks` bigint NOT NULL
  - `fetched_at` timestamptz NOT NULL — set explicitly on upsert
- PK: `(company_id, account_id, date)`
- Indexes: `meta_account_daily_company_account_date_idx (company_id, account_id, date)` (redundant with PK)
- Notes: Captures brand/test ads that don't match any funnel keyword.

---

## Table: `marketing_targets`

Targets dashboard (CAC, AOV, lead targets, ROAS target). Used by `src/app/api/targets/route.ts`, `alerts/route.ts`, `trend/route.ts`.

- Columns:
  - `id` int NOT NULL — hardcoded to `1` in all writes; one logical row per company
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `aov` numeric NOT NULL — average order value (€). Likely `numeric(10,2)`.
  - `cac` numeric NOT NULL — customer acquisition cost (€)
  - `cost_app` numeric NOT NULL — cost per appointment (€)
  - `cost_conf` numeric NOT NULL — cost per confirmation (€)
  - `lead_target_total` int NULL
  - `lead_target_telegram` int NULL
  - `lead_target_corso10ore` int NULL
  - `lead_target_jobsimulator` int NULL
  - `roas_target` numeric NULL
  - `updated_at` timestamptz NOT NULL — set explicitly on upsert
- PK per migration `120400`: `(company_id, funnel_id, period)` — **WRONG / STALE**. The TS code never writes `funnel_id` or `period`; it uses `id=1`. The migration comment says "assumiamo PK ... Verifica e adatta". So the actual PK is almost certainly `(company_id, id)` (composite after retrofit) or kept `(id)` with company_id as a discriminator. Flag for verification in prod schema.
- onConflict in code: `{ onConflict: 'id' }` (pre-tenancy) — needs update to `company_id,id` in new code.
- Indexes: `marketing_targets_company_funnel_idx (company_id, funnel_id)` per migration. Useless if funnel_id column doesn't exist. Likely dead.
- Notes:
  - Hardcoded funnel-specific columns (`lead_target_telegram`, etc.) — this is a Fenice-specific schema; will need rethinking when porting (better: separate child table `marketing_funnel_targets`).
  - In merged repo, recommended Drizzle shape: PK `(companyId, id)` with `id` defaulting to 1 OR replace with `(companyId)` single-row.

---

## Table: `ad_scripts`

Per-ad creative script storage. Used by `src/app/api/scripts/route.ts`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON UPDATE CASCADE
  - `ad_name_normalized` text NOT NULL — canonical key (lowercased/cleaned via `normalizeAdName`)
  - `ad_name` text NOT NULL — original display name
  - `script` text NOT NULL — long-form text
  - `updated_at` timestamptz NOT NULL — set explicitly on upsert
- PK per migration: `(ad_name_normalized)` (the original PK; company_id added but NOT included in PK — migration `120400` left this commented out).
  - For merge, recommend rewriting PK as `(company_id, ad_name_normalized)`.
- onConflict in code: `{ onConflict: 'ad_name_normalized' }` — **CROSS-TENANT COLLISION RISK**: two companies with the same normalized ad_name would clobber each other. Flag for tenancy hardening before merge.
- Indexes: `ad_scripts_company_idx (company_id)`
- Notes: This table is the weakest tenancy story — needs PK rewrite to `(company_id, ad_name_normalized)` and code update.

---

## Table: `company_funnels`

Multi-tenant funnel configuration. Authoritative CREATE TABLE in migration
`20260516120100_company_funnels_table.sql`.

- Columns:
  - `company_id` text NOT NULL — FK `companies(id)` ON DELETE CASCADE
  - `id` text NOT NULL — funnel slug (`telegram`, `corso10ore`, etc.)
  - `name` text NOT NULL — display name
  - `meta_account` text NULL — Meta ad-account id (`act_XXXX`)
  - `meta_keyword` text NULL — keyword for filtering Meta ads
  - `ac_list` text NULL — ActiveCampaign list name
  - `ac_sales_tag_id` text NULL
  - `ac_provenienza_patterns` jsonb NOT NULL DEFAULT `'[]'::jsonb` — array of match strings
  - `color` text NOT NULL DEFAULT `'bg-slate-500'`
  - `sort_order` int NOT NULL DEFAULT 0
  - `created_at` timestamptz NOT NULL DEFAULT now()
- PK: `(company_id, id)`
- Notes: Used everywhere via `src/lib/company-funnels.ts`.

---

## Table: `companies`

Authoritative CREATE TABLE in `20260516120000_companies_table.sql`. (Bonus — not in the requested 10, but referenced by all FKs.)

- Columns:
  - `id` text PRIMARY KEY
  - `name` text NOT NULL
  - `display_name` text NOT NULL
  - `short_code` text NOT NULL
  - `currency` text NOT NULL DEFAULT `'EUR'`
  - `is_active` boolean NOT NULL DEFAULT true
  - `sort_order` int NOT NULL DEFAULT 0
  - `created_at` timestamptz NOT NULL DEFAULT now()
  - `updated_at` timestamptz NOT NULL DEFAULT now() (auto-managed by trigger `companies_set_updated_at`)
- Seeded rows: `fenice`, `serenamente`, `fcd`.

---

## Table: `crm_events`

Immutable audit log of CRM webhooks. Authoritative CREATE in `20260516130000`.

- Columns:
  - `event_id` text PRIMARY KEY — idempotency key
  - `event_type` text NOT NULL
  - `occurred_at` timestamptz NOT NULL
  - `received_at` timestamptz NOT NULL DEFAULT now()
  - `company_id` text NOT NULL — FK `companies(id)`
  - `lead_id` text NULL
  - `payload` jsonb NOT NULL
- PK: `(event_id)`
- Indexes:
  - `crm_events_company_occurred_idx (company_id, occurred_at DESC)`
  - `crm_events_lead_idx (lead_id)`
  - `crm_events_type_idx (event_type)`

---

## Table: `crm_appointments`

Read model for `appointment.set` + `appointment.outcome`. From `20260516130000` and extended by `20260516140000`.

- Columns:
  - `id` uuid PRIMARY KEY DEFAULT `gen_random_uuid()`
  - `company_id` text NOT NULL — FK `companies(id)`
  - `lead_id` text NOT NULL
  - `appointment_date` date NOT NULL
  - `funnel` text NULL
  - `utm_term` text NULL
  - `status` text NOT NULL DEFAULT `'SET'`
  - `lead_name` text NULL
  - `lead_email` text NULL
  - `lead_phone` text NULL
  - `set_event_id` text NULL — FK `crm_events(event_id)`
  - `outcome_event_id` text NULL — FK `crm_events(event_id)`
  - `set_at` timestamptz NULL
  - `outcome_at` timestamptz NULL
  - `raw_outcome` text NULL
  - `manually_excluded` boolean NOT NULL DEFAULT false
  - `utm_source` text NULL (added 2026-05-16)
  - `utm_medium` text NULL
  - `utm_campaign` text NULL
  - `utm_content` text NULL
- PK: `(id)`
- Unique: `(company_id, lead_id, appointment_date)`
- Indexes:
  - `crm_appointments_company_date_idx (company_id, appointment_date)`
  - `crm_appointments_company_funnel_date_idx (company_id, funnel, appointment_date)`
  - `crm_appointments_status_idx (company_id, status, appointment_date)`

---

## Table: `crm_deals`

Read model for `deal.closed_won` + `deal.closed_lost`. From `20260516130000` and extended by `20260516140000`.

- Columns:
  - `id` uuid PRIMARY KEY DEFAULT `gen_random_uuid()`
  - `company_id` text NOT NULL — FK `companies(id)`
  - `lead_id` text NOT NULL
  - `event_id` text NOT NULL — FK `crm_events(event_id)`
  - `status` text NOT NULL — `'WON' | 'LOST'`
  - `closed_at` timestamptz NOT NULL
  - `closed_date` date NOT NULL
  - `funnel` text NULL
  - `utm_term` text NULL
  - `product` text NULL
  - `amount_eur` numeric(10,2) NULL
  - `salesperson_id` text NULL
  - `salesperson_name` text NULL
  - `manually_excluded` boolean NOT NULL DEFAULT false
  - `utm_source` text NULL (added 2026-05-16)
  - `utm_medium` text NULL
  - `utm_campaign` text NULL
  - `utm_content` text NULL
- PK: `(id)`
- Unique: `(company_id, event_id)`
- Indexes:
  - `crm_deals_company_closed_idx (company_id, closed_date)`
  - `crm_deals_company_funnel_closed_idx (company_id, funnel, closed_date)`
  - `crm_deals_company_salesperson_idx (company_id, salesperson_id)`

---

## Cross-cutting notes for Drizzle port

1. **Default removal**: migration `999900_finalize_remove_defaults` drops `DEFAULT 'fenice'` from all `company_id` columns. In Drizzle schema, do **not** put `.default('fenice')` on companyId.
2. **FK cascade conventions**:
   - `companies(id)` on most marketing tables: `ON UPDATE CASCADE` (no DELETE rule → restrict).
   - `companies(id)` on `company_funnels`: `ON DELETE CASCADE`.
   - `companies(id)` on CRM tables: no rule (restrict).
3. **Numeric type ambiguity**: `spend`, `cpm`, `ctr`, `cpc`, `aov`, `cac`, `cost_app`, `cost_conf` are all read with `Number(...)`. Safe defaults: `numeric(14,4)` for cost metrics, `numeric(10,2)` for euro amounts.
4. **Counter type ambiguity**: `impressions`, `clicks`, `leads_meta` — pick `bigint` for safety.
5. **Date columns** (`date`, `appointment_date`, `closed_date`, `contract_date`): `date` (not timestamptz). Code passes `'YYYY-MM-DD'` strings.
6. **Timestamp columns**: `timestamptz`. The `_at` columns that are written by the code (`fetched_at`, `synced_at`, `updated_at`) are set explicitly via `new Date().toISOString()`; in the new Drizzle schema, add `.defaultNow()` and let the DB drive them — cleaner.
7. **PK rewrites needed for merge**:
   - `marketing_targets`: should be `(company_id, id)` (or just `company_id` if always single-row).
   - `ad_scripts`: should be `(company_id, ad_name_normalized)` to avoid cross-tenant collisions.
   - `ac_sync_state`: ok as `(company_id)` if guaranteed single-row, otherwise widen to `(company_id, key)`.
8. **EAV consideration**: `ac_daily_metrics` is EAV with jsonb payload. Consider whether to keep this pattern in Drizzle or split into typed columns. Keeping EAV is fine for lazy cache; the read code already validates payload shape.
9. **Funnel-specific target columns**: `marketing_targets.lead_target_telegram/corso10ore/jobsimulator` are Fenice-only. For multi-tenant Drizzle port, replace with child table `marketing_funnel_targets (companyId, funnelId, leadTarget)`.
