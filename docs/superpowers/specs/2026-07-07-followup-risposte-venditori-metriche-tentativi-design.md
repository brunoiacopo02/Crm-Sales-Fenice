# Design: Follow-up review admin + Risposte Venditori + Metriche per tentativo

**Data:** 2026-07-07 · **Approvato dal PO** (rotazione password esclusa: la gestisce lui a mano)

## Obiettivo

Tre blocchi di lavoro sullo stesso branch:
1. Chiudere i follow-up non bloccanti dichiarati dalla review admin (merge `4da870c`).
2. Nuova tab "Risposte" in `/performance-venditori`: tutte le risposte dei venditori una per una, in tabella.
3. Nuova sezione in `/kpi-gdo`: tasso risposta e fissaggio per numero di chiamata (1ª–4ª+), split Nuovi vs Database. Solo metriche: il tetto chiamate resta 3 per tutti (policy rimandata a quando il PO avrà visto i dati).

## Contesto e vincoli operativi

- Un altro terminale ha appena stabilizzato il DB dopo un outage (upgrade Micro + indici hot path, commit `6527a85`): **branch da main aggiornato**, **nessuna migrazione DB** in questo giro, query nuove leggere e paginate.
- Vincoli permanenti del progetto: Drizzle via `src/db/schema.ts`, timezone con gli helper Rome di `src/lib/dateUtils.ts`, tenancy `currentTenant()`/`companyScope`, bot (`users.isBot`) escluso dalle metriche GDO, definizioni canoniche da `src/lib/kpi/canon.ts`, niente bottoni in `<span>`/`<p>`, build verde = contratto di verifica (no test suite).

## Blocco 1 — Follow-up review

### 1a. Pulizie codice
- Eliminare `src/app/(dashboard)/panoramica-generale/SalesManagerSections.tsx` (mai importato; contiene una chiamata che fallirebbe per il TL se rimontata).
- `src/components/TeamManagementClient.tsx`: `useState(2)` di `massDailyTarget` → `DEFAULT_DAILY_APPT_TARGET` (da canon).
- `PanoramicaClient.tsx` (~riga 604): l'errore `UNAUTHORIZED` grezzo nel modal target → messaggio leggibile in italiano ("Non hai i permessi per modificare i target").

### 1b. Regola workingDays (collisione Sales Manager ↔ manager-targets)
Semantica unica della colonna `monthlyLeadTargets.workingDays`: `0 = automatico` (calcolo Rome-aware con festività), `> 0 = override manuale esplicito`, per ENTRAMBE le superfici.
- `/manager-targets` scrive già così (fix `b5467bc`) — invariato.
- Config Sales Manager (`panoramicaActions.ts` `setLeadMonthlyTarget`, oggi rifiuta `workingDays <= 0` a ~riga 261, e la form in `PanoramicaClient`): accettare 0 come "auto"; la form mostra un toggle "Auto" e, quando attivo, il valore calcolato come placeholder non editabile. Un numero > 0 resta override.
- Nessuna migrazione: le righe esistenti con valore > 0 restano override manuali (comportamento attuale, nessun cambio dati).

### 1c. Timezone residui (pre-esistenti, segnalati da B3)
Portare agli helper Rome:
- `confermeKpiActions.ts` — griglia calendario di `getConfermeKpiStats` (oggi server-time) e bound giorno di `getConfermeDailyObjectives`.
- `gdoPerformanceActions.ts` — `getGdoLeadOutcomeMetrics` e `getGdoDailyObjectives` (`new Date(y, m-1, d)` locali) e lookup mese `weeklyGamificationRules` (~riga 286).
Il comportamento cambia solo nelle ore a ridosso della mezzanotte italiana (drift max ~2h): nessun impatto visibile diurno.

### Fuori scope dichiarato
- Rotazione password admin/TL: la fa il PO a mano.
- Unique globale `monthlyLeadTargets.yearMonth` (multi-company): resta rimandato finché Serenamente è in pausa.
- Asimmetria riga ranking kpi-team per GDO disattivati (cosmetica, totali già coerenti).

## Blocco 2 — Tab "Risposte" in /performance-venditori

**Cosa:** una riga per ogni esito registrato dai venditori (tabella `salesAttempts`), tutti i venditori insieme.

**Colonne:** data esito (`outcomeAt`, formato Roma) · venditore (`users.name`) · lead (nome + telefono + funnel) · tentativo (`attemptNumber`: 0 = "Esito app", 1–3 = "FU #n") · esito (badge colorato: Chiuso verde, Non chiuso ambra, Perso rosso, Sparito grigio) · motivo non chiusura (`notClosedReason`) · prossimo follow-up (`nextFollowUpDate`) · prodotto + importo (`closeProduct`, `closeAmountEur`, solo Chiuso) · note pratica (`leads.salespersonOutcomeNotes`, troncate con tooltip/expand).

