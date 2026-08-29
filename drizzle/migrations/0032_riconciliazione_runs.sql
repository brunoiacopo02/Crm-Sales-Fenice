-- Storico delle riconciliazioni CRM <-> Database Clienti.
-- Serve a rendere annullabile ogni applicazione: prima di ogni scrittura
-- salviamo lo stato precedente dei campi toccati.
CREATE TABLE IF NOT EXISTS "riconciliazioneRuns" (
    "id" text PRIMARY KEY,
    "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE,
    "monthKey" text NOT NULL,
    "source" text NOT NULL,
    "appliedBy" text NOT NULL REFERENCES "users"("id"),
    "appliedAt" timestamptz NOT NULL DEFAULT now(),
    "entryCount" integer NOT NULL DEFAULT 0,
    "revertedAt" timestamptz,
    "revertedBy" text REFERENCES "users"("id")
);

CREATE TABLE IF NOT EXISTS "riconciliazioneEntries" (
    "id" text PRIMARY KEY,
    "runId" text NOT NULL REFERENCES "riconciliazioneRuns"("id") ON DELETE CASCADE,
    "leadId" text REFERENCES "leads"("id") ON DELETE SET NULL,
    "family" text NOT NULL,
    "createdLead" boolean NOT NULL DEFAULT false,
    "before" jsonb NOT NULL,
    "after" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "riconciliazione_runs_month_idx" ON "riconciliazioneRuns" ("companyId", "monthKey", "appliedAt");
CREATE INDEX IF NOT EXISTS "riconciliazione_entries_run_idx" ON "riconciliazioneEntries" ("runId");
