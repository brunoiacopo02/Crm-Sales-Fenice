-- 0043: coda lead del giorno spinta dal CRM marketing (POST /api/marketing-leads).
--
-- Ogni mattina (~06:30) il marketing manda fino a ~150 contatti da chiamare con
-- punteggio e motivo. Il lead resta uno solo in `leads` (riusato se esiste già
-- per email/telefono); la coda di ogni giorno vive in "marketingQueueEntries",
-- una riga per (azienda, giorno, contatto marketing). Il vincolo UNIQUE rende il
-- re-invio della stessa coda idempotente.
--
-- "marketingContactId" sul lead = id stabile del contatto lato marketing:
-- viaggia negli eventi che già mandiamo al marketing (blocco lead).

alter table public.leads add column if not exists "marketingContactId" text;
create index if not exists "leads_company_marketing_contact_idx"
  on public.leads ("companyId", "marketingContactId") where "marketingContactId" is not null;

create table if not exists public."marketingQueueEntries" (
  "id" text primary key,
  "companyId" text not null default 'fenice' references public.companies(id) on update cascade,
  "queueDate" date not null,
  "marketingContactId" text not null,
  "leadId" text references public.leads(id) on delete set null,
  "posizione" integer not null,
  "motivoChiamata" text,
  "punteggio" real,
  "funnelOrigine" text,
  "dataIngresso" date,
  -- 'creato' | 'aggiornato' | 'scartato'
  "esito" text not null,
  "motivoScarto" text,
  "payload" jsonb not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create unique index if not exists "marketing_queue_company_date_contact_uq"
  on public."marketingQueueEntries" ("companyId", "queueDate", "marketingContactId");
create index if not exists "marketing_queue_lead_idx"
  on public."marketingQueueEntries" ("leadId");

-- Tabella letta/scritta solo dal server (Drizzle, ruolo postgres): niente accesso via API pubblica.
alter table public."marketingQueueEntries" enable row level security;
