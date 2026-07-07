# Realtime Broadcast Migration + Radar Conferme Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminare il carico WAL-polling di Supabase Realtime (19,6M chiamate `realtime.list_changes`, primo consumatore del DB — incidente outage 2026-07-07) migrando tutte le 13 sottoscrizioni `postgres_changes` a **Broadcast** (trigger DB → `realtime.send`), mantenendo identica l'esperienza utente, e rendendo il Radar Conferme (presence) più robusto.

**Architettura:**
- **Trigger Postgres** (`AFTER` trigger, exception-safe) inviano messaggi broadcast su due famiglie di topic **privati**: `crm:<companyId>` (ping/eventi di squadra) e `user:<userId>` (notifiche personali con payload riga).
- **Client**: nuovo singleton `src/lib/realtimeBus.ts` gestisce 1 canale `user:` + N canali `crm:` (per `allowedCompanies`), con debounce sui ping `leads`, watchdog di resubscribe e API `onBusEvent(event, cb)`. Tutti i componenti migrano da `postgres_changes` a `onBusEvent` mantenendo gli stessi handler/CustomEvent.
- **Presence Conferme**: il canale `conferme_realtime_board` resta SOLO presence (regola singleton invariata); i cambi lead arrivano dal bus. Aggiunti watchdog resubscribe + listener `online`.
- I canali broadcast **già esistenti** (`public:leads-changes` per `fomo_hotstreak`, `team-adventure` per `team_boss_damage`, inviato anche da `teamAdventureActions.ts:356`) restano invariati: sono già broadcast, costo DB zero.

**Tech stack:** Next.js 16 App Router, @supabase/supabase-js 2.98 (private channels + setAuth automatico su auth state change), Drizzle (schema parity, migrazioni a mano — drizzle-kit generate INUTILIZZABILE), Supabase `realtime.send`/RLS su `realtime.messages`.

## Global Constraints

- `CLAUDE.md §4`: i channel socket live GDO→Conferme sono critici — la semantica visibile (board che si aggiorna, campanella, radar) deve restare identica.
- Regola singleton: MAI un secondo canale sul topic `conferme_realtime_board` (QA 2026-06-12).
- Multi-tenant: topic scoped per company; `users.allowed_companies` (text[], NULL ⇒ `[companyId]`) governa a quali topic `crm:` un utente può iscriversi (RLS at-join).
- I payload su topic `crm:` non devono contenere dati lead sensibili (telefono, nome lead): solo ping `{table, op}` o campi gamification (`userId`, `eventType`, righe `userAchievements`/`bossBattles`/`seasonalEvents`/`duels` senza dati lead).
- Nessun framework di test nel repo: verifica = `npx tsc --noEmit` + `npm run build` + QA Playwright multi-ruolo su dev server + smoke prod post-deploy.
- Bulk import CSV (migliaia di righe): trigger su `leads` a livello **STATEMENT** con transition tables (1 ping per statement, non per riga); trigger su `leadEvents` filtrato ai soli eventType usati da FomoToast.
- Trigger exception-safe: un errore in `realtime.send` non deve MAI far fallire la scrittura applicativa (`BEGIN…EXCEPTION WHEN OTHERS THEN NULL`).

---

### Task 1: Migrazione DB 0019 — trigger broadcast + RLS realtime.messages + spegnimento WAL polling

**Files:**
- Create: `drizzle/migrations/0019_realtime_broadcast_triggers.sql`
- Apply in prod via `mcp__supabase__apply_migration` (project `ncutwzsifzundikwllxp`)

**Interfaces (Produces):**
- Topic `user:<userId>`, event `notifications`, payload `{op: 'INSERT'|'UPDATE', row: <notifications row JSON>}`
- Topic `user:<userId>`, event `internalAlerts`, payload `{op: 'INSERT'}` (ping)
- Topic `crm:<companyId>`, event `leads`, payload `{op}` (ping, statement-level)
- Topic `crm:<companyId>`, event `leadEvents`, payload `{userId, eventType}` (solo eventType FOMO)
- Topic `crm:<companyId>`, event `internalAlerts` (broadcast receiverId NULL), payload `{op: 'INSERT'}`
- Topic `crm:<companyId>`, eventi `duels` (ping), `userAchievements` (`{userId, achievementId, tier}`), `bossBattles` (`{id, status, title}`), `seasonalEvents` (`{title, description, xpMultiplier, coinsMultiplier}`)

