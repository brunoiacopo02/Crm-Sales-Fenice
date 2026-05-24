-- 0008: convert single-column UNIQUE on monthlyTargets.month and dailyKpiSnapshots.date
-- to composite UNIQUE with companyId.
-- Required before Serenamente go-live (<2026-06-04): without this, Serenamente's first
-- target/snapshot save conflicts with the existing Fenice row for the same month/date.

ALTER TABLE "monthlyTargets" DROP CONSTRAINT IF EXISTS "monthlyTargets_month_unique";
ALTER TABLE "monthlyTargets"
  ADD CONSTRAINT "monthlyTargets_month_companyId_unique" UNIQUE ("month", "companyId");

ALTER TABLE "dailyKpiSnapshots" DROP CONSTRAINT IF EXISTS "dailyKpiSnapshots_date_unique";
ALTER TABLE "dailyKpiSnapshots"
  ADD CONSTRAINT "dailyKpiSnapshots_date_companyId_unique" UNIQUE ("date", "companyId");
