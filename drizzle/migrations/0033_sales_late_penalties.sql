-- 0033: malus ritardi venditori (decisione PO 2026-09-09).
--
-- Una riga per SCADENZA (appuntamento o follow-up) non esitata oltre 2 ore.
-- A fine mese la trattenuta è la somma di `amountEur` sulle righe del mese.
--
-- L'importo vive sulla riga e non in una costante: se domani la penale passa a
-- 15 euro, i ritardi gia' maturati restano a 10 e lo storico non si riscrive.
--
-- Idempotenza hard: l'unique (leadId, kind, dueAt) impedisce che due giri di
-- cron concorrenti raddoppino la penale sulla stessa scadenza. Un appuntamento
-- rifissato ha una dueAt nuova, quindi puo' generare un nuovo ritardo: e' voluto.

create table if not exists public."salesLatePenalties" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "leadId"      text not null references public.leads(id) on delete cascade,
  "kind"        text not null,
  "dueAt"       timestamptz not null,
  "detectedAt"  timestamptz not null default now(),
  "resolvedAt"  timestamptz,
  "amountEur"   real not null default 10,
  "monthKey"    text not null,
  "createdAt"   timestamptz not null default now()
);

create unique index if not exists "sales_late_penalties_due_uq"
  on public."salesLatePenalties" ("leadId", "kind", "dueAt");

create index if not exists "sales_late_penalties_user_month_idx"
  on public."salesLatePenalties" ("companyId", "salesUserId", "monthKey");

comment on table public."salesLatePenalties" is
  'Ritardi venditori: una riga per scadenza non esitata entro 2h. 10 euro l''una a fine mese.';
comment on column public."salesLatePenalties"."dueAt" is
  'Ora dell''appuntamento o del follow-up da cui parte la grazia di 2 ore.';
comment on column public."salesLatePenalties"."resolvedAt" is
  'Quando il venditore ha finalmente registrato l''esito: dueAt -> resolvedAt = ritardo reale.';
comment on column public."salesLatePenalties"."monthKey" is
  'YYYY-MM della scadenza in Europe/Rome: mese di competenza della trattenuta.';