- [ ] **Step 1: scrivere il file migrazione** con questo SQL:

```sql
-- 0019: Realtime postgres_changes → Broadcast (incidente 2026-07-07).
-- Trigger DB inviano su topic privati crm:<companyId> / user:<userId> via realtime.send.
-- Il WAL polling (realtime.list_changes, 19,6M chiamate) si spegne rimuovendo le
-- tabelle dalla publication supabase_realtime.

-- ==== RLS su realtime.messages (autorizzazione at-join dei canali privati) ====
create policy "user topic own read" on realtime.messages
  for select to authenticated
  using ( realtime.topic() = 'user:' || (select auth.uid())::text );

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
returns void language plpgsql security definer as $$
begin
  perform realtime.send(p_payload, p_event, p_topic, true);
exception when others then
  raise warning 'crm_broadcast fallito su %: %', p_topic, sqlerrm;
end $$;

-- ==== leads: statement-level con transition tables (1 ping per statement) ====
create or replace function public.tg_leads_broadcast_ins() returns trigger language plpgsql security definer as $$
declare c text;
begin
  for c in select distinct "companyId" from new_rows loop
    perform public.crm_broadcast(jsonb_build_object('op','INSERT'), 'leads', 'crm:' || c);
  end loop;
  return null;
end $$;
create or replace function public.tg_leads_broadcast_upd() returns trigger language plpgsql security definer as $$
declare c text;
begin
  for c in select distinct "companyId" from new_rows loop
    perform public.crm_broadcast(jsonb_build_object('op','UPDATE'), 'leads', 'crm:' || c);
  end loop;
  return null;
end $$;
create or replace function public.tg_leads_broadcast_del() returns trigger language plpgsql security definer as $$
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

-- ==== leadEvents: solo gli eventType usati da FomoToast (FOMO_EVENT_MAP) ====
create or replace function public.tg_lead_events_broadcast() returns trigger language plpgsql security definer as $$
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

-- ==== notifications: payload riga completa sul topic personale ====
create or replace function public.tg_notifications_broadcast() returns trigger language plpgsql security definer as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('op', tg_op, 'row', to_jsonb(new)),
    'notifications', 'user:' || new."recipientUserId");
  return null;
end $$;
drop trigger if exists notifications_broadcast on public.notifications;
create trigger notifications_broadcast after insert or update on public.notifications
  for each row execute function public.tg_notifications_broadcast();

-- ==== internalAlerts: personale se receiverId, company se broadcast ====
create or replace function public.tg_internal_alerts_broadcast() returns trigger language plpgsql security definer as $$
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

-- ==== duels: ping company ====
create or replace function public.tg_duels_broadcast() returns trigger language plpgsql security definer as $$
begin
  perform public.crm_broadcast(jsonb_build_object('op', tg_op), 'duels',
    'crm:' || coalesce(new."companyId", old."companyId"));
  return null;
end $$;
drop trigger if exists duels_broadcast on public.duels;
create trigger duels_broadcast after insert or update or delete on public.duels
  for each row execute function public.tg_duels_broadcast();

-- ==== userAchievements: payload minimo per il toast social ====
create or replace function public.tg_user_achievements_broadcast() returns trigger language plpgsql security definer as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('userId', new."userId", 'achievementId', new."achievementId", 'tier', new.tier),
    'userAchievements', 'crm:' || new."companyId");
  return null;
end $$;
drop trigger if exists user_achievements_broadcast on public."userAchievements";
create trigger user_achievements_broadcast after insert on public."userAchievements"
  for each row execute function public.tg_user_achievements_broadcast();

-- ==== bossBattles / seasonalEvents: payload campi usati dai toast ====
create or replace function public.tg_boss_battles_broadcast() returns trigger language plpgsql security definer as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('id', new.id, 'status', new.status, 'title', new.title),
    'bossBattles', 'crm:' || new."companyId");
  return null;
end $$;
drop trigger if exists boss_battles_broadcast on public."bossBattles";
create trigger boss_battles_broadcast after update on public."bossBattles"
  for each row execute function public.tg_boss_battles_broadcast();

create or replace function public.tg_seasonal_events_broadcast() returns trigger language plpgsql security definer as $$
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

-- ==== spegni il WAL polling: rimuovi le tabelle dalla publication realtime ====
-- (idempotente: ignora se una tabella non è nella publication)
do $$
declare t text;
begin
  for t in select unnest(array['leads','leadEvents','notifications','internalAlerts',
                               'duels','userAchievements','bossBattles','seasonalEvents']) loop
    begin
      execute format('alter publication supabase_realtime drop table public.%I', t);
    exception when others then null;
    end;
  end loop;
end $$;
```

