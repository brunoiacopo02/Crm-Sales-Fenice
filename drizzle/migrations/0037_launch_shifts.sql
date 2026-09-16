-- 0037: turni venditori del lancio Web Dev AI (spec 2026-09-14 §3.1).
--
-- Una riga = un venditore in un turno. kind: 'SERA' (chiamate subito la sera
-- del webinar) | 'GIORNO_DOPO' (appuntamenti 9-15 del giorno dopo).
-- Il round robin ordina per coalesce(lastAssignedAt,'epoch'), salesUserId.
--
-- removedAt/removedBy al posto di un DELETE: leadEvents richiede un leadId e un
-- cambio di turno non ne ha, quindi la storia sta qui. Chi legge filtra
-- removedAt IS NULL; rimettere un venditore riattiva la riga (unique).

create table if not exists public."launchShifts" (
  "id"             text primary key,
  "companyId"      text not null default 'fenice' references public.companies(id) on update cascade,
  "bucket"         text not null,
  "kind"           text not null,
  "salesUserId"    text not null references public.users(id) on delete cascade,
  "lastAssignedAt" timestamptz,
  "removedAt"      timestamptz,
  "removedBy"      text references public.users(id),
  "createdBy"      text references public.users(id),
  "createdAt"      timestamptz not null default now()
);

create unique index if not exists "launch_shifts_uq"
  on public."launchShifts" ("bucket", "kind", "salesUserId");
create index if not exists "launch_shifts_bucket_kind_idx"
  on public."launchShifts" ("companyId", "bucket", "kind");

comment on table public."launchShifts" is
  'Turni venditori dei lanci: SERA = chiamate subito, GIORNO_DOPO = appuntamenti mattina. Round robin su lastAssignedAt.';
