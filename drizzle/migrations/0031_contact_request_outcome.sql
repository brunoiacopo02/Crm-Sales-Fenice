-- Il ritorno sui contatti umani: chi l'ha presa in carico, quando, com'e' finita.
-- Oggi il fornitore consegna la richiesta e finisce li': il bot resta zitto su
-- quella chat all'infinito anche quando il caso e' chiuso da settimane, e
-- nessuno dei due puo' dire se la sezione sta funzionando.
--
-- "presoInCaricoDa"/"Il" NON diventano colonne nuove: sono gia' assignedToId e
-- assignedAt. Due campi che dicono la stessa cosa divergono al primo percorso
-- che ne aggiorna uno solo.

ALTER TABLE "botContactRequests" ADD COLUMN IF NOT EXISTS "outcome" text;
ALTER TABLE "botContactRequests" ADD COLUMN IF NOT EXISTS "outcomeAt" timestamptz;
ALTER TABLE "botContactRequests" ADD COLUMN IF NOT EXISTS "note" text;

-- Chiave persona per il dedup verso il bot: ultime 10 cifre del telefono.
-- Oggi non esiste NESSUN indice su leads.phone, ne' semplice ne' expression:
-- una lookup storica senza finestra temporale sarebbe un seq scan su 59k righe
-- a ogni webhook.
-- 10 cifre e non 9: a 9 si fondono 134 gruppi di numeri realmente diversi
-- (6.565 gruppi a 9 cifre contro 6.459 a 10).
CREATE INDEX IF NOT EXISTS "leads_company_phonekey_idx"
    ON "leads" ("companyId", (right(regexp_replace("phone", '\D', '', 'g'), 10)));
