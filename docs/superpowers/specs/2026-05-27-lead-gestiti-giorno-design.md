# Lead Gestiti / Giorno — Throughput GDO (Design Spec)

**Data**: 2026-05-27
**Stato**: Draft — in revisione utente
**Autore**: Claude (per Bruno)
**Area**: `/kpi-gdo` (Dashboard Manager)

---

## 1. Obiettivo

Calcolare per ogni GDO **quanti lead può gestire al giorno**, dove "gestire" significa portare un lead a stato terminale (`APPOINTMENT` o `DISCARDED`).

La formula è:

```
lead_gestibili_per_giorno = chiamate_al_giorno / media_chiamate_per_lead
```

La metrica primaria è `lead_gestibili_per_giorno` ("capacità teorica"). Le altre tre metriche (`media chiamate/lead`, `chiamate/giorno`, `chiusure`) la accompagnano per dare contesto al manager.

## 2. Scope & non-scope

**In scope**:
- 4 nuove colonne nella tabella per-GDO esistente in `/kpi-gdo`
- Riga "Team" con valori aggregati (somma/somma, non media-di-medie)
- Finestra rolling 30 giorni, indipendente dal selettore di periodo UI
- Multi-tenancy (`companyId`) e `assertSalesArea()`

**Non scope** (eventuali iterazioni successive):
- Selettore di periodo dedicato per le 4 nuove colonne
- Grafico storico dell'andamento del throughput
- Pagina dedicata `/kpi-gdo/throughput`
- Attribuzione storica per riassegnazioni (uso `assignedToId` corrente)
- Throughput separato per funnel/prodotto

## 3. Architettura

### 3.1 Server action

Nuova action `getGdoThroughputMetrics30d()` in `src/app/actions/kpiAdvancedActions.ts`:

- Tenant-scoped via `currentTenant()` + `assertSalesArea()` (pattern Fase 2 multi-tenancy).
- Argomenti: nessuno. Finestra calcolata server-side:
  - `start = dayBoundsRome(now - 29 giorni).start`
  - `end = now`
- Output:
  ```ts
  type ThroughputMetrics = {
    perGdo: Array<{
      gdoId: string;
      gdoName: string;
      avgCallsPerLead: number | null;   // null se 0 lead chiusi nel periodo
      callsPerDay: number;              // 1 decimale
      dailyCapacity: number | null;     // intero, null se avgCallsPerLead null|0
      closures: number;
      closedLeadsCount: number;         // sample size, per tooltip/hint UI
    }>;
    teamTotals: {
      avgCallsPerLead: number | null;
      callsPerDay: number;
      dailyCapacity: number | null;
      closures: number;
      closedLeadsCount: number;
    };
  };
  ```

### 3.2 Query SQL (eseguite in parallelo dentro la action)

**Query A — Lead chiusi nella finestra, per GDO**
- Sorgente: `leadEvents` con `eventType IN ('APPOINTMENT_SET', 'DISCARDED')` (nomi eventi reali, vedi `src/lib/eventLogger.ts:27`) e `timestamp` nella finestra, joined con `leads`.
- Nota terminologica codebase: l'**evento** si chiama `'DISCARDED'` ma lo **status** del lead corrispondente è `'REJECTED'` (disallineamento storico). Usiamo l'evento.
- De-duplicazione: un lead può avere sia un `APPOINTMENT_SET` sia un successivo `DISCARDED` (es. appuntamento poi annullato e scartato). Prendiamo l'**ultimo** evento terminale per lead via `DISTINCT ON (leadId)` con `ORDER BY timestamp DESC`, così il lead conta una sola volta.
- Filtri: `companyId = tenant`, `assignedToId IS NOT NULL`, `isSelfBooked = false`.
- Group by `leads.assignedToId`.
- Per ogni gruppo: `SUM(leads.callCount)` e `COUNT(*)`.

**Query B — Chiamate nella finestra, per GDO**
- `callLogs` con `userId = gdoId`, `companyId = tenant`, `createdAt` nella finestra.
- Group by `userId`.
- `COUNT(*)`.

**Query C — Chiusure attribuite al GDO**
- Stesso pattern già esistente in `kpiAdvancedActions.ts:372-382` (`getGdoTargetsProgress` → `weeklyClosedRows`):
  ```
  leads WHERE companyId=tenant
    AND assignedToId IS NOT NULL
    AND salespersonOutcome='Chiuso'
    AND salespersonOutcomeAt IN finestra
  ```
- Group by `assignedToId`, `COUNT(*)`.

