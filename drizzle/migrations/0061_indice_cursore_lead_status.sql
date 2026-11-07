-- 0061: indice per il cursore composto di /api/bot/lead-status (contratto v1.14).
-- Il feed pagina su ("updatedAt", id) con una row comparison; senza indice ogni pagina
-- scorre tutta leads. CONCURRENTLY: niente lock in scrittura su leads (va lanciato
-- fuori da una transazione). Solo aggiunta.
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_updatedat_id_idx ON public.leads ("updatedAt", id);
