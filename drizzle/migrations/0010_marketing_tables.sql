-- 0010: 13 marketing tables ported from legacy crm-marketing repo (Supabase project njdgmwjbgfzdtopkdswj).
-- Schema derived from docs/merge-marketing-schema.md.
-- Fix applicati durante port:
--   * marketing_targets PK → (companyId, id) con id default 1 (era PK su id solo, cross-tenant collision)
--   * ad_scripts PK → (companyId, ad_name_normalized) (era cross-tenant collision)
--   * ac_sync_state PK → (companyId, key) (widened da single-col per future keys)
-- Numeric: numeric(14,4) per cost metrics, numeric(10,2) per €.
-- Counter: bigint per impressions/clicks/leads_meta.
-- Dati storici Fenice marketing: importati separatamente via pg_dump (Fase 3 cutover).

-- ─── company_funnels ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "company_funnels" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
    "id" text NOT NULL,
    "name" text NOT NULL,
    "meta_account" text,
    "meta_keyword" text,
    "ac_list" text,
    "ac_sales_tag_id" text,
    "ac_provenienza_patterns" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "color" text NOT NULL DEFAULT 'bg-slate-500',
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("company_id", "id")
);

-- Seed funnel Fenice (replica esatta di src/lib/funnels.ts legacy).
-- Ordine sort_order = priorità matching (pattern più specifici prima).
INSERT INTO "company_funnels" ("company_id", "id", "name", "meta_account", "meta_keyword", "ac_list", "ac_sales_tag_id", "ac_provenienza_patterns", "color", "sort_order")
VALUES
    ('fenice', 'telegram-tk', 'Telegram TK', NULL, NULL, NULL, NULL, '["telegram-tk"]'::jsonb, 'bg-cyan-600', 1),
    ('fenice', 'google', 'Google', NULL, NULL, NULL, NULL, '["google"]'::jsonb, 'bg-emerald-600', 2),
    ('fenice', 'org', 'ORG', NULL, NULL, NULL, NULL, '["org"]'::jsonb, 'bg-slate-600', 3),
    ('fenice', 'telegram', 'Telegram', 'act_669804383496587', 'Telegram', 'Lista lead telegram', NULL, '["telegram"]'::jsonb, 'bg-sky-600', 4),
    ('fenice', 'corso10ore', 'Corso 10 Ore', 'act_879850109431041', 'Corso 10', 'Lead Corso Gratis 10 Ore', NULL, '["corso 10","corso10"]'::jsonb, 'bg-violet-600', 5),
    ('fenice', 'jobsimulator', 'Job Simulator', 'act_879850109431041', 'Job Simulator', 'Job Simulator', NULL, '["job simulator","jobsimulator"]'::jsonb, 'bg-amber-600', 6)
ON CONFLICT DO NOTHING;

-- ─── ac_daily_metrics (EAV cache AC metrics) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "ac_daily_metrics" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "funnel_id" text NOT NULL,
    "date" date NOT NULL,
    "metric" text NOT NULL,
    "payload" jsonb NOT NULL,
    "fetched_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("company_id", "funnel_id", "date", "metric")
);
CREATE INDEX IF NOT EXISTS "ac_daily_metrics_company_funnel_date_idx" ON "ac_daily_metrics" ("company_id", "funnel_id", "date");

-- ─── ac_contacts (AC contacts mirror) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ac_contacts" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "contact_id" text NOT NULL,
    "email" text,
    "first_name" text,
    "last_name" text,
    "phone" text,
    "cdate" timestamptz NOT NULL,
    "udate" timestamptz,
    "funnel_id" text,
    "provenienza_raw" text,
    "utm_source" text,
    "utm_medium" text,
    "utm_campaign" text,
    "utm_term" text,
    "utm_content" text,
    "is_cliente" boolean NOT NULL DEFAULT false,
    "contract_date" date,
    "contract_value" numeric(12,2),
    "synced_at" timestamptz NOT NULL DEFAULT now(),
    "manually_excluded" boolean NOT NULL DEFAULT false,
    PRIMARY KEY ("company_id", "contact_id")
);

-- ─── ac_sync_state (sync cursor) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ac_sync_state" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "key" text NOT NULL,
    "value" text NOT NULL,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("company_id", "key")
);

-- ─── ads_daily_insights (Meta Ads per-ad per-day) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "ads_daily_insights" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "ad_id" text NOT NULL,
    "date" date NOT NULL,
    "account_id" text NOT NULL,
    "funnel_id" text NOT NULL,
    "campaign_name" text,
    "adset_name" text,
    "ad_name" text,
    "spend" numeric(14,4) NOT NULL,
    "impressions" bigint NOT NULL,
    "clicks" bigint NOT NULL,
    "cpm" numeric(14,4) NOT NULL,
    "ctr" numeric(14,4) NOT NULL,
    "cpc" numeric(14,4) NOT NULL,
    "leads_meta" integer NOT NULL,
    "effective_status" text,
    "post_url" text,
    PRIMARY KEY ("company_id", "ad_id", "date")
);
CREATE INDEX IF NOT EXISTS "ads_daily_insights_company_funnel_date_idx" ON "ads_daily_insights" ("company_id", "funnel_id", "date");

