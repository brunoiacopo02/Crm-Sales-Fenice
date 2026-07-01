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
    "companyId" text DEFAULT 'fenice' NOT NULL
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
    "companyId" text DEFAULT 'fenice' NOT NULL
);

CREATE INDEX IF NOT EXISTS "sales_attempts_lead_idx" ON "salesAttempts" ("leadId");
CREATE INDEX IF NOT EXISTS "sales_attempts_user_date_idx" ON "salesAttempts" ("salesUserId", "outcomeAt");
CREATE INDEX IF NOT EXISTS "sales_attempts_company_date_idx" ON "salesAttempts" ("companyId", "outcomeAt");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_weekly_focus_user_week_uq" ON "salesWeeklyFocus" ("salesUserId", "weekStart");
