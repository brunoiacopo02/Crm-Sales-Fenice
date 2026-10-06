-- 0040: gruppo di prova "solo umani" (PO 06/10/2026).
--
-- 400 lead del lancio Web Dev che hanno visto la live e che il bot non aveva
-- ancora ricontattato: tolti al bot e dati 200 al GDO 106 e 200 al 119, per
-- misurare come vanno i lead del lancio lavorati solo da persone.
-- Il segno resta anche se il lead cambia stato o assegnatario: serve alla
-- sezione /lancio-umani per ritrovarli. Null sui lead normali.

alter table public.leads add column if not exists "humanTestCohort" text;
create index if not exists "leads_human_test_cohort_idx"
  on public.leads ("humanTestCohort") where "humanTestCohort" is not null;
