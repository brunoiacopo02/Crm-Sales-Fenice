-- 0049: premi in euro della settimana (PO 25/10/2026, seconda tornata). Solo aggiunte.
--
-- Una riga per settimana lun-sab, registrata dall'admin a settimana chiusa da
-- /admin/diretta/premi-settimana: classifica dei primi tre (1° 50, 2° 25,
-- 3° 10 euro lordi), bonus presenze dei GDO (12 euro dalla 5ª presenza) e
-- bonus di squadra delle Conferme (12 euro a testa per ogni chiusura oltre la
-- soglia). Lo snapshot tiene chi, quanto e su quali numeri, così i bonus da
-- pagare non cambiano se dopo cambiano i lead. Ricalcolare la settimana
-- riscrive la riga.

create table if not exists public."weeklyPrizeRuns" (
    "companyId" text not null default 'fenice' references public.companies("id") on update cascade,
    "weekStart" date not null,                 -- lunedì della settimana, giorno di Roma
    "snapshot" jsonb not null,
    "totalEur" numeric(10, 2) not null check ("totalEur" >= 0),
    "computedAt" timestamptz not null default now(),
    "computedBy" text references public.users("id"),
    primary key ("companyId", "weekStart")
);

-- Il CRM la legge e la scrive solo lato server (Drizzle, ruolo owner).
alter table public."weeklyPrizeRuns" enable row level security;
