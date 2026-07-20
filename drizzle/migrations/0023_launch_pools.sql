-- Registro dei pool di /import (spec 2026-07-20-database-month-pools).
-- kind: 'DATABASE_MONTH' (pool mensili da AC) | 'LAUNCH' (lanci, es. Black Summer).
-- archivedAt != NULL => card nascosta su /import (i lead assegnati restano intatti).
CREATE TABLE IF NOT EXISTS "launchPools" (
    "id" text PRIMARY KEY,
    "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE,
    "bucket" text NOT NULL,
    "kind" text NOT NULL,
    "label" text NOT NULL,
    "monthKey" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "createdBy" text,
    "archivedAt" timestamptz,
    "archivedBy" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "launch_pools_company_bucket_uq"
    ON "launchPools" ("companyId", "bucket");

-- Backfill: la card Black Summer acquisisce il pulsante "Rimuovi pool".
INSERT INTO "launchPools" ("id", "companyId", "bucket", "kind", "label", "monthKey")
VALUES (gen_random_uuid()::text, 'fenice', 'BLACK_SUMMER', 'LAUNCH', 'Pool Lancio Black Summer', NULL)
ON CONFLICT DO NOTHING;
