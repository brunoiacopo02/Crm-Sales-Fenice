-- 0059: scorta personale delle prime chiamate dei GDO (PO 29/10/2026).
-- Solo aggiunte: due colonne su leads, una su users, una tabella di movimenti
-- e un trigger che rimette "da classificare" un lead quando cambia mano o
-- riceve una telefonata. Nessun dato esistente cambia.
--
-- leads."scortaStato": null = da classificare (si vede come oggi),
--   'visibile' = in prima chiamata, 'scorta' = nascosto nella scorta del GDO.
-- leads."scortaDal": quando è entrato nella scorta (ordine: chi entra dopo va in fondo).
-- users."scortaAttiva": la scorta vale solo per i GDO che la hanno accesa.

alter table public.leads add column if not exists "scortaStato" text;
alter table public.leads add column if not exists "scortaDal" timestamptz;
alter table public.users add column if not exists "scortaAttiva" boolean not null default false;

create index if not exists leads_scorta_idx on public.leads ("assignedToId") where "scortaStato" = 'scorta';

create table if not exists public."gdoScortaMovimenti" (
    "id" text primary key,
    "companyId" text not null,
    "userId" text not null references public.users(id) on delete cascade,
    -- 'iniziale' | 'nascosti' | 'sblocco' | 'consumato'
    "tipo" text not null,
    "quanti" integer not null,
    "leadIds" jsonb,
    "createdAt" timestamptz not null default now()
);
create index if not exists gdo_scorta_mov_idx on public."gdoScortaMovimenti" ("companyId", "userId", "createdAt");
alter table public."gdoScortaMovimenti" enable row level security;

-- Un lead che cambia GDO o riceve una telefonata torna "da classificare":
-- la scorta di un GDO non segue il lead da un altro, e un lead ridato dal bot
-- riparte come arrivo nuovo. Se lo stesso UPDATE scrive anche scortaStato,
-- vince quello che scrive (gli script che assegnano e nascondono insieme).
create or replace function public.tg_leads_scorta_reset()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if (new."assignedToId" is distinct from old."assignedToId" or new."callCount" is distinct from old."callCount")
     and new."scortaStato" is not distinct from old."scortaStato"
     and new."scortaDal" is not distinct from old."scortaDal" then
    new."scortaStato" := null;
    new."scortaDal" := null;
  end if;
  return new;
end
$function$;

drop trigger if exists leads_scorta_reset on public.leads;
create trigger leads_scorta_reset
before update of "assignedToId", "callCount" on public.leads
for each row execute function public.tg_leads_scorta_reset();
