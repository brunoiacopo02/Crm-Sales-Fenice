-- 0032: stato dell'avviso bloccante per i richiami Conferme.
-- Spec: docs/superpowers/specs/2026-08-31-avviso-bloccante-richiami-conferme-design.md
--
-- Lo stato vive sulle colonne di `leads` (non su una tabella nuova) perché il
-- trigger della 0019 già manda un ping Broadcast 'leads' sul topic
-- crm:<companyId> a ogni UPDATE: il claim si propaga a tutti gli schermi senza
-- un canale, un evento o un trigger in più — e la regola "mai un secondo
-- channel sullo stesso topic" resta rispettata per costruzione.
--
-- Tutte nullable, tutte additive: nessun backfill, nessun default da riscrivere
-- su 300k righe.

alter table public.leads
  add column if not exists "confAlertSnoozedUntil" timestamptz,
  add column if not exists "confAlertClaimedById"  text,
  add column if not exists "confAlertClaimedAt"    timestamptz,
  add column if not exists "confAlertHandledAt"    timestamptz;

comment on column public.leads."confAlertSnoozedUntil" is
  'Avviso bloccante Conferme: silenzio globale (snooze 2 min) fino a questo istante.';
comment on column public.leads."confAlertClaimedById" is
  'Avviso bloccante Conferme: users.id di chi ha premuto "Lo chiamo io".';
comment on column public.leads."confAlertClaimedAt" is
  'Avviso bloccante Conferme: istante del claim; scade dopo 10 minuti.';
comment on column public.leads."confAlertHandledAt" is
  'Avviso bloccante Conferme: qualcuno ha aperto la scheda, avviso spento per tutti.';

-- L'indice parziale leads_conf_snooze_idx (companyId, confSnoozeAt) copre già la
-- query dell'avviso: nessun indice nuovo, per non aggiungere write amplification
-- su una tabella hot (vedi incidente Disk IO del 2026-06-27).
