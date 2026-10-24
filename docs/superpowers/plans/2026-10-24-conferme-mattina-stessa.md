# Conferme mattina stessa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le Conferme chiamano le call del mattino la mattina stessa (dalle 9). Chi fissa (bot e GDO) può proporre anche domani mattina, dalle 10 (le 9 solo in emergenza), senza il limite delle 20.

**Architecture:** CRM: la decisione "in che colonna della board sta un lead" diventa una funzione pura (`src/lib/conferme/boardWindow.ts`), usata dal ramo `strict_kanban` di `getConfermeAppointments`. Una colonna nuova `appointmentMovedAt`, timbrata da ogni spostamento, distingue "fissato/spostato oggi". Bot: si tolgono la rotazione delle 20:00 e la fascia 15-21 di domani da `booking-slots.ts`, e si riscrive la regola "quando chiama Noemi" (prompt + `gdo-context-note.ts`).

**Tech Stack:** Next.js 14 + Drizzle + node:test (CRM, `C:\Users\bruno\Desktop\CRM-GDO-mattina`, branch `feat/conferme-mattina-stessa`). Next 16 + Supabase JS + Vitest/bun (bot, `C:\Users\bruno\Desktop\Software-Messaggistica-mattina`, branch `feat/conferme-mattina-stessa`).

**Spec:** `docs/superpowers/specs/2026-10-24-conferme-mattina-stessa-design.md`

## Global Constraints

- Tutti gli orari e i giorni si leggono in **Europe/Rome**.
- "Mattina" = ore **9-14** (09:00-14:59). "Pomeriggio" = dalle **15**.
- Board "Oggi" = oggi, ore **9-21**. Board "Domani mattina" = prossimo giorno lavorativo (domenica esclusa), ore 9-14.
- Fascia di fissaggio proposta: **dalle 10:00 alle 21:00**. Le **09:00** solo se il lead non può in nessun altro orario. Vale per entrambi i giorni del bot e per l'avviso GDO.
- Nessun push su `main` di nessuno dei due repo, e nessuna migrazione applicata in prod, finché Bruno non dà il via.
- Non toccare i canali realtime (`postgres_changes`/broadcast) né lo script di vendita.
- Commenti e messaggi di commit in italiano, nello stile dei file toccati.

## Review Focus

1. **Lunedì / sabato**: il sabato "Domani mattina" è il **lunedì**. Un lunedì 10:00 fissato venerdì compare il sabato, uno fissato sabato no. → test in Task 1.
2. **Lead senza `appointmentCreatedAt`** (lead vecchi) → trattato come fissato con anticipo, quindi visibile in "Domani mattina". → test in Task 1.
3. **NR registrato oggi vs NR di un giorno precedente**: solo quello di oggi nasconde il lead da "Domani mattina". → test in Task 1.
4. **Mezzanotte UTC vs Roma**: un appuntamento alle 00:30 di Roma (22:30 UTC del giorno prima) non deve finire nel giorno sbagliato. Lo stesso per "oggi" calcolato alle 00:30 di Roma. → test in Task 1.
5. **Bot alle 23:30 di lunedì**: propone ancora martedì (non mercoledì+giovedì), e la guardia `checkDataAppuntamento` accetta martedì 10:00. → test in Task 6.

---

### Task 1: Funzione pura della board Conferme (CRM)

**Files:**
- Create: `src/lib/conferme/boardWindow.ts`
- Test: `src/lib/conferme/boardWindow.test.ts`
- Modify: `package.json` (aggiungere il test allo script `test`)

**Interfaces:**
- Produces:
```ts
export type BoardLeadInput = {
    appointmentDate: Date | null;
    appointmentCreatedAt: Date | null;
    appointmentMovedAt: Date | null;
    confCall1At: Date | null;
    confCall2At: Date | null;
    confCall3At: Date | null;
};
export type BoardColumn = 'oggi' | 'domani' | null;
/** Prossimo giorno lavorativo (salta la domenica) come 'YYYY-MM-DD' Roma. */
export function nextWorkDayRome(now: Date): string;
export function confermeBoardColumn(lead: BoardLeadInput, now: Date): BoardColumn;
export const OGGI_ORE: readonly number[];   // 9..21
export const DOMANI_ORE: readonly number[]; // 9..14
```

