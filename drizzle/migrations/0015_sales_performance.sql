CREATE TABLE IF NOT EXISTS "salesAttempts" (
    "id" text PRIMARY KEY NOT NULL,
    "leadId" text NOT NULL,
    "salesUserId" text NOT NULL,
    "attemptNumber" integer NOT NULL,
    "outcome" text NOT NULL,
    "notClosedReason" text,
    "nextFollowUpDate" timestamptz,
    "closeProduct" text,
    "closeAmountEur" real,
    "outcomeAt" timestamptz NOT NULL,
    "createdAt" timestamptz DEFAULT now() NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "salesWeeklyFocus" (
    "id" text PRIMARY KEY NOT NULL,
    "salesUserId" text NOT NULL,
    "weekStart" text NOT NULL,
    "objection" text,
    "taskNote" text DEFAULT '' NOT NULL,
    "createdBy" text NOT NULL,
    "createdAt" timestamptz DEFAULT now() NOT NULL,
    "updatedAt" timestamptz DEFAULT now() NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sales_attempts_lead_idx" ON "salesAttempts" ("leadId");
CREATE INDEX IF NOT EXISTS "sales_attempts_user_date_idx" ON "salesAttempts" ("salesUserId", "outcomeAt");
CREATE INDEX IF NOT EXISTS "sales_attempts_company_date_idx" ON "salesAttempts" ("companyId", "outcomeAt");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_weekly_focus_user_week_uq" ON "salesWeeklyFocus" ("companyId", "salesUserId", "weekStart");

-- Fix schema drift: le tabelle sono già state applicate in produzione (0 righe,
-- create senza la FK inline sopra riportata). Le CREATE TABLE IF NOT EXISTS sopra
-- non alterano tabelle già esistenti, quindi qui aggiungiamo la FK mancante in modo
-- idempotente (ADD CONSTRAINT non supporta nativamente IF NOT EXISTS).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'salesAttempts_companyId_companies_id_fk'
    ) THEN
        ALTER TABLE "salesAttempts"
            ADD CONSTRAINT "salesAttempts_companyId_companies_id_fk"
            FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'salesWeeklyFocus_companyId_companies_id_fk'
    ) THEN
        ALTER TABLE "salesWeeklyFocus"
            ADD CONSTRAINT "salesWeeklyFocus_companyId_companies_id_fk"
            FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON UPDATE CASCADE;
    END IF;
END $$;
