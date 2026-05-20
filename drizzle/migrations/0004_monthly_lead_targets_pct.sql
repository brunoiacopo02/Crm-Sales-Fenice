-- Aggiunge target percentuali manuali per la tabella "Numeri Mensili".
-- Quando valorizzati (> 0) sovrascrivono le percentuali a cascata calcolate
-- in getMetricsOverview; quando 0/null si applica il fallback cascade.
ALTER TABLE "monthlyLeadTargets" ADD COLUMN "targetAppPct" real DEFAULT 0 NOT NULL;
ALTER TABLE "monthlyLeadTargets" ADD COLUMN "targetConfPct" real DEFAULT 0 NOT NULL;
ALTER TABLE "monthlyLeadTargets" ADD COLUMN "targetPresPct" real DEFAULT 0 NOT NULL;
ALTER TABLE "monthlyLeadTargets" ADD COLUMN "targetClosePct" real DEFAULT 0 NOT NULL;
