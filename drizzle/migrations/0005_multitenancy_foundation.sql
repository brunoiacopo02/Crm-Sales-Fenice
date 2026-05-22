-- Multi-tenancy foundation: tabella `companies` + estensione `users` con
-- companyId/area/marketingRole. Primo step del merge CRM marketing dentro
-- Fenice CRM (design doc: docs/superpowers/specs/2026-05-21-merge-crm-marketing-design.md).
--
-- Apply manualmente via SQL editor Supabase (ncutwzsifzundikwllxp).
-- Idempotente: usa CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- ─── companies ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "companies" (
  "id"          text PRIMARY KEY,
  "name"        text NOT NULL,
  "displayName" text NOT NULL,
  "shortCode"   text NOT NULL,
  "currency"    text NOT NULL DEFAULT 'EUR',
  "isActive"    boolean NOT NULL DEFAULT true,
  "sortOrder"   integer NOT NULL DEFAULT 0,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "companies" ("id","name","displayName","shortCode","currency","isActive","sortOrder")
VALUES
  ('fenice',      'Fenice Academy',  'Fenice Academy',  'FA',  'EUR', true, 1),
  ('serenamente', 'Serenamente',     'Serenamente',     'SE',  'EUR', true, 2),
  ('fcd',         'FCD Enterprise',  'FCD Enterprise',  'FCD', 'EUR', true, 3)
ON CONFLICT (id) DO NOTHING;

-- Trigger updatedAt — convention di Supabase, replica quello del marketing CRM.
CREATE OR REPLACE FUNCTION set_companies_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW."updatedAt" = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS companies_set_updated_at ON "companies";
CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON "companies"
  FOR EACH ROW EXECUTE FUNCTION set_companies_updated_at();

-- ─── users extension ───────────────────────────────────────────────────
-- companyId: tenant di appartenenza. Default 'fenice' per back-compat con
-- gli utenti esistenti. FK ON UPDATE CASCADE per rinominare tenant in futuro
-- senza orfanizzare righe.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice'
  REFERENCES "companies"("id") ON UPDATE CASCADE;

-- area: discrimina visibilità sales vs marketing. Default 'sales' per gli
-- utenti CRM esistenti (GDO/Conferme/Venditore/Manager). Gli utenti che
-- migreremo dal CRM marketing saranno creati con area='marketing'.
-- Bruno avrà area='both' (settato manualmente dopo apply).
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "area" text NOT NULL DEFAULT 'sales';

ALTER TABLE "users"
  ADD CONSTRAINT "users_area_check"
  CHECK ("area" IN ('sales','marketing','both'));

-- marketingRole: popolato solo per utenti con area in ('marketing','both').
-- Valori: 'manager' | 'media_buyer' | 'copywriter' | 'social'.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "marketingRole" text;

ALTER TABLE "users"
  ADD CONSTRAINT "users_marketing_role_check"
  CHECK ("marketingRole" IS NULL OR "marketingRole" IN ('manager','media_buyer','copywriter','social'));

-- ─── Indici per query frequenti su tenancy ─────────────────────────────
CREATE INDEX IF NOT EXISTS "users_company_area_idx"
  ON "users" ("companyId", "area");

-- NOTE post-apply:
-- 1) Settare manualmente l'account Bruno con area='both':
--      UPDATE "users" SET area='both' WHERE email = 'brunoiacopo02@gmail.com';
--    (sostituire l'email se diversa).
-- 2) I DEFAULT 'fenice' / 'sales' restano in vigore per tutto il refactor.
--    Verranno droppati in una migration finale (M5) dopo che ogni Server
--    Action passerà companyId esplicito.
