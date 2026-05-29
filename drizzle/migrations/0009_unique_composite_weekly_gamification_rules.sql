-- 0009: convert single-column UNIQUE on weeklyGamificationRules.month to composite with companyId.
-- Required before Serenamente go-live: saveGamificationRule() in gdoPerformanceActions now upserts
-- on [month, companyId] composite. Without this constraint Serenamente's first weekly rule for a
-- month already populated by Fenice would conflict.

ALTER TABLE "weeklyGamificationRules" DROP CONSTRAINT IF EXISTS "weeklyGamificationRules_month_unique";
ALTER TABLE "weeklyGamificationRules"
  ADD CONSTRAINT "weeklyGamificationRules_month_companyId_unique" UNIQUE ("month", "companyId");
