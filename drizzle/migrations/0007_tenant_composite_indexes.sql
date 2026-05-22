-- M3: indici composti (companyId, ...) sui tavoli sales critici.
-- Prerequisito: 0006_companyid_on_sales_tables.sql applicata.
--
-- Strategia: NON sostituiamo gli indici esistenti; aggiungiamo nuovi indici
-- composti col companyId come prima colonna. Su tutte le query post-refactor
-- il filtro companyId sarà la prima condizione → planner usa l'indice nuovo.
-- Le query legacy senza companyId continuano a usare gli indici vecchi.
--
-- CONCURRENTLY: non blocca la tabella. Importante su `leads` (potenzialmente
-- centinaia di migliaia di righe). Su tavoli piccoli è zero costo.
--
-- Apply manuale via SQL editor Supabase. Idempotente (IF NOT EXISTS).
-- ATTENZIONE: in Postgres CREATE INDEX CONCURRENTLY non può essere dentro
-- una transaction block. Esegui ogni statement separatamente o usa il
-- SQL editor con "Run as script" che lo gestisce.

-- ─── leads — indici composti per query GDO/Conferme/Venditore ──────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_status_idx"
  ON "leads" ("companyId", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_assigned_idx"
  ON "leads" ("companyId", "assignedToId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_assigned_status_idx"
  ON "leads" ("companyId", "assignedToId", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_appointment_idx"
  ON "leads" ("companyId", "appointmentDate");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_recall_idx"
  ON "leads" ("companyId", "assignedToId", "recallDate");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_funnel_idx"
  ON "leads" ("companyId", "funnel");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_created_idx"
  ON "leads" ("companyId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_company_salesperson_idx"
  ON "leads" ("companyId", "salespersonUserId");

-- ─── callLogs ──────────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calllogs_company_user_created_idx"
  ON "callLogs" ("companyId", "userId", "createdAt" DESC);

-- ─── leadEvents — timeline lead per company ────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "lead_events_company_lead_idx"
  ON "leadEvents" ("companyId", "leadId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "lead_events_company_user_idx"
  ON "leadEvents" ("companyId", "userId");

-- ─── questProgress + userAchievements + userCreatures — gamification ───
CREATE INDEX CONCURRENTLY IF NOT EXISTS "quest_progress_company_user_date_idx"
  ON "questProgress" ("companyId", "userId", "dateScope");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_achievements_company_user_idx"
  ON "userAchievements" ("companyId", "userId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_creatures_company_user_idx"
  ON "userCreatures" ("companyId", "userId");

-- ─── customerPortfolios ────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_portfolios_company_salesperson_idx"
  ON "customerPortfolios" ("companyId", "salespersonUserId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_portfolios_company_signed_idx"
  ON "customerPortfolios" ("companyId", "contractSignedAt" DESC);

-- ─── notifications, breakSessions, coinTransactions — query user-scoped ─
-- Nota nomi colonne: notifications usa `recipientUserId`, breakSessions usa
-- `gdoUserId` — NON `userId` (verificato 2026-05-22 con information_schema).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_company_recipient_idx"
  ON "notifications" ("companyId", "recipientUserId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "break_sessions_company_gdo_user_idx"
  ON "breakSessions" ("companyId", "gdoUserId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "coin_transactions_company_user_idx"
  ON "coinTransactions" ("companyId", "userId");

-- ─── pipelineSnapshots — audit lead spariti ───────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pipeline_snapshots_company_user_idx"
  ON "pipelineSnapshots" ("companyId", "userId");

-- Verifica post-apply:
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND indexname LIKE '%_company_%_idx'
--   ORDER BY tablename, indexname;
-- Expected: ~20 indici composti aggiunti.
