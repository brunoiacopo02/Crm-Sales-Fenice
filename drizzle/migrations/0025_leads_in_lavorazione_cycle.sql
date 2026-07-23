-- Follow-up venditori (spec 2026-07-23-followup-venditori-storico-lavorazione).
-- inLavorazioneAt: se valorizzato il lead è parcheggiato "In lavorazione"
--   (senza data follow-up precisa) ed esce dai bucket Scaduti/Oggi/Prossimi.
-- salesCycleStartAt: valorizzato alla riapertura dallo Storico; il tetto dei
--   3 follow-up conta solo i salesAttempts con outcomeAt >= questa data.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "inLavorazioneAt" timestamptz;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "salesCycleStartAt" timestamptz;
