-- Coda operativa delle richieste di contatto umano arrivate dal bot fissatore.
-- Fino a oggi erano solo eventi in timeline + una notifica: su 53 richieste una
-- sola era stata lavorata. L'evento resta (audit), qui vive lo stato.

CREATE TABLE IF NOT EXISTS "botContactRequests" (
    "id" text PRIMARY KEY NOT NULL,
    "leadId" text NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "category" text DEFAULT 'altro' NOT NULL,
    "reason" text NOT NULL,
    "leadInfo" jsonb,
    "updatesCount" integer DEFAULT 1 NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "assignedToId" text REFERENCES "users"("id"),
    "assignedByUserId" text REFERENCES "users"("id"),
    "assignedAt" timestamptz,
    "closedAt" timestamptz,
    "closedByUserId" text REFERENCES "users"("id"),
    "createdAt" timestamptz DEFAULT now() NOT NULL,
    "updatedAt" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "bot_contact_requests_status_created_idx"
    ON "botContactRequests" ("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "bot_contact_requests_lead_idx"
    ON "botContactRequests" ("leadId");

-- Backfill dell'arretrato: una riga per lead, dall'ultimo evento di richiesta.
-- Sono le 53 richieste storiche, di cui una sola era stata lavorata.
INSERT INTO "botContactRequests" ("id", "leadId", "companyId", "category", "reason", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    e."leadId",
    'fenice',
    'altro',
    COALESCE(NULLIF(TRIM(e.metadata->>'note'), ''), 'Richiesta di contatto senza testo'),
    e.timestamp,
    e.timestamp
FROM (
    SELECT DISTINCT ON ("leadId") "leadId", metadata, timestamp
    FROM "leadEvents"
    WHERE "eventType" = 'BOT_CONTACT_REQUEST'
    ORDER BY "leadId", timestamp DESC
) e
JOIN "leads" l ON l."id" = e."leadId"
WHERE NOT EXISTS (
    SELECT 1 FROM "botContactRequests" r WHERE r."leadId" = e."leadId"
);
