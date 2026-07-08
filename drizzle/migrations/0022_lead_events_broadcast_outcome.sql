-- 0022: il payload broadcast di leadEvents include l'esito (metadata->>'outcome').
-- Bug: 'conferme_outcome_set' viene emesso sia per 'confermato' che per 'scartato',
-- ma FomoToast mostrava sempre "ha confermato un appuntamento!" — anche sugli scarti.
-- Il client ora filtra sull'outcome; senza questo campo il toast non viene mostrato.
-- APPLICATA IN PROD il 2026-07-08 via MCP (apply_migration lead_events_broadcast_outcome).
create or replace function public.tg_lead_events_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crm_broadcast(
    jsonb_build_object('userId', new."userId", 'eventType', new."eventType",
                       'outcome', new.metadata->>'outcome'),
    'leadEvents', 'crm:' || new."companyId");
  return null;
end $$;
