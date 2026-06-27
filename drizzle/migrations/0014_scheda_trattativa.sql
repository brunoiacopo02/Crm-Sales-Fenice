ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "negotiationStartedAt" timestamptz;

ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "works" boolean;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "painPoints" text[];
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "urgency" text;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "budgetSignal" text;
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "objections" text[];
ALTER TABLE "confermeLeadSurveys" ADD COLUMN IF NOT EXISTS "levaConsigliata" text;

CREATE INDEX IF NOT EXISTS "leads_overdue_idx" ON "leads" ("salespersonUserId", "appointmentDate", "salespersonOutcome");
