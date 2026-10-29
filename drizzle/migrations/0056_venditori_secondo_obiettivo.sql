-- 0056: secondo obiettivo di fatturato dei venditori (PO 29/10/2026). Solo aggiunte.
--
-- users.salesTargetEur resta il PRIMO obiettivo (74.000 €), la colonna nuova
-- e' il SECONDO (86.500 €). Valgono per ogni mese finche' non si cambiano:
-- non sono per mese. Valori vecchi in
-- scripts/diretta/ripristino/venditori-nomi-obiettivi-prima-29-10.json.

alter table public.users add column if not exists "salesTarget2Eur" real;
