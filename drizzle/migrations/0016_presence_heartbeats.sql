-- Task P1 (2026-07-05): heartbeat su DB come fonte di verità della presence
-- Conferme. Il Realtime Supabase (channel `conferme_realtime_board`, vedi
-- src/lib/confermePresence.ts) resta il segnale "instant" ma è inaffidabile
-- su reti/tab instabili. Il client fa upsert su questa tabella ogni 45s + a
-- ogni cambio attività; il Radar considera "presente" chi ha un heartbeat
-- fresco (< 90s) qui OPPURE è visibile via Realtime.
--
-- NOTA: `npx drizzle-kit generate` non è utilizzabile in questo repo perché
-- drizzle/meta/_journal.json traccia solo le migrazioni 0000/0001/0003 (drift
-- noto: 0004-0015 sono state scritte a mano e applicate in prod via Supabase
-- MCP, bypassando il journal locale). Il generate propone un diff enorme e
-- non pertinente (rename/drop su tabelle preesistenti) — file scritto a mano
-- seguendo lo stesso pattern delle migrazioni precedenti (CREATE TABLE IF NOT
-- EXISTS, nessuna operazione distruttiva).
CREATE TABLE IF NOT EXISTS "presenceHeartbeats" (
    "userId" text PRIMARY KEY NOT NULL,
    "companyId" text DEFAULT 'fenice' NOT NULL REFERENCES "companies"("id") ON UPDATE CASCADE,
    "activity" text NOT NULL,
    "leadId" text,
    "updatedAt" timestamptz DEFAULT now() NOT NULL
);
