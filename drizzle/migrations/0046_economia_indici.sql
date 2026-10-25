-- 0046: indici per la nuova economia (PO 25/10/2026). Solo aggiunte.
--
-- * currencyLedger("leadId"): a ogni esito delle Conferme e dei venditori il
--   CRM rilegge le righe del lead per accreditare o stornare le Piume, e a ogni
--   appuntamento per la regola dei 30 giorni. Senza indice è una scansione
--   dell'intero registro, che cresce di un centinaio di righe al giorno.
-- * teamChestAwards("userId"): "i miei forzieri ancora chiusi", letta dalla
--   home dei GDO.
--
-- Il codice funziona anche prima di questa migrazione, solo più lento.

create index if not exists currency_ledger_lead_idx on public."currencyLedger" ("leadId");
create index if not exists team_chest_awards_user_idx on public."teamChestAwards" ("userId", "createdAt");
