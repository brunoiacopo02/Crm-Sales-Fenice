-- 0050: account e lead di prova (PO 25/10/2026).
--
-- Solo aggiunte: due colonne booleane con default false. Nessun dato cambia e
-- su Postgres l'aggiunta è istantanea, senza riscrivere la tabella leads.
--
-- * users.isTest: account di prova (prova.gdo@fenice.local e
--   prova.conferme@fenice.local, creati da scripts/diretta/prova-setup.ts).
--   Lavorano come un GDO e una Conferma veri, ma restano fuori da squadra,
--   classifica, cronaca, forzieri, bonus, KPI e instradamento automatico.
-- * leads.isTest: lead di prova, dati solo agli account di prova. Fuori da KPI,
--   pool, bot, ActiveCampaign, webhook marketing e dalla board delle Conferme
--   vere. Lo scrive solo prova-setup.ts; prova-pulizia.ts cancella soltanto le
--   righe che lo hanno.
--
-- DA APPLICARE PRIMA DEL DEPLOY: lo schema Drizzle legge users."isTest" e
-- leads."isTest", e senza le colonne ogni select su quelle tabelle fallisce.

alter table public.users add column if not exists "isTest" boolean not null default false;
alter table public.leads add column if not exists "isTest" boolean not null default false;
