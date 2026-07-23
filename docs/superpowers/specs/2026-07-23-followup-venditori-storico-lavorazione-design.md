# Follow-up Venditori: Sposta senza esito, Storico trattative, In lavorazione

**Data**: 2026-07-23 · **Approccio**: A (minimale — 2 colonne su `leads`, `salesAttempts` intatta)

## Problema

1. **Spostare un follow-up** non esiste come azione: se il lead sposta l'appuntamento telefonico, il venditore è costretto a registrare un nuovo esito "Non chiuso" (consuma uno dei 3 follow-up del tetto) solo per cambiare la data.
2. **I lead esitati spariscono**: Chiuso / Sparito / Non chiuso-senza-data escono da tutte le viste del venditore. Nessuno storico consultabile.
3. **Nessun parcheggio "In lavorazione"**: se il lead non dà una data/ora precisa, il venditore non ha dove tenerlo.

## Stato attuale (verificato)

- `salesAttempts` è la storia degli esiti (1 riga per tentativo); `leads.*` è lo stato corrente. Unico writer: `saveVenditoreOutcome` (`src/app/actions/venditoreActions.ts`).
- Tetto follow-up: `MAX_FOLLOW_UPS = 3` in `src/lib/venditorePerformance/guard.ts`, contato su **tutti** i `salesAttempts` con outcome `Non chiuso` del lead.
- "Non chiuso" **senza** data è già ammesso dal guard (decisione PO 2026-07-08), ma `getVenditoreFollowUps` filtra i lead senza `nextFollowUpDate` → il lead sparisce (root cause del punto 2 per i Non chiusi).
- Esito "Perso" rimosso 2026-07-08; esiste solo in dati storici.
- Tab venditore attuali: LISTA · FOLLOWUP (bucket Scaduti/Oggi/Prossimi) · AGENDA · CLASSIFICA · PERFORMANCE.

## Decisioni PO (2026-07-23)

| Tema | Decisione |
|---|---|
| Spostamento data follow-up | Azione dedicata, **non** conta nel tetto 3, spostamenti illimitati, traccia in timeline |
| Storico trattative | Tab dedicata, filtro per esito, **con riapertura** dei non-Chiusi |
| Riapertura | **Nuovo ciclo da zero**: il tetto 3 riparte; storico tentativi resta visibile; i Chiusi non sono riapribili |
| In lavorazione | Azione esplicita "Metti in lavorazione", **solo** da lead con follow-up pendente; non consuma tentativi |
| Anti-stallo | Badge età sulla card (giallo >7gg, rosso >14gg) + contatore per venditore su /monitor-vendite; nessun blocco automatico |

## Schema (migrazione 0024, a mano)

Due colonne su `leads`, nullable, nessun backfill:

```
inLavorazioneAt   timestamptz NULL  -- se valorizzato: lead nella sezione "In lavorazione"
salesCycleStartAt timestamptz NULL  -- valorizzato alla riapertura: inizio del ciclo corrente
```

`salesAttempts` NON cambia. Il tetto 3 conta solo gli attempt `Non chiuso` con `outcomeAt >= salesCycleStartAt` (se null → tutti, comportamento identico a oggi).

**Fonte di verità del follow-up pendente**: diventa `leads.followUp1Date` (già mirrorato ad ogni save). `getVenditoreFollowUps` viene rifattorizzata per leggere da lì invece che derivare dall'ultimo attempt — necessario perché dopo una riapertura il nuovo ciclo non ha ancora attempt. `salesAttempts` resta la storia per analytics.

## Feature 1 — Sposta follow-up senza esito

**Server action** `rescheduleFollowUp(leadId, newDate)`:
- Guard: ruolo VENDITORE (o staff), lead assegnato al venditore, follow-up pendente (`followUp1Date` non nullo **oppure** lead in lavorazione/riaperto che sta fissando la prima data).
- Aggiorna `leads.followUp1Date = newDate`, azzera `inLavorazioneAt`, e aggiorna `nextFollowUpDate` dell'ultimo attempt `Non chiuso` del ciclo corrente **se esiste** (coerenza storica).
- Evento timeline `followup_rescheduled` con `{ oldDate, newDate }`.
- Nessuna riga `salesAttempts`, nessun impatto sul tetto.
- Data dal client come da regola fuso IT (CLAUDE.md §4.3).

**UI**: bottone "Sposta" (icona orologio) sulla card follow-up e nel drawer in modalità follow-up → picker `datetime-local` inline. Serve anche da "Fissa follow-up" per i lead In lavorazione e riaperti.

## Feature 2 — Storico trattative

**Server action** `getVenditoreStorico(sellerId)`: lead del venditore con `salespersonOutcome` valorizzato e **senza** follow-up pendente né in lavorazione — cioè i lead "usciti" dalle viste operative. Include per ogni lead la lista dei suoi `salesAttempts` (data, esito, motivo, prodotto, importo).

**UI**: nuova tab "STORICO" nella dashboard venditore:
- Chip filtro esito: Tutti · Chiuso · Non chiuso · Sparito (i "Perso" legacy mostrati sotto Non chiuso).
- Ricerca nome/telefono. Riga espandibile con la storia dei tentativi.
- Bottone **"Riapri trattativa"** sui non-Chiusi.

