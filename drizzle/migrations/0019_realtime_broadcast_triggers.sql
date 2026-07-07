-- 0019: Realtime postgres_changes → Broadcast, fase 1 (additiva).
-- Contesto: incidente 2026-07-07 — realtime.list_changes (WAL polling dei canali
-- postgres_changes) era il primo consumatore del DB (19,6M chiamate). I client
-- migrano a canali Broadcast privati alimentati da questi trigger.
-- Topic: crm:<companyId> (eventi di squadra, payload senza dati lead sensibili)
--        user:<userId>   (notifiche personali, payload riga completa)
-- La publication supabase_realtime viene svuotata SOLO in 0020, dopo il deploy
-- del nuovo client (le tab col vecchio codice usano ancora postgres_changes).

-- ==== RLS su realtime.messages (autorizzazione at-join dei canali privati) ====
drop policy if exists "user topic own read" on realtime.messages;
create policy "user topic own read" on realtime.messages
  for select to authenticated
  using ( realtime.topic() = 'user:' || (select auth.uid())::text );

drop policy if exists "crm topic allowed companies read" on realtime.messages;
create policy "crm topic allowed companies read" on realtime.messages
  for select to authenticated
  using (
    split_part(realtime.topic(), ':', 2) in (
      select unnest(coalesce(u.allowed_companies, array[u."companyId"]))
      from public.users u
      where u.id = (select auth.uid())::text
    )
  );

-- ==== helper: send exception-safe (non deve mai rompere la scrittura) ====
create or replace function public.crm_broadcast(p_payload jsonb, p_event text, p_topic text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
exception when others then
  raise warning 'crm_broadcast fallito su %: %', p_topic, sqlerrm;
end $$;

-- ==== leads: statement-level con transition tables (1 ping per statement,
--      i bulk import da migliaia di righe generano UN solo ping per company) ====
create or replace function public.tg_leads_broadcast_ins() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  for c in select distinct "companyId" from new_rows loop
    perform public.crm_broadcast(jsonb_build_object('op','INSERT'), 'leads', 'crm:' || c);
  end loop;
  return null;
end $$;
create or replace function public.tg_leads_broadcast_upd() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  for c in select distinct "companyId" from new_rows loop
    perform public.crm_broadcast(jsonb_build_object('op','UPDATE'), 'leads', 'crm:' || c);
  end loop;
  return null;
end $$;
create or replace function public.tg_leads_broadcast_del() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  for c in select distinct "companyId" from old_rows loop
    perform public.crm_broadcast(jsonb_build_object('op','DELETE'), 'leads', 'crm:' || c);
  end loop;
  return null;
end $$;

drop trigger if exists leads_broadcast_ins on public.leads;
create trigger leads_broadcast_ins after insert on public.leads
  referencing new table as new_rows for each statement execute function public.tg_leads_broadcast_ins();
drop trigger if exists leads_broadcast_upd on public.leads;
create trigger leads_broadcast_upd after update on public.leads
  referencing new table as new_rows for each statement execute function public.tg_leads_broadcast_upd();
drop trigger if exists leads_broadcast_del on public.leads;
create trigger leads_broadcast_del after delete on public.leads
  referencing old table as old_rows for each statement execute function public.tg_leads_broadcast_del();

-- ==== leadEvents: solo gli eventType consumati da FomoToast (FOMO_EVENT_MAP) ====
create or replace function public.tg_lead_events_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('userId', new."userId", 'eventType', new."eventType"),
    'leadEvents', 'crm:' || new."companyId");
  return null;
end $$;
drop trigger if exists lead_events_broadcast on public."leadEvents";
create trigger lead_events_broadcast after insert on public."leadEvents"
  for each row
  when (new."eventType" in ('appointment_set','conferme_outcome_set','confirmed','conferme_recall_scheduled',
                            'APPOINTMENT_SET','CONFERME_OUTCOME_SET','CONFIRMED','CONFERME_RECALL_SCHEDULED'))
  execute function public.tg_lead_events_broadcast();

-- ==== notifications: payload riga completa sul topic personale del destinatario ====
create or replace function public.tg_notifications_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('op', tg_op, 'row', to_jsonb(new)),
    'notifications', 'user:' || new."recipientUserId");
  return null;
end $$;
drop trigger if exists notifications_broadcast on public.notifications;
create trigger notifications_broadcast after insert or update on public.notifications
  for each row execute function public.tg_notifications_broadcast();

-- ==== internalAlerts: personale se receiverId, company-wide se broadcast (NULL) ====
create or replace function public.tg_internal_alerts_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new."receiverId" is not null then
    perform public.crm_broadcast(jsonb_build_object('op','INSERT'), 'internalAlerts', 'user:' || new."receiverId");
  else
    perform public.crm_broadcast(jsonb_build_object('op','INSERT'), 'internalAlerts', 'crm:' || new."companyId");
  end if;
  return null;
end $$;
drop trigger if exists internal_alerts_broadcast on public."internalAlerts";
create trigger internal_alerts_broadcast after insert on public."internalAlerts"
  for each row execute function public.tg_internal_alerts_broadcast();

-- ==== duels: ping company (i widget rifetchano) ====
create or replace function public.tg_duels_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_broadcast(jsonb_build_object('op', tg_op), 'duels',
    'crm:' || coalesce(new."companyId", old."companyId"));
  return null;
end $$;
drop trigger if exists duels_broadcast on public.duels;
create trigger duels_broadcast after insert or update or delete on public.duels
  for each row execute function public.tg_duels_broadcast();

-- ==== userAchievements: payload minimo per il toast social ====
create or replace function public.tg_user_achievements_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('userId', new."userId", 'achievementId', new."achievementId", 'tier', new.tier),
    'userAchievements', 'crm:' || new."companyId");
  return null;
end $$;
drop trigger if exists user_achievements_broadcast on public."userAchievements";
create trigger user_achievements_broadcast after insert on public."userAchievements"
  for each row execute function public.tg_user_achievements_broadcast();

-- ==== bossBattles: i toast usano solo id/status/title ====
create or replace function public.tg_boss_battles_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('id', new.id, 'status', new.status, 'title', new.title),
    'bossBattles', 'crm:' || new."companyId");
  return null;
end $$;
drop trigger if exists boss_battles_broadcast on public."bossBattles";
create trigger boss_battles_broadcast after update on public."bossBattles"
  for each row execute function public.tg_boss_battles_broadcast();

-- ==== seasonalEvents: campi usati dal toast evento stagionale ====
create or replace function public.tg_seasonal_events_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('title', new.title, 'description', new.description,
                       'xpMultiplier', new."xpMultiplier", 'coinsMultiplier', new."coinsMultiplier"),
    'seasonalEvents', 'crm:' || new."companyId");
  return null;
end $$;
drop trigger if exists seasonal_events_broadcast on public."seasonalEvents";
create trigger seasonal_events_broadcast after insert on public."seasonalEvents"
  for each row execute function public.tg_seasonal_events_broadcast();
