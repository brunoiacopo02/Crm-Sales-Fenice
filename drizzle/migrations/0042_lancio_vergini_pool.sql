-- 0042: pool "Lead del lancio mai contattati dal bot" (PO 07/10/2026).
--
-- I lead del lancio Web Dev a cui il bot non aveva ancora mandato il
-- follow-up vengono tolti al bot e messi in un pool a parte su /import: il TL
-- li assegna ai GDO oppure ne restituisce N al bot. Finché sono nel pool
-- (assignedToId null) hanno lancioPool = 'VERGINI'; all'assegnazione il segno
-- si azzera e il lead torna un lead del lancio come gli altri. Null sui lead
-- normali e su quelli ridati dal bot (che restano nel pool del lancio di sempre).

alter table public.leads add column if not exists "lancioPool" text;
create index if not exists "leads_lancio_pool_idx"
  on public.leads ("lancioPool") where "lancioPool" is not null;
