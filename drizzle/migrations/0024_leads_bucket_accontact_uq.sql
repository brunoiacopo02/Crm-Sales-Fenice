-- Idempotenza hard dei sync pool (review Task 3, spec 2026-07-20): due sync
-- concorrenti dello stesso mese non possono duplicare un contatto AC nel
-- bucket. Parziale: lead senza bucket o senza acContactId (import manuali,
-- webhook con duplicati voluti) restano liberi.
CREATE UNIQUE INDEX IF NOT EXISTS "leads_company_bucket_accontact_uq"
    ON "leads" ("companyId", "launchBucket", "acContactId")
    WHERE "launchBucket" IS NOT NULL AND "acContactId" IS NOT NULL;
