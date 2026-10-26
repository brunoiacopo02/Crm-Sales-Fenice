-- 0054: consigli in chiamata dall'admin (PO 26/10/2026). Solo aggiunte.
--
-- L'admin ascolta in cuffia un GDO (o una persona delle Conferme) e gli scrive
-- un consiglio: chi lo riceve vede un riquadro che non blocca niente, solo
-- quando c'è qualcosa da leggere, e lo chiude con "Letto". L'admin vede
-- l'ora di lettura. Il CRM legge e scrive solo lato server (Drizzle).
--
-- Realtime (come 0019): all'inserimento un ping sul topic personale di chi
-- riceve, alla lettura un ping sul topic di chi ha scritto. Evento 'callTips'.

create table if not exists public."callTips" (
    "id" text primary key,
    "companyId" text not null default 'fenice' references public.companies("id") on update cascade,
    "senderId" text not null references public.users("id") on delete cascade,
    "receiverId" text not null references public.users("id") on delete cascade,
    "message" text not null check (char_length("message") between 1 and 500),
    "createdAt" timestamptz not null default now(),
    "readAt" timestamptz
);

create index if not exists call_tips_receiver_idx on public."callTips" ("receiverId", "createdAt");

alter table public."callTips" enable row level security;

create or replace function public.tg_call_tips_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.crm_broadcast(jsonb_build_object('op','INSERT'), 'callTips', 'user:' || new."receiverId");
  elsif new."readAt" is distinct from old."readAt" then
    perform public.crm_broadcast(jsonb_build_object('op','UPDATE'), 'callTips', 'user:' || new."senderId");
  end if;
  return null;
end $$;
drop trigger if exists call_tips_broadcast on public."callTips";
create trigger call_tips_broadcast after insert or update on public."callTips"
  for each row execute function public.tg_call_tips_broadcast();