**Filtri:** venditore (default: tutti), mese (default: corrente), esito, motivo non chiusura. Reset pagina al cambio filtro.

**Architettura:**
- Nuova server action `getVenditoriRisposte(filters, page)` in `venditorePerformanceActions.ts` (o file affiancato): `salesAttempts` INNER JOIN `leads` (nome, telefono, funnel, note) e `users` (nome venditore), `companyScope`, bound mese con `monthBoundsRome` su `outcomeAt`, ORDER BY `outcomeAt` DESC con tiebreaker `id`, **paginazione server 50 righe** + count totale.
- UI: `PerformanceVenditoriClient.tsx` diventa a due tab ("Performance" = vista attuale invariata, "Risposte" = nuova tabella). La tab Risposte è un componente client dedicato (`VenditoriRisposteTab.tsx`) con overflow-x proprio.
- Accesso: identico alla pagina (ADMIN/MANAGER, TL Conferme read-only via gate esistente). Nessuna azione di scrittura nella tabella (sola lettura per tutti).

**Alternativa scartata:** caricare tutti gli attempts del mese lato client e filtrare in JS — più semplice ma cresce linearmente col volume; il DB è appena stato stabilizzato, si pagina lato server.

## Blocco 3 — "Resa per tentativo" in /kpi-gdo

**Cosa:** tabella per numero di chiamata — righe 1ª / 2ª / 3ª / 4ª+ — colonne: chiamate fatte, % risposta, % fissaggio; con split **Nuovi vs Database** (stessa tabella, due gruppi di colonne: "Nuovi" e "Database"). Scopo dichiarato dal PO: capire se la 4ª chiamata rende, per poi decidere un eventuale tetto differenziato (Nuovi=4, Database=2). **Nessun cambio di policy ora**: lo scarto automatico resta al 3° tentativo a vuoto per tutti.

**Definizioni:**
- *Numero tentativo* = posizione della chiamata nella storia completa del lead (`row_number()` su `callLogs` partizionato per `leadId`, ordinato per `createdAt, id`), NON contatore ricalcolato sul periodo: una chiamata nel periodo può essere la 3ª del lead.
- *Risposta* = outcome ≠ `NON_RISPOSTO` e non "numero inesistente" (riusare la semantica `isNeverAnsweredLog` di `kpiAdvancedActions`).
- *Fissaggio* = outcome `APPUNTAMENTO` su quella chiamata (misura di resa della chiamata; l'attribuzione canonica dei fissati per data resta `apptSetAt` e non cambia).
- *Database* = `leads.funnel` uguale a `database` case-insensitive (pattern `EXCLUDED_FUNNEL` esistente); *Nuovi* = tutto il resto.
- Bot escluso (chiamate con `userId` bot fuori dal computo, come da regola B2).

**Architettura:**
- Nuova server action `getGdoCallAttemptMetrics({startDate, endDate, funnel?})` (in `kpiAdvancedActions.ts` o modulo affiancato): window function via Drizzle `sql` operator sul query builder (niente SQL raw standalone) — CTE: row_number per lead sui `callLogs` company-scoped, poi filtro periodo e aggregazione per bucket tentativo (1,2,3,4+) × tipo lead. Una sola query, indici esistenti su callLogs sufficienti; se il piano di esecuzione risultasse pesante, fallback: due query (log del periodo + conteggio log precedenti per gli stessi lead) aggregate in JS.
- UI: nuova card "Resa per tentativo" in `KpiGdoBoard`, sotto il trend, che rispetta i filtri periodo/funnel già presenti (quando il filtro funnel è attivo, lo split Nuovi/Database si riduce alla sola colonna pertinente).

## Test / verifica

- `npx tsc --noEmit` + `npm run build` verdi per ogni task.
- QA browser (admin): tab Risposte con filtri e paginazione su dati reali; card Resa per tentativo con numeri plausibili (somma chiamate per tentativo = totale chiamate del periodo, bot escluso); form Sales Manager con toggle Auto; regressione: vista Performance attuale invariata.
- Verifica dati: nessuna migrazione, nessuna scrittura nuova oltre a quelle esistenti.

## Rollout

Branch `feat/risposte-venditori-metriche-tentativi` da main aggiornato → esecuzione subagent-driven (un commit per task, review per task, review finale whole-branch) → QA → merge + deploy Vercel → smoke prod.
