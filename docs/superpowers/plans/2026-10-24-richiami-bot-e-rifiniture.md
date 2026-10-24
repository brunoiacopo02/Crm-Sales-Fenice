# Richiami Conferme al bot + rifiniture "mattina stessa" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** chiudere i quattro punti rimandati della feature "Conferme mattina stessa" (spec `docs/superpowers/specs/2026-10-24-conferme-mattina-stessa-design.md`) come deciso dal PO il 24/10/2026: (1) il bot sa dei richiami blu delle Conferme e manda al lead un sollecito ~2 ore prima, e sa degli spostamenti; (2) call alle 9 fissata a sera; (3) avviso GDO in ora di Roma e giorni lavorativi; (4) commenti vecchi.

**Repos (due worktree, stesso branch `feat/conferme-mattina-stessa`):**
- BOT = `C:\Users\bruno\Desktop\Software-Messaggistica-mattina` (Next 16, bun; test `bun run test`, typecheck `bun run typecheck` o `npx tsc --noEmit`)
- CRM = `C:\Users\bruno\Desktop\CRM-GDO-mattina` (Next 14, npm; test `npm test`, `npx tsc --noEmit`)

**Spec:** richiesta PO 24/10/2026 (testo in chat), riportata qui sotto in "Decisioni PO".

## Decisioni PO (vincolanti)
- "Richiamo blu" = lead parcheggiato dalle Conferme nel tab Richiami: `leads.confNeedsReschedule = true` con `leads.recallDate` impostata (può essere oggi o giorni dopo). Il bot deve saperlo e mandare al lead, **circa 2 ore prima del richiamo**, un messaggio che gli ricorda la chiamata per confermare l'appuntamento e di guardare il video.
- Il bot deve sapere anche degli spostamenti della call (oggi `gdo_agenda_at` non li segue).
- Call alle 9 fissata a tarda sera: il bot non deve dire "ti chiama il giorno prima" se quel giorno è già finito.
- Avviso GDO: giorni lavorativi (salta la domenica) e ora di Roma.
- Commenti rimasti sulla rotazione delle 20: allineati.