**Composizione**:
- Lista utenti GDO attivi recuperata da `users` (role `GDO`, tenant corrente).
- Merge dei 3 result set sui `gdoId`. Utenti senza match in nessun bucket: tutto 0/null.
- `teamTotals`: somma di numeratori e denominatori, **poi** divisione (somma/somma, non media-di-medie).

### 3.3 Componente client

`KpiGdoBoard.tsx` esteso:
- Secondo `useEffect` che chiama `getGdoThroughputMetrics30d()` al mount (e quando cambia `gdoFilter`, ma non quando cambia `dateRange` — le 4 nuove colonne sono rolling 30gg fisso).
- Risultato salvato in `throughputData` state, merge per `gdoId` con le righe esistenti nel rendering.
- Stati separati: `throughputLoading`, `throughputError`. Mentre carica, le 4 nuove celle mostrano `…`.

## 4. Definizioni precise

### `avgCallsPerLead`
- Insieme `L`: lead dove `assignedToId = gdoId`, `companyId = tenant`, con almeno un `leadEvent` di tipo `APPOINTMENT_SET` o `DISCARDED` nella finestra (vedi §3.2 Query A), `isSelfBooked = false`.
- `avgCallsPerLead = SUM(L.callCount) / COUNT(L)`, arrotondato a 1 decimale.
- Se `COUNT(L) = 0` → `null`.

### `callsPerDay`
- `COUNT(callLogs)` per il GDO nella finestra.
- Diviso per `workingDaysBetween(start, end)` (helper esistente in `workingDaysUtils`).
- Arrotondato a 1 decimale.

### `dailyCapacity` — **Metrica primaria**
- `Math.round(callsPerDay / avgCallsPerLead)`.
- Se `avgCallsPerLead` è `null` o `0` → `null`.

### `closures`
- Come da Query C. Intero.

### Team totals
- `team.avgCallsPerLead = SUM(callCount tutti i lead chiusi del team) / SUM(lead chiusi del team)`.
- `team.callsPerDay = SUM(tutte le chiamate del team) / workingDays`.
- `team.dailyCapacity = team.callsPerDay / team.avgCallsPerLead`.
- `team.closures = SUM(closures per-GDO)`.
- `team.closedLeadsCount = SUM(closedLeadsCount per-GDO)`.

## 5. UI

### 5.1 Posizione colonne

Ordine nella tabella per-GDO:

```
GDO | Chiamate | Media call/Lead | Call/Giorno | Lead/Giorno (cap.) | Appuntamenti | %Conf | %Pres | Chiusi
```

`Lead/Giorno (cap.)` evidenziata con `bg-amber-50` + icona `TrendingUp` nell'header per segnalare che è la metrica chiave.

### 5.2 Header tooltip (`title` attribute)

- **Media call/Lead** — "Media chiamate fatte a ogni lead prima che venga fissato appuntamento o scartato. Rolling 30 giorni."
- **Call/Giorno** — "Media chiamate al giorno (giorni lavorativi). Rolling 30 giorni."
- **Lead/Giorno (cap.)** — "Capacità teorica: chiamate al giorno ÷ media chiamate per lead. Quanti lead questo GDO può portare in stato terminale al giorno. Rolling 30 giorni."
- **Chiusi** — "Chiusure attribuite al GDO che ha fissato l'appuntamento. Rolling 30 giorni."

### 5.3 Render celle

- `null` → `—` in `text-ash-300`.
- `Lead/Giorno (cap.)` colorato:
  - verde (`text-emerald-700 font-semibold`) se ≥ `teamTotals.dailyCapacity * 1.1`
  - rosso (`text-rose-600 font-semibold`) se ≤ `teamTotals.dailyCapacity * 0.7`
  - neutro altrimenti
  - se `teamTotals.dailyCapacity` è `null` (team senza lead chiusi nel periodo), tutte le celle sono neutre.
- Sotto `Lead/Giorno (cap.)`: `<div className="text-[10px] text-ash-400 mt-0.5">N lead chiusi</div>` con `N = closedLeadsCount`.

### 5.4 Ordinamento

- Nuova opzione `dailyCapacity` nel selettore `sortBy` (riga 49 di `KpiGdoBoard.tsx`).
- **Default cambiato** da `productivityCoeff` a `dailyCapacity`. `productivityCoeff` resta come opzione.

### 5.5 Riga team

Riga finale "Team" con `bg-ash-50`, mostra i 4 nuovi valori aggregati. Coerente con eventuale riga team già presente.