Regole di `confermeBoardColumn`:
- `appointmentDate` nullo → `null`.
- Giorno di Roma = oggi e ora tra 9 e 21 → `'oggi'`.
- Giorno = `nextWorkDayRome(now)`, ora tra 9 e 14, nessun `confCall1/2/3At` caduto oggi (Roma), e in più una delle due:
  - `max(appointmentCreatedAt, appointmentMovedAt)` è prima della mezzanotte di oggi, oppure entrambi sono nulli;
  - ora === 9.

  → `'domani'`.
- Altrimenti `null`. Usare `toRomeDateStr` / `dayBoundsRome` da `src/lib/dateUtils.ts`.

- [ ] **Step 1: Scrivere i test** (node:test, stile di `blockingAlert.test.ts`). `NOW` = lunedì 26/10/2026 11:00 Roma (`2026-10-26T10:00:00Z`, ora solare +01:00):
  - `mar 27/10 10:00, creato sab 24/10` → `'domani'`
  - `mar 27/10 10:00, creato lun 26/10 08:00` → `null`
  - `mar 27/10 09:00, creato lun 26/10 08:00` → `'domani'` (eccezione delle 9)
  - `mar 27/10 10:00, creato sab 24/10, spostato lun 26/10` → `null`
  - `mar 27/10 10:00, creato sab, confCall1At = lun 26/10 09:30` → `null`
  - `mar 27/10 10:00, creato sab, confCall1At = ven 23/10` → `'domani'`
  - `mar 27/10 10:00, creato null, spostato null` → `'domani'`
  - `mar 27/10 15:00, creato sab` → `null` (il pomeriggio non si chiama il giorno prima)
  - `lun 26/10 09:00` → `'oggi'`; `lun 26/10 21:00` → `'oggi'`; `lun 26/10 22:00` → `null`
  - `mer 28/10 10:00, creato sab` → `null`
  - con `NOW` = sab 24/10 11:00: `nextWorkDayRome` = `'2026-10-26'`; `lun 26/10 10:00, creato ven 23/10` → `'domani'`; `creato sab 24/10 08:00` → `null`
  - con `NOW` = `2026-10-26T23:30:00Z` (00:30 di mar 27 a Roma): `mar 27/10 10:00` → `'oggi'`
- [ ] **Step 2:** `node --import tsx --test src/lib/conferme/boardWindow.test.ts` → FAIL (modulo mancante)
- [ ] **Step 3:** Implementare `boardWindow.ts`.
- [ ] **Step 4:** stesso comando → PASS. Aggiungere il file allo script `test` di `package.json`.
- [ ] **Step 5:** Commit `feat(conferme): regola pura della board Oggi / Domani mattina`

### Task 2: Colonna `appointmentMovedAt` timbrata dagli spostamenti (CRM)

**Files:**
- Create: `drizzle/migrations/0044_appointment_moved_at.sql`
- Modify: `src/db/schema.ts` (accanto ad `appointmentCreatedAt`, riga ~219)
- Modify: gli update che cambiano `appointmentDate` di un lead **già** con un appuntamento:
  - `src/app/actions/confermeActions.ts` → `updateLeadDataConferme` (~riga 543) e `scheduleConfermeRecall` (ramo `newAppointmentDate`);
  - `src/app/actions/appointmentActions.ts` → `updateGdoAppointment` (~riga 107);
  - `src/app/actions/venditoreActions.ts` → reschedule venditore (~riga 935);
  - `src/app/api/bot/outcome/route.ts` → ramo SPOSTAMENTO (~riga 289).

**Interfaces:**
- Produces: `leads.appointmentMovedAt: timestamp('appointmentMovedAt', { withTimezone: true, mode: 'date' })`, nullable.

- [ ] **Step 1:** Migrazione in stile `0041`: commento in testa (PO 24/10/2026, perché serve) + `alter table public.leads add column if not exists "appointmentMovedAt" timestamptz;`. **Non applicarla in prod.**
- [ ] **Step 2:** Schema Drizzle.
- [ ] **Step 3:** In ogni punto elencato, `appointmentMovedAt: new Date()` nello stesso `.set()`. Solo quando la data cambia davvero e c'era già una data: stessa condizione del webhook `appointment.rescheduled` già presente lì, o `sameSlot` per il bot. Dove il `.set()` avviene prima del confronto, calcolare il booleano prima.
- [ ] **Step 4:** `npx tsc --noEmit -p .` → nessun errore nuovo.
- [ ] **Step 5:** Commit `feat(conferme): appointmentMovedAt timbra ogni spostamento dell'appuntamento`

### Task 3: `strict_kanban` usa la regola nuova (CRM)

