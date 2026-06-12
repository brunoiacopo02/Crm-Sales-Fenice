-- Selettore "GDO attivi nelle statistiche" (TL/Manager).
-- statsActive decide quali GDO entrano nei divisori delle medie per-GDO
-- (getManagerOverview, getSalesAlerts). Applicata in prod il 2026-06-12
-- via Supabase MCP (add_users_stats_active).
ALTER TABLE users ADD COLUMN IF NOT EXISTS "statsActive" boolean NOT NULL DEFAULT true;
