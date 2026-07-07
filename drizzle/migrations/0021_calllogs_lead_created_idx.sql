-- 0021: indice per la card "Resa per tentativo" (getGdoCallAttemptMetrics).
-- La CTE ranked fa row_number() OVER (PARTITION BY leadId ORDER BY createdAt, id)
-- sull'intera storia callLogs della company: senza indice il sort spillava su
-- disco (~12MB di temp file scritti + riletti A OGNI caricamento della card) —
-- consumo diretto di Disk IO Budget. Con l'indice il planner usa un index scan
-- in window order: sort eliminato, zero temp IO (240ms -> 183ms).
-- Bonus: callLogs non aveva alcun indice su leadId — il prefisso serve anche i
-- lookup per-lead (timeline chiamate ContactDrawer, prima seq scan).
-- Applicato in produzione il 2026-07-07 con CREATE INDEX CONCURRENTLY.

CREATE INDEX IF NOT EXISTS calllogs_lead_created_id_idx
    ON public."callLogs" ("leadId", "createdAt", id);
