-- Invio agenda via bot (spec 2026-07-29-agenda-via-bot-design).
-- agendaStatus: esito dell'ultimo invio agenda restituito dall'endpoint del
--   fornitore. Valori: 'consegnato' | 'inviato' | 'fallito'.
--   Serve alla UI del pulsante Agenda: su 'inviato' (accettato da Twilio ma
--   senza conferma di consegna, tipicamente telefono spento) il reinvio va
--   BLOCCATO, perché arriverebbe doppio quando il telefono torna online.
--   Serve anche a /api/bot/outcome: la NOTA su un lead di un GDO umano è
--   ammessa solo se per quel lead è passata un'agenda dal bot.
-- NULL = nessun invio tramite bot (lead storici via ActiveCampaign/Spoki).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "agendaStatus" text;
