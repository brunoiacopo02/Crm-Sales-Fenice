-- 0063: rettifiche manuali del salvadanaio dei GDO (titolare 19/11/2026). Solo aggiunta.
--
-- Una riga per ogni premio extra o malus in euro una tantum, attribuito a una
-- persona e a una settimana lun-sab. Sono eccezioni: la regola dei premi non
-- cambia e lo snapshot di "weeklyPrizeRuns" non si tocca. Il salvadanaio
-- (src/lib/economy/premiMese.ts) le somma sopra, sia alla settimana registrata
-- sia a quella ricalcolata, quindi registrare di nuovo la settimana non le
-- cancella e non le raddoppia. Contano nel mese del sabato della settimana,
-- come le altre voci. Per ora si inseriscono da script, non c'è un form.
--
-- "weekStart": il lunedì della settimana, giorno di Roma (come "weeklyPrizeRuns").
-- "euro": con il segno, positivo = premio, negativo = malus.
-- "motivo": testo breve che legge il GDO ("Premio extra", "Malus presenze").
-- "nota": testo interno, il GDO non lo vede.

create table if not exists public."salvadanaioRettifiche" (
    "id" text primary key,
    "companyId" text not null default 'fenice' references public.companies("id") on update cascade,
    "userId" text not null references public.users("id"),
    "weekStart" date not null check (extract(isodow from "weekStart") = 1),
    "euro" numeric(10, 2) not null check ("euro" <> 0),
    "motivo" text not null check (char_length("motivo") between 1 and 60),
    "nota" text,
    "createdById" text not null references public.users("id"),
    "createdAt" timestamptz not null default now()
);
create index if not exists salvadanaio_rettifiche_company_week_idx
    on public."salvadanaioRettifiche" ("companyId", "weekStart");
-- Una sola voce per persona, settimana e motivo: rilanciare lo script non raddoppia.
create unique index if not exists salvadanaio_rettifiche_unica_idx
    on public."salvadanaioRettifiche" ("companyId", "userId", "weekStart", "motivo");

-- Il CRM la legge e la scrive solo lato server (Drizzle, ruolo owner).
alter table public."salvadanaioRettifiche" enable row level security;
