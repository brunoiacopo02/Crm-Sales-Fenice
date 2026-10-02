-- 0039: incassi dal gestionale amministrazione (spec 2026-10-02).
--
-- Copia in sola lettura dello snapshot GET /api/v1/contratti del gestionale.
-- Il gestionale e' la fonte di verita': queste righe si riscrivono a ogni sync
-- e non si modificano mai a mano. Gli importi sono in CENTESIMI interi.
-- Un record sparito dallo snapshot non si cancella: prende "deletedAt", cosi'
-- un'eliminazione per errore nel gestionale si ripristina al giro dopo.

create table if not exists public."gestionaleContratti" (
  "id"               text primary key,
  "companyId"        text not null default 'fenice' references public.companies(id) on update cascade,
  "dataFirma"        date,
  "pacchetto"        text,
  "importoTotaleCents" integer not null default 0,
  "statoPagamento"   text,
  "venditoreCode"    text,
  "salesUserId"      text references public.users(id) on delete set null,
  "note"             text,
  "clienteNome"      text,
  "clienteCognome"   text,
  "clienteTelefono"  text,
  "clienteEmail"     text,
  "deletedAt"        timestamptz,
  "syncedAt"         timestamptz not null default now()
);
create index if not exists "gestionale_contratti_sales_idx" on public."gestionaleContratti" ("salesUserId");

create table if not exists public."gestionaleRate" (
  "id"           text primary key,
  "contrattoId"  text not null,
  "numero"       integer,
  "tipo"         text,
  "scadenza"     date,
  "importoCents" integer not null default 0,
  "stato"        text,
  "incassoId"    text,
  "deletedAt"    timestamptz,
  "syncedAt"     timestamptz not null default now()
);
create index if not exists "gestionale_rate_contratto_idx" on public."gestionaleRate" ("contrattoId");

create table if not exists public."gestionaleIncassi" (
  "id"               text primary key,
  "contrattoId"      text not null,
  "data"             date,
  "importoCents"     integer not null default 0,
  "metodo"           text,
  "voce"             text,
  "stato"            text,
  "stornoDi"         text,
  "rataId"           text,
  "venditoreCode"    text,
  "salesUserId"      text references public.users(id) on delete set null,
  "contaCommissione" boolean not null default false,
  "meseCommissione"  text,
  "deletedAt"        timestamptz,
  "syncedAt"         timestamptz not null default now()
);
create index if not exists "gestionale_incassi_sales_mese_idx" on public."gestionaleIncassi" ("salesUserId", "meseCommissione");
create index if not exists "gestionale_incassi_data_idx" on public."gestionaleIncassi" ("data");
create index if not exists "gestionale_incassi_contratto_idx" on public."gestionaleIncassi" ("contrattoId");

-- Una riga per codice venditore e mese, anche a zero: si sostituisce in blocco a ogni sync.
create table if not exists public."gestionaleCommissioni" (
  "venditoreCode"              text not null,
  "mese"                       text not null,
  "salesUserId"                text references public.users(id) on delete set null,
  "totaleIncassatoCents"       integer not null default 0,
  "commissioneLordaCents"      integer not null default 0,
  "commissioneImponibileCents" integer not null default 0,
  "syncedAt"                   timestamptz not null default now(),
  primary key ("venditoreCode", "mese")
);

create table if not exists public."gestionaleSyncRuns" (
  "id"          text primary key,
  "trigger"     text not null,
  "status"      text not null,
  "startedAt"   timestamptz not null default now(),
  "finishedAt"  timestamptz,
  "generatoIl"  text,
  "inserted"    integer not null default 0,
  "updated"     integer not null default 0,
  "deleted"     integer not null default 0,
  "restored"    integer not null default 0,
  "warnings"    jsonb not null default '[]'::jsonb,
  "error"       text
);
create index if not exists "gestionale_sync_runs_started_idx" on public."gestionaleSyncRuns" ("startedAt" desc);

-- Le tabelle non passano da PostgREST: le legge solo il server con Drizzle.
alter table public."gestionaleContratti"   enable row level security;
alter table public."gestionaleRate"        enable row level security;
alter table public."gestionaleIncassi"     enable row level security;
alter table public."gestionaleCommissioni" enable row level security;
alter table public."gestionaleSyncRuns"    enable row level security;
