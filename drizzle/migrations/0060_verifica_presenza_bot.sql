-- 0060: "App da verificare" (PO 07/11/2026).
-- Gli appuntamenti confermati dalle Conferme il giorno prima ricevono dal bot, un'ora
-- prima della call, un messaggio che chiede di confermare la presenza
-- (POST /api/bot/verifica-presenza, contratto v1.13). Qui lo stato, su leads come
-- l'avviso bloccante della 0032: il trigger della 0019 manda già il ping Broadcast
-- 'leads' a ogni UPDATE, nessun canale nuovo. Solo aggiunte.
--
-- "botVerificaApptAt": la data della call a cui si riferisce la verifica (se la call si
--   sposta, la verifica vecchia non vale più).
-- "botVerificaSentAt": quando il bot ha mandato il messaggio. Da qui partono i 30 minuti.
-- "botVerificaEsito": 'in_attesa' | 'confermato' | 'non_conferma' | 'risposta'.
-- "botVerificaGestitaAt": le Conferme l'hanno presa in mano (aperta, confermata a voce):
--   l'avviso bloccante si spegne per tutti.
-- "botVerificaSparitoAt"/"ById": premuto "Sparito"; il venditore è stato avvisato.

alter table public.leads add column if not exists "botVerificaApptAt" timestamptz;
alter table public.leads add column if not exists "botVerificaSentAt" timestamptz;
alter table public.leads add column if not exists "botVerificaEsito" text;
alter table public.leads add column if not exists "botVerificaEsitoAt" timestamptz;
alter table public.leads add column if not exists "botVerificaRisposta" text;
alter table public.leads add column if not exists "botVerificaGestitaAt" timestamptz;
alter table public.leads add column if not exists "botVerificaSparitoAt" timestamptz;
alter table public.leads add column if not exists "botVerificaSparitoById" text;

-- La sezione e l'avviso leggono solo le verifiche delle call di oggi.
create index if not exists leads_bot_verifica_idx on public.leads ("companyId", "botVerificaApptAt")
    where "botVerificaApptAt" is not null;
