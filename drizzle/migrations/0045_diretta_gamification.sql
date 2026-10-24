-- 0045: restyle "Diretta" e nuova gamification (PO 25/10/2026).
--
-- Solo aggiunte: nessuna colonna o tabella esistente viene toccata.
-- * users.firstName: nome vero da mostrare nelle schermate (name/displayName
--   restano "GDO 1xx" perché li usano bot, cron di riscaldamento e webhook).
--   Chi ha firstName ed è GDO attivo fa parte della squadra.
-- * Saldi Scintille (ritmo) e Piume (risultati verificati) con un registro
--   unico idempotente: ogni accredito ha una chiave univoca, gli storni sono
--   righe negative con la loro chiave.
-- * Forzieri di squadra: uno per scalino al giorno, assegnato una volta sola.
-- * Negozio nuovo (rewardItems/rewardPurchases): i vecchi shopItems restano.
-- * Citazione del giorno e consiglio di vendita, con approvazione admin.

alter table public.users add column if not exists "firstName" text;
alter table public.users add column if not exists "scintille" integer not null default 0;
alter table public.users add column if not exists "piume" integer not null default 0;
alter table public.users add column if not exists "profileImageUrl" text;

create table if not exists public."currencyLedger" (
    "id" text primary key,
    "userId" text not null references public.users("id") on delete cascade,
    "currency" text not null check ("currency" in ('S', 'P')),
    "amount" integer not null,
    "reason" text not null,
    "idemKey" text not null unique,
    "leadId" text references public.leads("id") on delete set null,
    "metadata" jsonb,
    "createdAt" timestamptz not null default now(),
    "companyId" text not null default 'fenice' references public.companies("id") on update cascade
);
create index if not exists currency_ledger_user_created_idx on public."currencyLedger" ("userId", "createdAt" desc);

create table if not exists public."teamChests" (
    "id" text primary key,
    "companyId" text not null default 'fenice' references public.companies("id") on update cascade,
    "day" date not null,
    "kind" text not null,          -- 'giorno_1' | 'giorno_2' | 'punta_1' | 'punta_2'
    "tier" text not null check ("tier" in ('raro', 'leggendario')),
    "reached" integer not null,
    "createdAt" timestamptz not null default now(),
    unique ("companyId", "day", "kind")
);

create table if not exists public."teamChestAwards" (
    "id" text primary key,
    "chestId" text not null references public."teamChests"("id") on delete cascade,
    "userId" text not null references public.users("id") on delete cascade,
    "currency" text not null check ("currency" in ('S', 'P')),
    "amount" integer not null,
    "openedAt" timestamptz,
    "createdAt" timestamptz not null default now(),
    unique ("chestId", "userId")
);

create table if not exists public."rewardItems" (
    "id" text primary key,
    "companyId" text not null default 'fenice' references public.companies("id") on update cascade,
    "name" text not null,
    "description" text,
    "kind" text not null,          -- 'concreto' | 'immagine' | 'personalizzazione' | 'corso'
    "currency" text not null check ("currency" in ('S', 'P')),
    "price" integer not null check ("price" > 0),
    "imageUrl" text,
    "roles" text[] not null default array['GDO', 'CONFERME'],
    "giftable" boolean not null default false,
    "isActive" boolean not null default true,
    "sortOrder" integer not null default 0,
    "createdAt" timestamptz not null default now()
);

create table if not exists public."rewardPurchases" (
    "id" text primary key,
    "userId" text not null references public.users("id") on delete cascade,
    "itemId" text not null references public."rewardItems"("id"),
    "currency" text not null check ("currency" in ('S', 'P')),
    "price" integer not null,
    "status" text not null default 'richiesto',   -- 'richiesto' | 'consegnato' | 'annullato'
    "giftTo" text,
    "createdAt" timestamptz not null default now(),
    "handledAt" timestamptz,
    "handledBy" text
);
create index if not exists reward_purchases_user_idx on public."rewardPurchases" ("userId", "createdAt" desc);

create table if not exists public."dailyQuotes" (
    "id" text primary key,
    "kind" text not null check ("kind" in ('citazione', 'vendita')),
    "text" text not null,
    "author" text not null,
    "work" text,
    "reference" text,
    "translationUrl" text,
    "translator" text,
    "theme" text,
    "occasions" text[] not null default '{}',
    "roles" text[] not null default array['GDO', 'CONFERME', 'VENDITORE', 'ADMIN', 'MANAGER'],
    "suggestedReflection" text,    -- bozza da approvare (mai mostrata così com'è)
    "reflectionSource" text,       -- url di provenienza della bozza
    "verified" boolean not null default false,
    "isActive" boolean not null default true,
    "createdAt" timestamptz not null default now()
);

create table if not exists public."dailyQuoteSchedule" (
    "day" date not null,
    "kind" text not null check ("kind" in ('citazione', 'vendita')),
    "quoteId" text not null references public."dailyQuotes"("id"),
    "reflection" text,             -- testo approvato/scritto dall'admin
    "approved" boolean not null default false,
    "approvedBy" text,
    "approvedAt" timestamptz,
    primary key ("day", "kind")
);

-- Le tabelle nuove non devono essere raggiungibili con la chiave pubblica:
-- il CRM le legge e scrive solo lato server (Drizzle, ruolo owner, bypassa RLS).
alter table public."currencyLedger" enable row level security;
alter table public."teamChests" enable row level security;
alter table public."teamChestAwards" enable row level security;
alter table public."rewardItems" enable row level security;
alter table public."rewardPurchases" enable row level security;
alter table public."dailyQuotes" enable row level security;
alter table public."dailyQuoteSchedule" enable row level security;