**Files:**
- Modify: `src/app/actions/confermeActions.ts:153-246` (blocco `if (filters.fetchMode === 'strict_kanban')` con le regole per giorno della settimana e gli override festivi datati)

**Interfaces:**
- Consumes: `confermeBoardColumn` (Task 1), `leads.appointmentMovedAt` (Task 2).

- [ ] **Step 1:** Sostituire l'intero filtro con: tieni `row` se `row.lead.confNeedsReschedule`, oppure se `confermeBoardColumn(row.lead, now) !== null`. Rimuovere le costanti `isHolidayOverride*`. La finestra SQL −1/+4 giorni (righe 99-109) resta.
- [ ] **Step 2:** `npx tsc --noEmit -p .` → ok.
- [ ] **Step 3:** Commit `feat(conferme): la board mostra oggi dalle 9 e domani mattina solo per i fissati con anticipo`

### Task 4: Tab "Oggi" e "Domani mattina" (CRM)

**Files:**
- Modify: `src/components/ConfermeBoard.tsx` (righe 25, 29, 172-198, 218-221, 333-334, 397, 480-492, 538-545)

**Interfaces:**
- Consumes: `confermeBoardColumn`, `OGGI_ORE`, `DOMANI_ORE` (Task 1).

- [ ] **Step 1:** `ViewMode`: `'pomeriggio'` → `'oggi'`, `'mattina'` → `'domani'`, default `'oggi'`.
  - Split `oLeads`/`dLeads`: `oLeads` con `confermeBoardColumn(...) === 'oggi'`, `dLeads` con `'domani'`.
  - Ore: `OGGI_ORE` / `DOMANI_ORE` formattate `HH:00`, uguali per tutti i giorni (via il ramo sabato).
  - Etichette dei tab: **"Oggi"** (icona `Sun`) e **"Domani mattina"** (icona `Sunrise`).
- [ ] **Step 2:** `npx tsc --noEmit -p .` e `npx next lint --file src/components/ConfermeBoard.tsx` → ok.
- [ ] **Step 3:** Commit `feat(conferme): tab Oggi (dalle 9) e Domani mattina`

### Task 5: Avviso GDO sulla fascia (CRM)

**Files:**
- Modify: `src/components/GdoQuickActions.tsx:52-67` (`appointmentSlotWarning`)

- [ ] **Step 1:** Nessun avviso se `dayDiff` è 1 o 2 e l'ora è fra 10:00 e 21:00.
  - Ora tra 9:00 e 9:59 con `dayDiff` 1 o 2: avviso "Le 9:00 solo se il lead non può in nessun altro orario: la fascia giusta è dalle 10:00 alle 21:00."
  - `dayDiff < 1`: "Data nel passato o per oggi: fissa per domani o dopodomani, dalle 10:00 alle 21:00."
  - `dayDiff > 2`: "Data troppo lontana: fissa per domani o dopodomani, dalle 10:00 alle 21:00."
  - Altrimenti: "Orario fuori finestra: l'appuntamento va dalle 10:00 alle 21:00."
- [ ] **Step 2:** `npx tsc --noEmit -p .` → ok.
- [ ] **Step 3:** Commit `feat(gdo): l'avviso sulla fascia segue la regola nuova (domani mattina compreso, dalle 10)`

### Task 6: Giorni e fasce del bot (bot)

**Files:**
- Modify: `lib/booking-slots.ts` (`computeBookingDays` riga ~106, `fascia` riga ~121, le tre forme di `bookingSlotsContext`)
- Modify: `lib/bot-outcome-rules.ts` (solo il commento sulla rotazione delle 20:00 in `checkDataAppuntamento`)
- Test: `lib/booking-slots.test.ts`, `lib/bot-outcome-rules.test.ts`

- [ ] **Step 1: Test.**
  - Aggiornare quelli che si aspettano `'dalle 15:00 alle 21:00'` (righe 61, 182, 225) e la rotazione delle 20.
  - Nuovi: alle 23:30 di lunedì 26/10, `computeBookingDays` → `day1` = 2026-10-27, `day2` = 2026-10-28.
  - Il contesto contiene per entrambi i giorni `'dalle 10:00 alle 21:00'` e la frase sulle 09:00 di emergenza, e non contiene `'dalle 15:00'`.
  - `checkDataAppuntamento('2026-10-27T10:00:00+01:00', <lun 26/10 23:30>, [], undefined)` → `{ ok: true }`; con `T09:00` → `{ ok: true }`.
