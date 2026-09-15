-- Due pool separati per i GDO + tetto giornaliero sui lead freschi + marcatore
-- di infornata sui lead. Deciso dal PO il 15/09/2026, dopo il flood della lista
-- AC 133 che ha riempito le pipeline di lead database ridati dal bot.
--
-- Fino a oggi `acAutoIntake` era un interruttore UNICO: chi lo aveva acceso
-- riceveva sia i lead freschi dal webhook AC sia quelli che il bot restituisce.
-- Da qui i due flussi si separano:
--   acAutoIntake        -> pool dei lead FRESCHI  (significato invariato)
--   botReturnIntake     -> pool dei lead RIDATI dal bot (nuovo)
--   freshOverflowScorta -> riceve i freschi in eccedenza oltre il tetto
--   dailyFreshCap       -> tetto giornaliero di freschi (giorno di Roma), null = nessuno
--
-- APPLICATA IN PRODUZIONE il 15/09/2026 (come `0037_gdo_pools_schema`).
-- L'assegnazione dei GDO ai pool sta in 0038, che va eseguita DOPO il deploy
-- del codice: prima del deploy `reassign.ts` legge ancora `acAutoIntake`, e
-- togliere quel flag a chi lavora i ridati li manderebbe ai GDO sbagliati.

-- Marcatore di infornata sui lead: isola un blocco entrato insieme senza doverlo
-- ritrovare a colpi di intervallo su createdAt. Primo uso: i lead della lista AC
-- 133 entrati per errore il 15/09/2026.
alter table leads add column if not exists "intakeBatch" text;
create index if not exists leads_intake_batch_idx
  on leads ("companyId", "intakeBatch") where "intakeBatch" is not null;

alter table users add column if not exists "botReturnIntake" boolean not null default false;
alter table users add column if not exists "botReturnLastAssignedAt" timestamptz;
alter table users add column if not exists "freshOverflowScorta" boolean not null default false;
alter table users add column if not exists "dailyFreshCap" integer;

-- Round-robin del pool ridati: stesso schema dell'indice usato per i freschi.
-- Parziale, perche' la query filtra sempre su botReturnIntake = true.
create index if not exists users_bot_return_pool_idx
  on users ("companyId", "botReturnLastAssignedAt" nulls first, id)
  where "botReturnIntake" = true;
