-- 0012: badge "richiamo non risposto" — applied in prod 2026-06-11 via Supabase MCP
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "recallMissedAt" timestamptz;
