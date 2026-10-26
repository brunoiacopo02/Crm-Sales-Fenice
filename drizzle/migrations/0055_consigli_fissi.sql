-- 0055: consigli fissi (PO 26/10/2026). Solo aggiunte.
--
-- Un consiglio "fisso" resta in vista a chi lo riceve, in una striscia sottile
-- sotto la barra in alto, finché l'admin non lo toglie (removedAt). Non passa
-- dal riquadro "Letto" dei consigli normali. Al togliere parte un ping a chi
-- lo riceve, così la striscia sparisce subito.

alter table public."callTips" add column if not exists "pinned" boolean not null default false;
alter table public."callTips" add column if not exists "removedAt" timestamptz;
create index if not exists call_tips_pinned_idx on public."callTips" ("receiverId") where "pinned" and "removedAt" is null;

create or replace function public.tg_call_tips_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.crm_broadcast(jsonb_build_object('op','INSERT'), 'callTips', 'user:' || new."receiverId");
  else
    if new."readAt" is distinct from old."readAt" then
      perform public.crm_broadcast(jsonb_build_object('op','UPDATE'), 'callTips', 'user:' || new."senderId");
    end if;
    if new."removedAt" is distinct from old."removedAt" then
      perform public.crm_broadcast(jsonb_build_object('op','UPDATE'), 'callTips', 'user:' || new."receiverId");
    end if;
  end if;
  return null;
end $$;