## Global Constraints
- Rispondere/scrivere testi al lead in italiano, niente trattino lungo (—) nei testi al lead.
- Chi chiama è sempre "Noemi, una collega" (persona delle Conferme nei testi del bot).
- Noemi attacca alle 9:00. Fascia invii al lead 08:30-20:30 Europe/Rome (`clampToSendWindow` in `lib/precall-reminders.ts`).
- Ogni nuovo invio automatico ha un interruttore env (`=== '1'` per accendere) e non parte se `ai_paused_at` è valorizzato.
- Fuori dalla finestra di 24h WhatsApp si manda solo un template approvato; senza SID configurato quel caso si salta (nessun errore).
- Niente SQL raw nel CRM: solo Drizzle (`src/db/schema.ts`).
- Ogni test nuovo del CRM va registrato nello script `test` di `package.json` (come gli altri `*.test.ts`).
- Non toccare il template approvato `fenice_reminder_24h_gdo_v1`.
- Commit piccoli, messaggio in italiano stile repo (`feat(...)`, `fix(...)`), con la riga `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus
1. Lead parcheggiato e poi rifissato o scartato prima del richiamo: il sollecito NON deve partire (vale solo `conferme_outcome = 'da_rifissare'` sulla riga sincronizzata).
2. Richiamo alle 9:00 → sollecito alle 08:30 (clamp), non alle 7:00; richiamo fra meno di 15 minuti → niente.
3. Stesso richiamo, due giri del cron → un solo messaggio (presa prima dell'invio, per `recall_at`); richiamo spostato → nuovo sollecito.
4. Lead parcheggiato con la vecchia data ancora nel bot: niente promemoria T-24h/T-3h sulla data vecchia.
5. Sabato → lunedì: avviso GDO e regola 9 tardiva contano il sabato come giorno prima del lunedì.

---

### Task 1 (BOT): call alle 9 fissata a sera + lunedì 26/10 mattina chiuso

**Files:** `lib/noemi-quando.ts`, `lib/gdo-recap.ts`, `lib/gdo-context-note.ts`, `lib/precall-reminders.ts`, `lib/mario-prompt.ts`, `lib/booking-slots.ts` (+ dove sta la validazione `fuori_fascia`, es. `lib/bot-outcome-rules.ts`), relativi `*.test.ts`.

- [ ] **Step 1: test che falliscono** in `lib/noemi-quando.test.ts` (creare se manca):
  - `pianoNoemi(call=ven 30/10 09:00, fissatoIl=gio 29/10 20:30)` → `caso: 'nove-in-punto'`.
  - `pianoNoemi(call=ven 30/10 09:00, fissatoIl=gio 29/10 18:59)` → `caso: 'giorno-prima'`.
  - `pianoNoemi(call=lun 2/11 09:00, fissatoIl=sab 31/10 19:00)` → `'nove-in-punto'`; con `fissatoIl=dom 1/11 10:00` → `'nove-in-punto'`; con `fissatoIl=ven 30/10 12:00` → `'giorno-prima'`.
  - gdo-recap: `quandoNoemi(ven 30/10 09:00, gio 29/10 21:00)` → `'venerdì 30 alle 9 in punto, appena attacca'` (formato giorno come `giornoRoma`).
  - precall: `gdoReminder24Raggiungibile` falso per la call delle 9 fissata alle 20:30 del giorno prima; `noemiRelativo` (via `gdoReminderVars`) per quel caso dà `'domani alle 9 in punto'` se mai chiamato.
  - gdo-context-note: per quel caso la riga contiene `alle 9 in punto` e non contiene `il giorno prima`.
- [ ] **Step 2: implementare.** In `noemi-quando.ts`: `NoemiCaso` aggiunge `'nove-in-punto'`; costante `NOEMI_ULTIMA_ORA_GIORNO_PRIMA = 19`; se `ora <= 9` e `fissatoIl` è nel giorno `giornoPrima` (Roma) con ora ≥ 19, oppure in un giorno successivo → `'nove-in-punto'`, altrimenti `'giorno-prima'`. Aggiornare il commento di testa. Consumatori:
  - `gdo-recap.ts` `quandoNoemi`: `` `${giorno} alle 9 in punto, appena attacca` ``.
  - `gdo-context-note.ts` `quandoChiamaNoemi`: `` ` Digli QUANDO lo chiama: la call è ${call}, e a quest'ora Noemi non fa più in tempo a sentirlo il giorno prima: lo chiama ${giorno} alle 9 in punto, appena attacca. Scrivilo col giorno e il numero, e digli di tenere il telefono a portata dalle 9.` ``
  - `precall-reminders.ts`: `primoIstanteGdoReminder24` → `null` per `'nove-in-punto'`; `noemiRelativo` → `` `${relativo(call)} alle 9 in punto` ``.
  - `mario-prompt.ts` blocco CHI È NOEMI: dopo la riga "call alle 9:00: chiama SEMPRE il giorno prima…" aggiungere: `Eccezione: se la call alle 9:00 la stai fissando dopo le 19:00 del giorno prima, Noemi non fa più in tempo a sentirlo prima: lo chiama la mattina stessa alle 9 in punto, appena attacca. Per questo dopo le 19:00 non proporre mai le 9:00 del giorno dopo: proponi dalle 10:00.` In [QUANDO] "quattro forme" → "cinque forme" e aggiungere la forma: `call ALLE 9:00 fissata dopo le 19:00 del giorno prima → "<giorno della call, col numero> alle 9 in punto, appena attacca". Es. oggi è giovedì 22 sera, call venerdì 23 alle 9: "*Ti chiama Noemi, una nostra collega, venerdì 23 alle 9 in punto, appena attacca*".` Aggiornare i test del prompt che contano le forme.
