-- 0046: citazione del giorno e consiglio di vendita, campi in più (PO 25/10/2026).
--
-- Solo aggiunte, colonne nullable: nessun dato esistente cambia.
-- * technique: la tecnica del consiglio di vendita. Un terzo dei consigli non
--   ha la frase dell'autore: quando il consiglio è approvato, il titolo è la tecnica.
-- * usage: 'applica' | 'riconosci_e_difenditi' (tecniche da riconoscere, non da usare).
-- * originalText: il testo in lingua originale, per controllare la traduzione
--   dalla pagina /admin/citazioni.

alter table public."dailyQuotes" add column if not exists "technique" text;
alter table public."dailyQuotes" add column if not exists "usage" text;
alter table public."dailyQuotes" add column if not exists "originalText" text;