- [ ] **Step 2:** `bun run test lib/booking-slots.test.ts lib/bot-outcome-rules.test.ts` → FAIL
- [ ] **Step 3:** Implementare.
  - Togliere `if (romeHour(now) >= 20) ...`.
  - La fascia è una costante: `'dalle 10:00 alle 21:00 (le 09:00 solo se il lead non può in nessun altro orario)'`.
  - `day1Imminente` resta nel tipo, perché ha altri consumatori: verificare con grep, e se non ne ha toglierlo.
  - Aggiornare i commenti delle 20:00.
- [ ] **Step 4:** stesso comando → PASS
- [ ] **Step 5:** Commit `feat(fissaggio): domani mattina prenotabile, fascia 10-21, niente piu' rotazione alle 20`

### Task 7: Quando chiama Noemi (bot)

**Files:**
- Modify: `lib/gdo-context-note.ts` (`NOEMI_SOGLIA_STESSO_GIORNO`, `quandoChiamaNoemi`) + i suoi chiamanti
- Modify: `lib/mario-prompt.ts` (blocco "CHI È NOEMI E QUANDO CHIAMA" righe ~257-267, forme di `[QUANDO]` righe ~278-281)
- Modify: `lib/fenice-autoreply.ts:484` (solo il commento)
- Test: `lib/gdo-context-note.test.ts`, `lib/mario-prompt.test.ts` / `lib/confirmation-block.test.ts` se verificano quel testo

**Interfaces:**
- Produces: `quandoChiamaNoemi(quando: Date | null, now: Date): string`. Il parametro `now` è nuovo: i chiamanti passano `new Date()` o il `now` che hanno già.

Regola, da usare identica in prompt e funzione:

| Ora della call | Quando si fissa | Cosa promettere |
|---|---|---|
| dalle 15 | qualsiasi | stesso giorno, qualche ora prima (invariato) |
| 10-14 | call oggi o domani rispetto a `now` | la mattina stessa, dalle 9, prima della call |
| 10-14 | call più in là | il pomeriggio del giorno prima, e se non lo trova la mattina stessa |
| 9 | qualsiasi | il giorno prima |

- [ ] **Step 1: Test** su `quandoChiamaNoemi`, uno per ogni riga della tabella, con `now` = lun 26/10 11:00:
  - call mar 27 alle 10 → contiene `'mattina stessa'` e `'dalle 9'`;
  - call mer 28 alle 10 → contiene `'giorno prima'` e `'mattina stessa'`;
  - call mar 27 alle 9 → contiene `'giorno prima'` e non `'mattina stessa'`;
  - call mar 27 alle 16 → invariato;
  - `null` → `''`.
- [ ] **Step 2:** `bun run test lib/gdo-context-note.test.ts` → FAIL
- [ ] **Step 3:** Implementare la funzione. Poi riscrivere i testi del prompt.
  - Togliere "Noemi attacca alle 13:00", "Mai la mattina stessa", "Mai 'mattina' ... in [QUANDO]", e "ti chiama la mattina stessa" dalle frasi vietate.
  - Restano vietate "poco prima", "qualche minuto prima", "5 minuti prima", "prima di collegarti", "a momenti", "ti sta per chiamare". Resta "dagli la finestra, mai un orario al minuto".
  - `[QUANDO]` passa a quattro forme, una per riga della tabella, ognuna con un esempio sul modello di quelli esistenti:
    - "<giorno della call> in mattinata, prima della videochiamata";
    - "<giorno prima> nel pomeriggio, e se non ti trova <giorno della call> in mattinata";
    - "<giorno prima> nel pomeriggio" (call alle 9);
    - la forma delle 15 invariata.
- [ ] **Step 4:** `bun run test` (tutta la suite) → PASS. `bun run typecheck` → ok.
- [ ] **Step 5:** Commit `feat(noemi): le call del mattino si chiamano la mattina stessa dalle 9`

### Task 8: Verifica finale

- [ ] CRM: `npm test` → PASS; `npx tsc --noEmit -p .` → ok; `npm run build` → ok.
- [ ] Bot: `bun run test`, `bun run typecheck`, `bun run build` → ok.
- [ ] Revisione di tutto il branch da un reviewer fresco su entrambi i repo.
- [ ] Niente push. Lasciare i due branch pronti. Al via di Bruno:
  1. applicare `0044` in prod;
  2. merge su `main` del CRM;
  3. merge su `main` del bot;
  4. verificare il deploy;
  5. tenere monitorati gli `event_log` del bot: appuntamenti fissati, rifiuti `fuori_finestra`/`fuori_fascia`, promemoria.
