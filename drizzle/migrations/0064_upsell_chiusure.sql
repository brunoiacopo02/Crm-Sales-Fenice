-- 0064: contrassegno "upsell" sulla scheda (titolare 21/11/2026). Solo aggiunta.
--
-- Un già cliente che a un mese di distanza compra ancora (upsell) viene registrato
-- con una scheda nuova "FUORI FUNNEL" Chiuso (famiglia lead-assente della
-- riconciliazione). Quegli euro entrano nel FATTURATO del mese del venditore, ma la
-- scheda NON è una chiusura in più: con "closeIsUpsell" = true la riga resta nelle
-- somme di closeAmountEur ed esce da ogni conteggio di chiusure (numero chiusure,
-- closing rate, classifiche, bonus/premi a numero). Regole in src/lib/kpi/chiusure.ts
-- e src/lib/kpi/chiusureSql.ts.
--
-- Default false e NOT NULL: nessuna riga esistente cambia comportamento.
-- Il trigger della 0019 manda già il ping Broadcast 'leads' a ogni UPDATE: nessun
-- canale nuovo. ATTENZIONE: va applicata PRIMA del deploy del codice che la legge.

alter table public.leads add column if not exists "closeIsUpsell" boolean not null default false;
