-- Incidente 2026-07-07: DB Nano saturo (Disk IO/CPU) → Supabase Auth in timeout → login impossibile per tutti.
-- Oltre all'upgrade compute Nano→Micro, questi indici eliminano i 3 hot path che tenevano il DB sotto pressione costante:
--   1. Poll notifiche client (PostgREST): filtra solo recipientUserId + ORDER BY createdAt DESC → era seq scan, 119ms x 32k chiamate
--   2. Poll richiami Conferme: filtro su companyId+confSnoozeAt con confirmationsOutcome IS NULL → era seq scan, ~150k chiamate/giorno
--   3. Conteggi gamification (checkAndAdvanceStage): companyId+userId+eventType+timestamp → 160ms x 37k chiamate
-- Applicati in produzione il 2026-07-07 con CREATE INDEX CONCURRENTLY (qui la forma transazionale per ambienti nuovi).

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
    ON public.notifications ("recipientUserId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS leads_conf_snooze_idx
    ON public.leads ("companyId", "confSnoozeAt")
    WHERE "confirmationsOutcome" IS NULL AND "confSnoozeAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS lead_events_company_user_event_ts_idx
    ON public."leadEvents" ("companyId", "userId", "eventType", "timestamp");

-- Ridondante: prefisso (companyId, userId) coperto dal nuovo indice a 4 colonne → meno write IO
DROP INDEX IF EXISTS lead_events_company_user_idx;