- [ ] **Step 3: lunedì 26/10 (temporaneo).** Le Conferme attaccano alle 9 solo da martedì 27/10. Costante `MATTINE_PRENOTABILI_DAL = '2026-10-27'` in `lib/booking-slots.ts` (commento: togliere dopo il 27/10): per un giorno di prenotazione < quella data la FASCIA detta al modello è `'dalle 15:00 alle 21:00'` e la validazione dell'esito rifiuta come `fuori_fascia` un orario prima delle 15:00 di quel giorno. Test: lunedì 26/10 11:00 rifiutato (now = sab 24/10 21:00), lunedì 26/10 16:00 accettato, martedì 27/10 11:00 accettato.
- [ ] **Step 4:** `bun run test` tutta la suite verde, typecheck 0 errori. Commit.

### Task 2 (BOT): il "fissato il" segue gli spostamenti

**Files:** `supabase/migrations/20261024000001_gdo_appuntamento_set_at.sql`, `lib/appointment-set.ts`, `lib/noemi-quando.ts`, `lib/precall-reminders.ts`, `app/api/cron/precall-reminders/route.ts`, `app/api/cron/gdo-video-followups/route.ts`, `lib/fenice-autoreply.ts`, `lib/gdo-recap-send.ts`, test.

- [ ] **Step 1: migrazione** `alter table conversations add column if not exists gdo_appuntamento_set_at timestamptz;` + `comment on column` ("Quando il CRM ci ha dato l'ultima data della call (primo fissaggio o spostamento): conta per quando chiama Noemi"). NON applicarla (la applica il controller in prod).
- [ ] **Step 2: test che falliscono:**
  - `runAppointmentSet` con esito `registrato` e `spostato` scrive anche `gdo_appuntamento_set_at` (istante corrente ISO); `invariato` non lo scrive. (Usa il pattern di test esistente per appointment-set se c'è, altrimenti un fake supabase minimale.)
  - `fissatoIlDi({ gdo_agenda_at, gdo_appuntamento_set_at })` in `noemi-quando.ts`: restituisce il più recente valido dei due come `Date`, `undefined` se nessuno valido.
  - `gdoReminder24Raggiungibile` / `decideGdoReminder24` accettano `fissatoIl?: string | null`: con agenda di 3 giorni fa e call di domani alle 11 spostata ieri sera → piano `'mattina-stessa'` (non `'giorno-prima-poi-mattina'`). La regola "agenda di almeno 12 ore" resta su `gdoAgendaAt`.
- [ ] **Step 3: implementare.** `runAppointmentSet` aggiorna `gdo_appuntamento_set_at` insieme a `gdo_appuntamento_at`. In tutti i punti che oggi passano `gdo_agenda_at` come `fissatoIl` (precall route `gdoReminderVars`, `decideGdoReminder24`; gdo-video-followups route righe ~178/193/299; `fenice-autoreply.ts` ~836/1001/1097; `gdo-recap-send.ts` `fissatoIlRecap` per le occasioni diverse da `'spostato'`) usare `fissatoIlDi(conv)`, aggiungendo la colonna alle select.
- [ ] **Step 4:** suite verde, typecheck 0. Commit.

### Task 3 (CRM): il feed lead-status porta il richiamo + avviso GDO

**Files:** `src/app/api/bot/lead-status/route.ts`, `src/lib/conferme/appointmentSlotWarning.ts` (nuovo) + test, `src/components/GdoQuickActions.tsx`, `package.json`, il documento del contratto bot↔CRM se elenca i campi di lead-status (`docs/bot-fissatore*`).

- [ ] **Step 1 (feed):** nella select aggiungere `recallDate: leads.recallDate` e nel payload `recallAt: iso(r.recallDate)`. Aggiungere una riga al contratto (campo nuovo, retrocompatibile).
- [ ] **Step 2: test che falliscono** per `appointmentSlotWarning(dateStr: string, now: Date): string | null`. `dateStr` è il valore di `<input type="datetime-local">` (`'2026-10-27T10:00'`) ed è già ora di Roma: si leggono anno/mese/giorno/ora dalla stringa, nessuna conversione. `now` si porta in Roma con gli helper già in `src/lib/conferme/boardWindow.ts` (`nextWorkDayRome` ecc.). Giorni ammessi: il prossimo giorno lavorativo dopo oggi e quello dopo ancora (la domenica non conta). Messaggi IDENTICI a quelli attuali in `GdoQuickActions.tsx`. Casi:
  - now = sab 24/10 15:00 Roma: lun 26/10 11:00 → null; mar 27/10 11:00 → null; mer 28/10 11:00 → "Data troppo lontana…"; sab 24/10 18:00 → "Data nel passato o per oggi…"; dom 25/10 11:00 → `"La domenica non si fissano appuntamenti: fissa per domani o dopodomani, dalle 10:00 alle 21:00."` (messaggio nuovo, solo per la domenica).
  - now = mar 27/10 23:30 Roma (UTC 22:30): mer 28/10 10:00 → null (non deve usare l'ora del browser/UTC).
  - mar 27/10 09:00 da lun → messaggio delle 9; 22:00 → "Orario fuori finestra…".
- [ ] **Step 3:** implementare, sostituire la funzione locale in `GdoQuickActions.tsx` con l'import (passando `new Date()`), registrare il test in `package.json`.
- [ ] **Step 4:** `npm test` verde, `npx tsc --noEmit` 0 errori. Commit (due commit: feed, avviso).

### Task 4 (BOT): sollecito prima del richiamo blu + niente promemoria sui parcheggiati

**Files:** `supabase/migrations/20261024000002_conf_richiamo.sql`, `lib/crm-lead-status.ts` (+ test), `app/api/cron/crm-lead-status/route.ts` se mappa a mano, `lib/conf-richiamo.ts` (nuovo) + `lib/conf-richiamo.test.ts`, `app/api/cron/precall-reminders/route.ts`, `app/api/cron/gdo-video-followups/route.ts`, `scripts/crea-template-richiamo-conferme.ts` (nuovo).

**Interfaces:** consuma `recallAt` dal feed CRM (Task 3) e `clampToSendWindow` di `lib/precall-reminders.ts` (esportarla).

- [ ] **Step 1: migrazione** (NON applicarla):
  `alter table crm_lead_status add column if not exists recall_at timestamptz;`
  `alter table conversations add column if not exists conf_richiamo_sollecito_for_at timestamptz;` + commenti.
- [ ] **Step 2: sync.** `CrmLeadStatus.recallAt?: string | null`, `CrmLeadStatusRow.recall_at: string | null`, `toRow` lo mappa con la stessa validazione delle altre date. Test in `crm-lead-status.test.ts`.
- [ ] **Step 3: test che falliscono** in `lib/conf-richiamo.test.ts` per
  `decideSollecitoRichiamo(i: { enabled: boolean; confermeOutcome: string | null; recallAt: string | null; aiPausedAt: string | null; giaInviato: boolean; lastInboundAtMs: number | null; haTemplate: boolean; nowMs: number }): 'template' | 'testo' | null`
  Regole: null se `!enabled`, `confermeOutcome !== 'da_rifissare'`, recall assente, `aiPausedAt`, `giaInviato`; istante utile = `clampToSendWindow(recall − 2h)`; null se `now < istante utile` o `now >= recall − 15 min`; poi `'testo'` se l'ultimo messaggio del lead è entro 24h, altrimenti `'template'` se `haTemplate`, altrimenti null. Casi: richiamo oggi 16:00 → alle 13:59 null, alle 14:00 testo/template, alle 15:50 null; richiamo 09:00 → alle 08:30 sì, alle 08:00 null; outcome `'confermato'` → null; inbound 3h fa → `'testo'`; inbound 30h fa e niente template → null.
  E `sollecitoRichiamoText(v: { '1': string; '2': string })` =
  `` `Ciao ${v['1']}, ${v['2']} ti richiama Noemi, una collega di Fenice Academy, da un numero di cellulare per confermare giorno e ora della tua videochiamata: rispondi, sono pochi minuti. Se non l'hai ancora fatto, guarda il video che ti ho mandato qui.` `` con `'1' = templateName(first_name)` e `'2' = slotLabel(recallMs, nowMs)` (es. `oggi alle 16:00`).
- [ ] **Step 4: ramo nel cron** `app/api/cron/precall-reminders/route.ts`: terzo ramo `promemoriaRichiamo`, interruttore `CONF_RICHIAMO_SOLLECITO_ENABLED === '1'` (l'uscita "disabled" iniziale considera anche questo), template opzionale `CONF_RICHIAMO_TEMPLATE_SID`. Query: `crm_lead_status` con `conferme_outcome = 'da_rifissare'`, `conversation_id` non null, `recall_at` tra now−1h e now+3h; poi le conversazioni (`ai_paused_at`, `wa_number`, `conf_richiamo_sollecito_for_at`, `leads(phone_e164, first_name)`, filtro `FILTRO_FUORI_LANCIO`) e l'ultimo inbound. `giaInviato` = `conf_richiamo_sollecito_for_at` uguale (per istante) a `recall_at`. Presa PRIMA dell'invio con update condizionato, sul modello di `lib/gdo-reminder24-claim.ts` (rilascio se l'invio fallisce). Invio: template con `sendTemplateAndLog(..., body)` o testo con `sendFreeText` + insert in `messages` + `last_message_at`, come il ramo GDO. event_log `conf_richiamo_sollecito_sent` / `conf_richiamo_sollecito_error`. Risposta: `{ ..., richiamo: { sent, skipped } }`.
- [ ] **Step 5: niente promemoria sui parcheggiati.** Helper I/O `conversazioniParcheggiate(supabase, ids: number[]): Promise<Set<number>>` in `lib/conf-richiamo.ts` (righe `crm_lead_status` con `conferme_outcome = 'da_rifissare'` per quei `conversation_id`). Nei rami `promemoriaBot` e `promemoriaGdo` e in `gdo-video-followups` (i messaggi che parlano della call) le conversazioni parcheggiate si saltano.
- [ ] **Step 6: script template** `scripts/crea-template-richiamo-conferme.ts`, copia del pattern di `scripts/crea-template-reminder-gdo.ts`: NAME `fenice_richiamo_conferme_v1`, ESEMPIO `{ '1': 'Luca', '2': 'oggi alle 16:00' }`, BODY = `sollecitoRichiamoText({ '1': '{{1}}', '2': '{{2}}' })`, categoria UTILITY. NON eseguirlo.
- [ ] **Step 7:** suite verde, typecheck 0. Commit.

### Task 5 (BOT): commenti e esempio

**Files:** `lib/bot-outcome.ts` (~477, ~624), `lib/fenice-autoreply.ts` (~1342, ~1388), `lib/mario.ts` (~27, ~205), `scripts/crea-template-reminder-gdo.ts:15`.

- [ ] Riscrivere i commenti che parlano della rotazione/limite delle 20: oggi la finestra di prenotazione è "domani e dopodomani" calcolata a mezzanotte (ora di Roma), fascia 10-21, le 9 solo in emergenza, nessun limite serale. Nessun cambio di codice eseguibile.
- [ ] In `crea-template-reminder-gdo.ts` l'ESEMPIO `'3': 'oggi pomeriggio'` → `'3': 'domani in mattinata dalle 9'` (solo esempio per Meta; il template approvato non si ricrea).
- [ ] typecheck 0, suite verde. Commit.
