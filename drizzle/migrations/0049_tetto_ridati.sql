-- 0049: tetto giornaliero dei ridati per GDO (PO 25/10/2026 mattina).
--
-- Solo un'aggiunta: colonna nullable senza default, quindi nessun dato cambia
-- e la modifica è istantanea. NULL = nessun tetto, come oggi per tutti.
--
-- Perché: Lorenzo (118) riceverà lead nuovi solo quando Bruno lo accende da
-- /gestione, con un tetto di 30 al giorno. /gestione aveva il tetto solo per i
-- freschi (dailyFreshCap); i ridati dal bot non ne avevano uno dal 19/10.
--
-- DA APPLICARE PRIMA DEL DEPLOY: lo schema Drizzle legge users."dailyReturnCap"
-- e senza la colonna ogni select sulla tabella users fallisce.

alter table public.users add column if not exists "dailyReturnCap" integer;
