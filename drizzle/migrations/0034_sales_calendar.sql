-- 0034: calendario disponibilita' venditori (spec PO 2026-09-12).
--
-- Tre tabelle nuove + due multe nuove sul registro esistente.
-- La disponibilita' e' una DICHIARAZIONE: la riga esiste = quell'ora e' offerta.
-- I blocchi sono righe a parte perche' due follow-up possono cadere nella stessa
-- ora e il rilascio deve togliere solo il proprio.

create table if not exists public."salesAvailabilitySlots" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "slotStart"   timestamptz not null,
  "weekStart"   date not null,
  "createdAt"   timestamptz not null default now()
);

create unique index if not exists "sales_availability_slot_uq"
  on public."salesAvailabilitySlots" ("salesUserId", "slotStart");
create index if not exists "sales_availability_week_idx"
  on public."salesAvailabilitySlots" ("companyId", "weekStart");
create index if not exists "sales_availability_slot_idx"
  on public."salesAvailabilitySlots" ("companyId", "slotStart");

create table if not exists public."salesSlotBlocks" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "slotStart"   timestamptz not null,
  "kind"        text not null,
  "leadId"      text references public.leads(id) on delete cascade,
  "note"        text,
  "createdBy"   text references public.users(id),
  "createdAt"   timestamptz not null default now()
);

create index if not exists "sales_slot_blocks_user_slot_idx"
  on public."salesSlotBlocks" ("companyId", "salesUserId", "slotStart");
-- Un lead tiene al massimo uno slot: spostare il follow-up SPOSTA il blocco.
create unique index if not exists "sales_slot_blocks_followup_uq"
  on public."salesSlotBlocks" ("salesUserId", "leadId") where "kind" = 'FOLLOWUP';
-- Un solo blocco manuale per slot.
create unique index if not exists "sales_slot_blocks_manual_uq"
  on public."salesSlotBlocks" ("salesUserId", "slotStart") where "kind" = 'MANUAL';

create table if not exists public."salesWeekPlans" (
  "id"          text primary key,
  "companyId"   text not null default 'fenice' references public.companies(id) on update cascade,
  "salesUserId" text not null references public.users(id) on delete cascade,
  "weekStart"   date not null,
  "submittedAt" timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now(),
  "slotCount"   integer not null default 0,
  "late"        boolean not null default false
);

create unique index if not exists "sales_week_plans_uq"
  on public."salesWeekPlans" ("salesUserId", "weekStart");
create index if not exists "sales_week_plans_week_idx"
  on public."salesWeekPlans" ("companyId", "weekStart");

-- Multe: le due nuove non hanno un lead (CALENDAR_MISSING) o ce l'hanno solo
-- a volte (ABSENT_SLOT), quindi leadId diventa nullable.
alter table public."salesLatePenalties" alter column "leadId" drop not null;
alter table public."salesLatePenalties" add column if not exists "reportedBy" text references public.users(id);
alter table public."salesLatePenalties" add column if not exists "note" text;
alter table public."salesLatePenalties" add column if not exists "voidedAt" timestamptz;
alter table public."salesLatePenalties" add column if not exists "voidedBy" text references public.users(id);
alter table public."salesLatePenalties" add column if not exists "voidReason" text;

-- L'unique esistente (leadId, kind, dueAt) non protegge le multe nuove: in
-- Postgres due NULL non collidono, e un ABSENT_SLOT con lead e uno senza sullo
-- stesso slot non collidono nemmeno. Per le due multe nuove la chiave e'
-- venditore + tipo + scadenza, il leadId non conta.
create unique index if not exists "sales_penalties_userkind_uq"
  on public."salesLatePenalties" ("salesUserId", "kind", "dueAt")
  where "kind" in ('CALENDAR_MISSING', 'ABSENT_SLOT');

alter table public.users add column if not exists "calendarExempt" boolean not null default false;
update public.users set "calendarExempt" = true where email = 'sales001@fenice.com';

comment on table public."salesAvailabilitySlots" is
  'Disponibilita'' dichiarata dai venditori: una riga = un''ora offerta.';
comment on table public."salesSlotBlocks" is
  'Blocchi su uno slot: MANUAL (imprevisto, min 1h di preavviso) o FOLLOWUP (automatico).';
comment on table public."salesWeekPlans" is
  'Registro della compilazione settimanale: submittedAt e'' la prova per la multa del lunedi.';
comment on column public.users."calendarExempt" is
  'true = niente obbligo di compilare, niente promemoria, niente multe calendario (Sales 001).';
