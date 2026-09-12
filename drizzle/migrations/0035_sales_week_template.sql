-- 0035: settimana tipo dei venditori (decisione PO 2026-09-12, opzione B).
--
-- Il modello e' per-utente come le altre tabelle del calendario: il calendario
-- di una persona e' suo, non dell'azienda su cui ha fatto login. companyId
-- resta come provenienza, non come filtro.
--
-- `fromTemplate` su salesWeekPlans distingue una settimana compilata a mano da
-- una materializzata dal modello: senza, la scheda Compilazione diventa un muro
-- di spunte verdi e si perde di vista chi si occupa davvero del proprio calendario.

create table if not exists public."salesWeekTemplateSlots" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "dow"         integer not null,
  "hour"        integer not null,
  "createdAt"   timestamptz not null default now()
);

create unique index if not exists "sales_week_template_uq"
  on public."salesWeekTemplateSlots" ("salesUserId", "dow", "hour");

alter table public."salesWeekPlans" add column if not exists "fromTemplate" boolean not null default false;

comment on table public."salesWeekTemplateSlots" is
  'Settimana tipo: le ore che un venditore offre di solito. Materializzata in salesAvailabilitySlots dal cron.';
comment on column public."salesWeekPlans"."fromTemplate" is
  'true = settimana compilata dal modello, non a mano.';