-- ─── ads_daily_fetches (Meta fetch markers) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "ads_daily_fetches" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "funnel_id" text NOT NULL,
    "date" date NOT NULL,
    "fetched_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("company_id", "funnel_id", "date")
);

-- ─── meta_account_daily (account-level Meta spend) ────────────────────────────
CREATE TABLE IF NOT EXISTS "meta_account_daily" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "account_id" text NOT NULL,
    "date" date NOT NULL,
    "spend" numeric(14,4) NOT NULL,
    "impressions" bigint NOT NULL,
    "clicks" bigint NOT NULL,
    "fetched_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("company_id", "account_id", "date")
);

-- ─── marketing_targets (CAC/AOV/lead targets/ROAS) ────────────────────────────
-- NOTA fix port: PK ora (company_id, id) con id default 1 (era PK su id solo).
CREATE TABLE IF NOT EXISTS "marketing_targets" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "id" integer NOT NULL DEFAULT 1,
    "aov" numeric(10,2) NOT NULL,
    "cac" numeric(10,2) NOT NULL,
    "cost_app" numeric(10,2) NOT NULL,
    "cost_conf" numeric(10,2) NOT NULL,
    "lead_target_total" integer,
    "lead_target_telegram" integer,
    "lead_target_corso10ore" integer,
    "lead_target_jobsimulator" integer,
    "roas_target" numeric(10,2),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("company_id", "id")
);

-- ─── ad_scripts (per-ad creative scripts) ─────────────────────────────────────
-- NOTA fix port: PK ora (company_id, ad_name_normalized) (era cross-tenant collision).
CREATE TABLE IF NOT EXISTS "ad_scripts" (
    "company_id" text NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "ad_name_normalized" text NOT NULL,
    "ad_name" text NOT NULL,
    "script" text NOT NULL,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("company_id", "ad_name_normalized")
);

-- ─── crm_events (webhook audit log immutabile) ────────────────────────────────
CREATE TABLE IF NOT EXISTS "crm_events" (
    "event_id" text PRIMARY KEY,
    "event_type" text NOT NULL,
    "occurred_at" timestamptz NOT NULL,
    "received_at" timestamptz NOT NULL DEFAULT now(),
    "company_id" text NOT NULL REFERENCES "companies"("id"),
    "lead_id" text,
    "payload" jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_events_company_occurred_idx" ON "crm_events" ("company_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "crm_events_lead_idx" ON "crm_events" ("lead_id");
CREATE INDEX IF NOT EXISTS "crm_events_type_idx" ON "crm_events" ("event_type");

-- ─── crm_appointments (read model appointment.set + outcome) ──────────────────
CREATE TABLE IF NOT EXISTS "crm_appointments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "company_id" text NOT NULL REFERENCES "companies"("id"),
    "lead_id" text NOT NULL,
    "appointment_date" date NOT NULL,
    "funnel" text,
    "utm_term" text,
    "status" text NOT NULL DEFAULT 'SET',
    "lead_name" text,
    "lead_email" text,
    "lead_phone" text,
    "set_event_id" text REFERENCES "crm_events"("event_id"),
    "outcome_event_id" text REFERENCES "crm_events"("event_id"),
    "set_at" timestamptz,
    "outcome_at" timestamptz,
    "raw_outcome" text,
    "manually_excluded" boolean NOT NULL DEFAULT false,
    "utm_source" text,
    "utm_medium" text,
    "utm_campaign" text,
    "utm_content" text,
    CONSTRAINT "crm_appointments_company_lead_date_unique" UNIQUE ("company_id", "lead_id", "appointment_date")
);
CREATE INDEX IF NOT EXISTS "crm_appointments_company_date_idx" ON "crm_appointments" ("company_id", "appointment_date");
CREATE INDEX IF NOT EXISTS "crm_appointments_company_funnel_date_idx" ON "crm_appointments" ("company_id", "funnel", "appointment_date");
CREATE INDEX IF NOT EXISTS "crm_appointments_status_idx" ON "crm_appointments" ("company_id", "status", "appointment_date");

-- ─── crm_deals (read model deal.closed_won + closed_lost) ─────────────────────
CREATE TABLE IF NOT EXISTS "crm_deals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "company_id" text NOT NULL REFERENCES "companies"("id"),
    "lead_id" text NOT NULL,
    "event_id" text NOT NULL REFERENCES "crm_events"("event_id"),
    "status" text NOT NULL,
    "closed_at" timestamptz NOT NULL,
    "closed_date" date NOT NULL,
    "funnel" text,
    "utm_term" text,
    "product" text,
    "amount_eur" numeric(10,2),
    "salesperson_id" text,
    "salesperson_name" text,
    "manually_excluded" boolean NOT NULL DEFAULT false,
    "utm_source" text,
    "utm_medium" text,
    "utm_campaign" text,
    "utm_content" text,
    CONSTRAINT "crm_deals_company_event_unique" UNIQUE ("company_id", "event_id")
);
CREATE INDEX IF NOT EXISTS "crm_deals_company_closed_idx" ON "crm_deals" ("company_id", "closed_date");
CREATE INDEX IF NOT EXISTS "crm_deals_company_funnel_closed_idx" ON "crm_deals" ("company_id", "funnel", "closed_date");
CREATE INDEX IF NOT EXISTS "crm_deals_company_salesperson_idx" ON "crm_deals" ("company_id", "salesperson_id");
