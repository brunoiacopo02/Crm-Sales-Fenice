-- M2: aggiunge `companyId` text NOT NULL DEFAULT 'fenice' REFERENCES companies(id)
-- su tutti i tavoli sales. Prerequisito: 0005_multitenancy_foundation.sql applicata.
--
-- Skip intenzionali:
--   - `users` (già fatto in 0005)
--   - `creatures` (catalogo gamification globale — decisione Bruno 2026-05-21)
--   - `marketingWebhookDeliveries` (sarà droppato in M5 finale, niente senso retrofittare)
--
-- DEFAULT 'fenice' è temporaneo: serve per non rompere il codice esistente
-- durante il refactor dei Server Action. Sarà rimosso nella migration finale
-- M5 (dopo che ogni insert passa companyId esplicito).
--
-- Apply manuale via SQL editor Supabase. Idempotente (ADD COLUMN IF NOT EXISTS).
-- Apply time atteso: <1s per tavolo su PG 11+ (ADD COLUMN con constant DEFAULT
-- non riscrive la tabella). Totale: ~1 minuto.

ALTER TABLE "leads"                    ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "callLogs"                 ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "leadEvents"               ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "breakSessions"            ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "notifications"            ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "assignmentSettings"       ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "importLogs"               ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "sprints"                  ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "shopItems"                ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "userPurchases"            ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "coinTransactions"         ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "confirmationsNotes"       ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "internalAlerts"           ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "calendarConnections"      ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "calendarEvents"           ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "teamGoals"                ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "marketingBudgets"         ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "monthlyTargets"           ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "dailyKpiSnapshots"        ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "pipelineSnapshots"        ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "gdoNotes"                 ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "quests"                   ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "questProgress"            ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "achievements"             ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "userAchievements"         ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "lootDrops"                ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "bossBattles"              ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "bossContributions"        ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "seasonalEvents"           ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "weeklyGamificationRules"  ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "userCreatures"            ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "adventureProgress"        ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "adventureBosses"          ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "actionChests"             ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "teamRpgProfile"           ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "teamCreatures"            ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "tradingOffers"            ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "duels"                    ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "manualAdjustments"        ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "monthlyLeadTargets"       ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "acIntakeFailures"         ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "gdoLeadSurveys"           ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "confermeLeadSurveys"      ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "salesLeadSurveys"         ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "monthlyFunnelBaselines"   ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "customerPortfolios"       ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;
ALTER TABLE "appSettings"              ADD COLUMN IF NOT EXISTS "companyId" text NOT NULL DEFAULT 'fenice' REFERENCES "companies"("id") ON UPDATE CASCADE;

-- Verifica post-apply:
--   SELECT table_name, column_name, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND column_name='companyId'
--   ORDER BY table_name;
-- Expected: 48 righe, tutte con column_default = '''fenice'''::text
