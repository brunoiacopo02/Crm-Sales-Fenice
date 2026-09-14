-- 0036: lancio "Web Developer AI" (webinar 5/10/2026), spec 2026-09-14 §3.1.
--
-- L'appartenenza al lancio NON ha una colonna sua: basta
-- launchBucket = 'LANCIO_WEBDEV_2026' + funnel = 'Lancio Web Dev AI'.
-- Le colonne qui sotto raccontano COME e' entrato e COSA ha scelto la sera
-- della live. Tutte nullable: sui lead normali restano NULL e non costano.
-- La tabella launchShifts (turni venditori) e' del blocco B3, non di questa
-- migrazione.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioIngresso" text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioScelta" text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioSceltaAt" timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioCallNowAttempts" integer NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioCallNowNextAt" timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS "lancioBotInfo" jsonb;

COMMENT ON COLUMN public.leads."lancioIngresso" IS
  'Come e'' entrato nel lancio: lista (AC 132) | pulsante_webinar (wa.me la sera della live).';
COMMENT ON COLUMN public.leads."lancioScelta" IS
  'Scelta dopo il pitch: chiamata_subito | app_mattina | app_pomeriggio | app_dopodomani | followup.';
COMMENT ON COLUMN public.leads."lancioCallNowAttempts" IS
  'Tentativi del venditore sulla chiamata subito (NR = +1, al 3o passa alle Conferme).';
COMMENT ON COLUMN public.leads."lancioBotInfo" IS
  'Risposte alle due domande di riscaldamento del bot, mostrate al venditore.';

-- La card su /import acquisisce "Rimuovi pool" come Black Summer (0023).
INSERT INTO public."launchPools" ("id", "companyId", "bucket", "kind", "label", "monthKey")
VALUES (gen_random_uuid()::text, 'fenice', 'LANCIO_WEBDEV_2026', 'LAUNCH', 'Lancio Web Dev AI 2026', NULL)
ON CONFLICT DO NOTHING;