### 5.6 Banner finestra

Sopra la tabella, label `text-xs text-ash-500`:
> Le colonne in arancio (Media call/Lead, Call/Giorno, Lead/Giorno, Chiusi) sono calcolate su rolling 30 giorni, indipendenti dal filtro di periodo.

## 6. Edge cases & decisioni

| Caso | Decisione |
|---|---|
| Lead riassegnati nel tempo | Attribuzione al `leads.assignedToId` corrente. Coerente con la card aggregata esistente. |
| Lead vecchi (90+ gg) chiusi nella finestra | Inclusi. Il `callCount` alto riflette il costo reale di chiusura. Voluto. |
| Lead `isSelfBooked = true` | Esclusi (bypassano flusso GDO). |
| Eventi `APPOINTMENT_SET`/`DISCARDED` mancanti per lead vecchi | Usato `leadEvents` come unica sorgente (semplicità). Lead pre-instrumentazione con stato terminale ma senza evento nella finestra non entrano nel calcolo. Accettabile: la finestra è rolling 30gg, gli eventi sono tracciati stabilmente dall'inizio del 2026. |
| `workingDaysBetween = 0` | `callsPerDay = 0`. |
| `avgCallsPerLead = 0` (impossibile se denominatore non zero) | Trattato come `null`. |
| GDO senza chiamate ma con lead chiusi (residui) | `callsPerDay = 0` → `dailyCapacity = 0`. |
| GDO nuovo, sample piccolo | Visualizzato; sotto-cella `N lead chiusi` permette al manager di valutare l'affidabilità. |
| Multi-tenancy | Tutte le query filtrano `companyId = currentTenant()`. `assertSalesArea()` blocca utenti marketing. |

## 7. Performance

3 query GROUP BY + 1 lookup utenti.

Indici utili:
- `callLogs (userId, createdAt)` — esistente (`calllogs_user_created_at_idx`).
- `leads (assignedToId, status)` — esistente (`assigned_status_idx`).
- `leadEvents (timestamp)` — da verificare; in caso aggiungo indice in migrazione `0009_lead_events_timestamp_idx.sql`.

Atteso: < 200ms con scala attuale (decine di GDO, ~10k lead/mese).

Niente cache server-side in v1. `KpiGdoBoard` già refetch su filter change; il nuovo fetch è indipendente e parte solo una volta al mount.

## 8. Test

### 8.1 Type safety & lint (automatici, già nel progetto)

Il progetto **non ha un framework di test unit/integration installato** (no jest/vitest in `package.json`). I check automatici disponibili sono:
- `npm run lint` — ESLint deve passare clean.
- `npm run build` — TypeScript + Next.js build deve passare clean.

Setup di un framework di test non è in scope (sarebbe un'iniziativa cross-progetto separata).

### 8.2 Sanity helper script (one-shot)

Per validare la logica della nuova action senza framework, creo `scripts/debug/verify-throughput-30d.ts` che:
- Carica `.env`, chiama `getGdoThroughputMetrics30d()` direttamente.
- Stampa la tabella per-GDO + team totals in console.
- Aggiunge **inline assertions** sui casi edge: avgCallsPerLead null quando 0 lead chiusi, dailyCapacity null se denom 0, team somma/somma coerente.
- Eseguibile con `npx tsx scripts/debug/verify-throughput-30d.ts` (`tsx` già in devDependencies).
- Non è un test framework, è uno script diagnostico ad-hoc — pattern già usato altrove in `scripts/debug/`.

### 8.3 Verifica UI manuale

- `/kpi-gdo` come manager: 4 colonne nuove nell'ordine corretto.
- `Lead/Giorno (cap.)` è sort default.
- Tooltip header al hover.
- Riga team in fondo con somme corrette.
- Tabella responsive (scroll orizzontale, non rotture).
- Cambiare selettore periodo Oggi/7gg/Mese **non** modifica le 4 colonne nuove (banner visibile).

### 8.4 Smoke check produzione

Post-deploy: confronto manuale dei valori di 2-3 GDO noti con i loro `lastCallNote` recenti per sanity check. Anomalie (media < 1.5 o > 15) → indagare prima di chiudere il task.

## 9. Out of scope future iterations

- Storico settimanale/mensile del `dailyCapacity` (grafico).
- Confronto vs target dichiarato di `dailyApptTarget` nello `users`.
- Filtro funnel/prodotto sulla metrica throughput.
- Drill-down su click di riga GDO → dettaglio dei lead chiusi e relative chiamate.
