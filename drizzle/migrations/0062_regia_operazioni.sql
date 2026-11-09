-- 0062: storico delle operazioni della Regia dei lead (/admin/diretta/regia-lead,
-- PO 09/11/2026). Una riga per operazione con prima e dopo dei campi toccati
-- (lead e GDO), per annullarla dalla pagina. Solo aggiunta: nessun dato cambia.

create table if not exists public."regiaOperazioni" (
    "id" text primary key,
    "companyId" text not null,
    "adminId" text not null,
    "tipo" text not null,
    "descrizione" text not null,
    "quanti" integer not null,
    "dettaglio" jsonb not null,
    "createdAt" timestamptz not null default now(),
    "annullataAt" timestamptz,
    "annullataDa" text,
    "esitoAnnulla" jsonb
);
create index if not exists regia_operazioni_company_created_idx on public."regiaOperazioni" ("companyId", "createdAt");
alter table public."regiaOperazioni" enable row level security;