NB campi `seasonalEvents`: verificare in `schema.ts` i nomi esatti (`xpMultiplier`/`coinsMultiplier`) prima di applicare; se diversi, adeguare il trigger.

- [ ] **Step 2: applicare** con `mcp__supabase__apply_migration` (name: `realtime_broadcast_triggers`).
- [ ] **Step 3: smoke SQL** — `UPDATE leads SET "updatedAt" = now() WHERE id = (SELECT id FROM leads LIMIT 1);` deve riuscire (trigger non rompe le scritture) e `SELECT count(*) FROM realtime.messages WHERE topic LIKE 'crm:%';` deve essere ≥ 1.
- [ ] **Step 4: commit** del solo file SQL.

### Task 2: `src/lib/realtimeBus.ts` — singleton canali privati

**Files:**
- Create: `src/lib/realtimeBus.ts`

**Interfaces (Produces):**
- `initRealtimeBus(userId: string, companies: string[]): () => void` (refcount, idempotente su stessi parametri)
- `onBusEvent(event: BusEvent, cb: (payload: any) => void): () => void` dove `BusEvent = 'leads' | 'leadEvents' | 'notifications' | 'internalAlerts' | 'duels' | 'userAchievements' | 'bossBattles' | 'seasonalEvents'`
- Comportamento: `leads` è debounced (coalescing trailing 1500ms); gli altri eventi passano il `payload` del messaggio così com'è. Watchdog: ogni 30s se un canale non è SUBSCRIBED lo ricrea; listener `online` + `visibilitychange` forzano il check.

Implementazione completa (pattern singleton identico a `confermePresence.ts`; canali `{ config: { private: true } }`; `logRealtimeStatus` per i log; mappa `channelName → RealtimeChannel`).

- [ ] Scrivere il modulo, `npx tsc --noEmit` verde, commit.

### Task 3: RealtimeProvider + layout — bus al posto dei 3 postgres_changes

