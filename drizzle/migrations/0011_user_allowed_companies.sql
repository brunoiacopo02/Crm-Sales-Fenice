-- 0011_user_allowed_companies.sql
-- Lista aziende a cui un utente sales può accedere (staff condiviso).
-- NULL = back-compat: l'app tratta NULL come [companyId].
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_companies" text[];
