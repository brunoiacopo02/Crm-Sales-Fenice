-- 0058: via le colonne fisse degli obiettivi venditori su users (PO 29/10/2026).
-- Ora vivono per mese in salesMonthlyTargets (0057). Applicata DOPO il deploy
-- del codice che non le legge piu'. Valori prima del drop in
-- scripts/diretta/ripristino/venditori-obiettivi-su-users-prima-0057-29-10.json.

alter table public.users drop column if exists "salesTarget2Eur";
alter table public.users drop column if exists "salesTargetEur";
