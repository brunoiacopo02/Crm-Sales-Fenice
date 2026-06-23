# Ritorno lead dal bot → riassegnazione round-robin ai GDO

**Data:** 2026-06-23
**Stato:** approvato (design), pronto per implementazione

## Problema

Il bot fissatore (account `GDO 201`, `isBot=true`) contatta i lead Fenice via WhatsApp.
Quando non riesce a convertire perché la persona **non ha mai risposto** o **la chat si è
interrotta senza un'obiezione ferrea** (es. "non ho soldi"), quei lead vanno **restituiti** al
CRM e **riassegnati a un GDO umano** via round-robin, perché sono ancora lavorabili a voce.
Solo le **obiezioni ferree** restano scarto definitivo.

Oggi tutti gli esiti del bot lasciano il lead assegnato al bot (`assignedToId` non cambia) e
non esiste nessun meccanismo di "ritorno al pool umano".

## Decisioni (dal brainstorming)

1. **Contratto esiti**: `NON_RISPOSTO` (mai risposto) riassegna; nuovo esito `INTERROTTO`
   (chat interrotta senza obiezione ferrea) riassegna; `DA_SCARTARE` resta scarto (solo
   obiezione ferrea); `APPUNTAMENTO`/`RICHIAMO` invariati.
2. **Stato del lead riassegnato**: come nuovo — `status='NEW'`, `callCount=0`. I tentativi del
   bot non contano come chiamate del GDO.
3. **Contesto bot per il GDO**: nessuno. Arriva come lead normale (il `botReport` resta nel DB
   ma non viene mostrato in pipeline GDO).

## Architettura

### Punto di intervento: solo lato bot
La logica vive **esclusivamente** in `src/app/api/bot/outcome/route.ts`. `updateLeadOutcome`
(`pipelineActions.ts`) resta **intatto**: il `NON_RISPOSTO` dei GDO umani continua a funzionare
come oggi. Questo evita regressioni sui flussi umani.

Nel route, dopo il caricamento del lead e la verifica che l'assegnatario sia un account bot:
- se `outcome ∈ { NON_RISPOSTO, INTERROTTO }` → chiama `reassignBotLeadToHumanPool(...)`;
- altrimenti (`APPUNTAMENTO`, `DA_SCARTARE`, `RICHIAMO`) → percorso esistente `updateLeadOutcome`.

`INTERROTTO` viene aggiunto a `VALID_OUTCOMES`. Il blocco di validazione `date` (richiesto solo
per `APPUNTAMENTO`/`RICHIAMO`) resta invariato.

### Nuova funzione `reassignBotLeadToHumanPool(leadId, reason, botUserId)`
File nuovo: `src/lib/bot-fissatore/reassign.ts`. Esegue tutto in `db.transaction`.

- **Pool destinatari** (identico ai lead nuovi AC): `users` con
  `companyId='fenice'`, `role='GDO'`, `isActive=true`, `acAutoIntake=true`, `isBot=false`.
- **Round-robin** (identico al webhook AC): ordina per
  `coalesce(acLastAssignedAt, 'epoch') ASC`, tiebreak `id ASC`; prende il primo; aggiorna il suo
  `acLastAssignedAt = now`. I lead tornati si intervallano equamente con i nuovi AC nello stesso giro.
- **Update lead**: `assignedToId = gdoId`, `status='NEW'`, `callCount=0`, `recallDate=null`,
  `recallNote=null`, `recallMissedAt=null`, `version = version+1`, `updatedAt = now`.
- **Audit**: insert `leadEvents` con `eventType='REASSIGNED_FROM_BOT'`, `userId=gdoId`,
  `metadata={ reason, fromBot: botUserId, toGdo: gdoId }`, `companyId='fenice'`
  (insert diretto, come già fatto per `BOT_REPORT` nel route — nessun cambio a `eventLogger`).
- **Realtime**: il cambio `assignedToId` notifica già il board del GDO via il channel
  `postgres_changes` esistente. Nessuna modifica ai channel.
- **Ritorno**: `{ ok: true, assignedToId }` oppure `{ ok: false, error }`.

### Edge case: nessun GDO eleggibile
Se il pool è vuoto: lead lasciato **non assegnato** (`assignedToId=null`, `status='NEW'`,
`callCount=0`, campi richiamo puliti, `version+1`), + evento `REASSIGNED_FROM_BOT` con
`toGdo=null` e `metadata.note='no_eligible_gdo'`. L'admin lo recupera dal pool non assegnato.
Il route ritorna comunque 200 (il lead è stato "restituito", solo non c'era un umano).

### Idempotenza
Gratis: una volta riassegnato a un umano, una successiva callback del bot sullo stesso lead
incontra il guard esistente "lead non assegnato a un account bot" → 403. Nessun doppio rimbalzo.

## File toccati
- `src/lib/bot-fissatore/reassign.ts` — NUOVO (funzione + transazione round-robin).
- `src/app/api/bot/outcome/route.ts` — `INTERROTTO` in `VALID_OUTCOMES` + branch riassegnazione.
- `docs/bot-fissatore-contract.md` — nuovo esito `INTERROTTO` + nuova semantica `NON_RISPOSTO`.

## Fuori scope (YAGNI)
- Nessun cambio a `updateLeadOutcome` (flussi umani intatti).
- Nessun report bot visibile al GDO.
- Nessun nuovo cron: tutto real-time sulla callback del bot.
- Nessuna UI GDO.

## Note per il team bot (contratto)
- `NON_RISPOSTO`: usare quando la persona **non ha mai risposto** dopo il ciclo di solleciti.
  Da ora il CRM la **riassegna a un operatore umano** (non più scarto).
- `INTERROTTO` (NUOVO): usare quando la chat è iniziata ma si è **interrotta senza un'obiezione
  ferrea**. Il CRM la riassegna a un operatore umano.
- `DA_SCARTARE`: usare **solo** per obiezione ferrea reale (es. "non ho soldi", "non mi interessa").
  Resta scarto definitivo.
- `APPUNTAMENTO` / `RICHIAMO`: invariati.
