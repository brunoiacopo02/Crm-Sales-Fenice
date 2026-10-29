-- 0057: obiettivi di fatturato dei venditori INDIVIDUALI e PER MESE (PO 29/10/2026).
--
-- Una riga per venditore per mese. Un mese senza riga prende l'ultima riga
-- precedente dello stesso venditore (src/lib/venditore/obiettivi.ts).
-- Ottobre 2026 = 74.000 / 86.500 per tutti i venditori, Marco (Sales 002) compreso.
-- Le colonne fisse users.salesTargetEur/salesTarget2Eur si tolgono con la 0058,
-- DOPO il deploy del codice che non le legge piu'.

create table if not exists public."salesMonthlyTargets" (
  "salesUserId" text not null references public.users(id) on delete cascade,
  "yearMonth" text not null,
  "companyId" text not null default 'fenice' references public.companies(id) on update cascade,
  "target1Eur" real,
  "target2Eur" real,
  "updatedAt" timestamptz not null default now(),
  "updatedBy" text,
  primary key ("salesUserId", "yearMonth")
);

alter table public."salesMonthlyTargets" enable row level security;

insert into public."salesMonthlyTargets" ("salesUserId", "yearMonth", "companyId", "target1Eur", "target2Eur", "updatedBy")
select id, '2026-10', "companyId", 74000, 86500, 'migr-0057'
from public.users where role = 'VENDITORE'
on conflict ("salesUserId", "yearMonth") do nothing;