**Files:**
- Modify: `src/components/providers/RealtimeProvider.tsx`
- Modify: `src/app/(dashboard)/layout.tsx:68` (passare `userId={session.user.id}` e `companies={...}`; spostare il calcolo `tctx` prima dell'uso — è già a riga 42)

**Interfaces:**
- Consumes: `initRealtimeBus`, `onBusEvent` (Task 2)
- Produces: stessi CustomEvent di oggi (`fomo_lead_event` con `{userId, eventType}`, `fomo_achievement_event` con `{userId, achievementId, tier}`, `fomo_hotstreak_event`, `team_boss_damage_event`) e stesso context `useRealtimeBroadcast().broadcastFomo` — FomoToast/MappaAvventura NON si toccano.
- I canali broadcast puri `public:leads-changes` (fomo_hotstreak send/receive) e `team-adventure` restano identici.
- `leads` dal bus → `router.refresh()` (come oggi).

- [ ] Riscrivere provider, aggiornare layout, tsc verde, commit.

### Task 4: Notifiche personali — `useRealtimeNotifications`

**Files:**
- Modify: `src/hooks/useRealtimeNotifications.ts:63-108`

**Interfaces:** Consumes `onBusEvent('notifications', cb)` con payload `{op, row}`; la logica INSERT (prepend, unreadCount+1, liveToast, CustomEvent `realtime_update` + `duel_started`) e UPDATE (map + ricalcolo unread) resta identica usando `payload.row` al posto di `payload.new`.

- [ ] Migrare, tsc verde, commit.

### Task 5: Alerts, Duelli, Social, Venditore

**Files:**
- Modify: `src/components/GlobalAlertListener.tsx:28-46` → `onBusEvent('internalAlerts', () => handleNewAlert())` (l'handler già rifetcha tutto via `getMyUnreadAlerts`, il payload non serve; arriva sia dal topic user che dal topic crm)
- Modify: `src/components/DuelWidget.tsx:55-63` → `onBusEvent('duels', fetchDuels)`
- Modify: `src/components/TeamDuelsMonitor.tsx:70-78` → `onBusEvent('duels', fetchDuels)`
- Modify: `src/components/providers/SocialNotificationProvider.tsx:60-171` → tre `onBusEvent` (`userAchievements`, `bossBattles`, `seasonalEvents`); gli handler usano il payload del trigger (stessi campi di prima)
- Modify: `src/components/VenditoreDashboardClient.tsx:127-150` → `onBusEvent('leads', fetchAppointments)` (il filtro per seller non serve: la refetch è già scoped)

- [ ] Migrare i 5 file, tsc verde, commit.

### Task 6: Radar Conferme — presence-only + hardening

**Files:**
- Modify: `src/lib/confermePresence.ts`

**Cambi:**
1. Rimuovere il blocco `ch.on("postgres_changes", …)` (righe 110-112).
2. `subscribeConfermeLeadChanges(cb)` mantiene la firma ma si aggancia a `onBusEvent('leads', …)` (import dal bus) — i componenti board/drawer/radar NON cambiano.
3. Watchdog: `setInterval` 30s — se `refCount > 0 && !subscribed` da >1 ciclo → `teardown()` soft del solo canale + `ensureChannel()` + `retrack()` (rebuild completo, contatore di tentativi nel log).
4. Listener `window 'online'` → retrack + pushDbHeartbeat + eventuale rebuild se non subscribed.
5. Heartbeat presence resta 25s, heartbeat DB resta 45s (fonte di verità backup invariata).

- [ ] Implementare, tsc verde, commit.

### Task 7: Verifica build + QA locale multi-ruolo

- [ ] `npm run build` → verde senza nuovi warning.
- [ ] Dev server porta 3001 (la 3000 è occupata — gotcha noto). QA Playwright:
  1. Login admin (`admin@fenice.com`/1234) → campanella notifiche carica; `INSERT` di una notifica di test via SQL → toast live entro pochi secondi; poi DELETE della notifica di test.
  2. Login conferme + seconda sessione conferme → Radar mostra entrambi online; `UPDATE` su un lead via SQL → board si aggiorna (ping bus).
  3. Console: zero errori `CHANNEL_ERROR`/`postgres_changes`.
- [ ] Commit finale.

### Task 8: Ship + verifica produzione

- [ ] Push su main; monitor deploy Vercel fino a READY.
- [ ] Smoke prod: login, campanella, board conferme; `get_runtime_errors` pulito; `pg_stat_statements` dopo ~15 min: `realtime.list_changes` non cresce più.
- [ ] Aggiornare memoria (`project_incident_db_outage_2026_07_07.md` + nuova memoria migrazione broadcast) e MEMORY.md.

## Self-Review

- Copertura: 13 sottoscrizioni/8 file dell'audit → Task 3 (RealtimeProvider ×3), 4 (notifications ×2), 5 (alerts ×2, duels ×2, social ×3, venditore ×1), 6 (conferme ×1) = 13. ✓
- Radar: richiesta esplicita "deve continuare a funzionare + ottimizzarlo" → Task 6 hardening. ✓
- Tipi coerenti: `onBusEvent(event, cb)` uniforme; payload notifications `{op,row}` usato in Task 4. ✓
- Niente placeholder: SQL completo in Task 1; Task 2 descrive interfaccia esatta (implementazione inline all'esecuzione con pattern confermePresence). ✓