**Server action** `reopenNegotiation(leadId)`:
- Guard: venditore assegnato, `salespersonOutcome !== 'Chiuso'`.
- Set: `salesCycleStartAt = now`, `inLavorazioneAt = now`, `salespersonOutcome = null`, `salespersonOutcomeNotes = null`, `notClosedReason = null`, `followUp1Date/2 = null`. `presentedAt`, `closeProduct/Amount` storici e tutti i `salesAttempts` restano intatti.
- Evento timeline `negotiation_reopened`.
- Il lead riappare in "In lavorazione" con tetto 3 pieno; il check-in trattativa NON va rifatto (`negotiationStartedAt` resta).

## Feature 3 — In lavorazione

**Server action** `parkLead(leadId)`:
- Guard: venditore assegnato, follow-up pendente (`followUp1Date` non nullo).
- Set `inLavorazioneAt = now` (il `followUp1Date` resta com'è ma il lead esce dai bucket). Evento `lead_parked`.

**UI**: dentro la tab FOLLOWUP, sotto i 3 bucket, sezione "In lavorazione (n)":
- Card come le follow-up ma senza data, con badge età: `>7gg` giallo, `>14gg` rosso, altrimenti neutro ("in lavorazione da N giorni").
- Azioni per card: **"Fissa follow-up"** (picker → `rescheduleFollowUp`, torna nei bucket) e **"Registra esito"** (apre il drawer in followUpMode; `saveVenditoreOutcome` azzera sempre `inLavorazioneAt`).
- Bottone "Metti in lavorazione" sulle card dei bucket Scaduti/Oggi/Prossimi.
- `getVenditoreFollowUps` esclude i lead con `inLavorazioneAt` valorizzato; nuova query (o stessa action) li restituisce come 4° gruppo.

**Manager** (`/monitor-vendite`): per ogni venditore, contatore "In lavorazione" + età media in giorni (rosso se almeno un lead >14gg). Sola lettura.

## Modifiche a codice esistente (riepilogo)

| File | Modifica |
|---|---|
| `src/db/schema.ts` + migrazione 0024 | 2 colonne nuove su `leads` |
| `src/lib/venditorePerformance/guard.ts` | `priorNonClosedCount` calcolato dal chiamante solo sul ciclo corrente (firma invariata) |
| `src/app/actions/venditoreActions.ts` | `saveVenditoreOutcome`: conteggio tentativi filtrato per ciclo + azzera `inLavorazioneAt`; refactor `getVenditoreFollowUps`; nuove action `rescheduleFollowUp`, `parkLead`, `getVenditoreStorico`, `reopenNegotiation` |
| `src/components/VenditoreDashboardClient.tsx` | tab STORICO, sezione In lavorazione, bottoni Sposta/Parcheggia |
| `src/components/VenditoreDrawer.tsx` | bottone Sposta in followUpMode |
| `src/app/actions/venditoriMonitorActions.ts` + `MonitorVenditeClient.tsx` | contatore In lavorazione per venditore |

## Invarianti / non-obiettivi

- **KPI intatti**: `salesAttempts` mai riscritta; chiusure/fatturato (outcomeAt), presenze (presentedAt latch), canon, aggregate/performance non cambiano. Gli attempt di un ciclo riaperto proseguono l'`attemptNumber` globale: la card "Resa per tentativo" e il funnel per tentativo li vedranno come tentativi 4+ — limite noto e accettato dell'approccio A.
- **Nessuna gamification nuova** su sposta/parcheggia/riapri.
- Realtime: nessun canale nuovo; si riusano i refresh esistenti della dashboard venditore.
- 'Perso' non torna: gli esiti restano Chiuso · Non chiuso · Sparito.

## Addendum — Decisione PO 2026-07-23 (post-review): niente riapertura

La "riapertura trattativa" descritta sopra è stata **eliminata prima del deploy**: azzerare `salespersonOutcome` toglieva il lead dai totali esitati di /kpi-venditori (closing rate gonfiato). Regole finali:

- Dallo Storico, un lead con esito ≠ Chiuso può SOLO essere **aggiornato subito a "Chiuso"** (bottone "Registra chiusura": prodotto + importo + data → `saveVenditoreOutcome` con OCC). Mai stato senza esito, mai cambio a Sparito.
- I lead "In lavorazione" mantengono l'esito `Non chiuso` (il parcheggio non tocca l'esito) → contano come non chiusi nei KPI.
- `reopenNegotiation` rimossa; `salesCycleStartAt` e la logica ciclo-aware (guard, clamp, ramo query difensivo) restano nel codice ma inerti: nulla valorizza più la colonna.

## Testing

- Unit: guard con `salesCycleStartAt` (ciclo nuovo → tetto ripartito; null → identico a oggi) in `guard.test.ts`.
- Azioni: reschedule non crea attempt; park esclude dai bucket; reopen azzera i campi giusti e NON tocca `salesAttempts`; save azzera `inLavorazioneAt`.
- Build pulita + QA browser su prod dopo deploy (flusso: sposta → parcheggia → fissa → esito → storico → riapri).
