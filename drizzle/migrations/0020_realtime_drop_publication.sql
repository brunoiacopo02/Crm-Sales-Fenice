-- 0020: Realtime postgres_changes → Broadcast, fase 2 (spegnimento WAL polling).
-- DA APPLICARE SOLO DOPO il deploy del client migrato al bus Broadcast (0019):
-- le tab col vecchio codice usano ancora postgres_changes e perderebbero i
-- live update. Rimuovere le tabelle dalla publication ferma realtime.list_changes.
do $$
declare t text;
begin
  for t in select unnest(array['leads','leadEvents','notifications','internalAlerts',
                               'duels','userAchievements','bossBattles','seasonalEvents']) loop
    begin
      execute format('alter publication supabase_realtime drop table public.%I', t);
    exception when others then null; -- tabella non nella publication: ok
    end;
  end loop;
end $$;
