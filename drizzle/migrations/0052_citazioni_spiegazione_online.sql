-- 0052: spiegazione della citazione online o no (PO 25/10/2026). Solo aggiunte.
--
-- L'admin approva il giorno e sceglie se la spiegazione (riflessione o
-- consiglio) va in "Approfondisci" o resta solo come testo salvato: spenta,
-- si vede la sola frase con l'autore. Di default resta online, come prima.
-- Le frasi scritte dall'admin entrano in dailyQuotes con reflectionSource
-- 'admin': nessuna colonna nuova per loro.

alter table public."dailyQuoteSchedule"
    add column if not exists "showReflection" boolean not null default true;
