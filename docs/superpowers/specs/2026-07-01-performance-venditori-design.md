# Performance Venditori & Ciclo Follow-up — Design Spec

**Data:** 2026-07-01
**Autore:** Claude (agente esecutivo CRM Fenice)
**Stato:** approvato in brainstorming, pronto per piano di implementazione

## 1. Obiettivo

Dare a ogni **venditore** e al **sales manager** una sezione dedicata all'analisi
della performance di vendita, e trasformare i follow-up da promemoria passivi a un
**ciclo tracciato** che permetta di misurare quanti follow-up portano a chiusura.

In particolare:

1. **Analytics performance** (visibile sia al venditore sui propri dati, sia al sales
   manager filtrando per venditore): distribuzione dei motivi di non chiusura, motivo
   più frequente con la sua percentuale, quanti lead vanno a follow-up, tasso di
   chiusura dei follow-up, closing rate/fatturato, tentativi medi prima di chiudere,
   follow-up scaduti/non lavorati, trend mensile.
2. **Follow-up obbligatorio**: dopo un esito "Non chiuso" il venditore è obbligato a
   impostare un follow-up (guardia lato server, non solo UI).
3. **Ciclo di vita completo**: ogni tentativo/esito sul lead è tracciato come record a
   sé, così "quanti follow-up chiudono" è misurabile con precisione.
4. **Focus della settimana (coaching loop)**: il sales manager assegna a ciascun
   venditore un'obiezione da lavorare + una task; il venditore la vede in cima alla
   propria dashboard.

## 2. Contesto codice esistente (fonte di verità)

- **Dashboard venditore**: `src/components/VenditoreDashboardClient.tsx` — viste
  `LISTA | AGENDA | CLASSIFICA`. La Classifica renderizza già `KpiVenditoriClient`.
- **Esito venditore**: `saveVenditoreOutcome(leadId, payload, currentVersion?)` in
  `src/app/actions/venditoreActions.ts:64-196`. Locking ottimistico via `leads.version`.
  Guardia check-in (`negotiationStartedAt`) e guardia sondaggio 3-blocchi
  (`salesLeadSurveys`) per funnel ≠ `database`. MANAGER/ADMIN esenti.
- **Motivi di non chiusura**: array locale `NOT_CLOSED_REASONS` in
  `src/components/VenditoreDrawer.tsx:22-31` (8 valori, testo libero salvato in
  `leads.notClosedReason`). Da centralizzare in `src/lib/surveys/questions.ts`.
- **Follow-up oggi**: solo `leads.followUp1Date` / `leads.followUp2Date`
  (`src/db/schema.ts:176-177`), facoltativi, nessun collegamento all'esito successivo,
  nessun evento. Monitor manager passivo: `src/app/actions/venditoriMonitorActions.ts`
  + `src/app/(dashboard)/monitor-vendite/`.
- **Pattern analytics di riferimento**:
  - `getVenditoriKpi` (`src/app/actions/kpiVenditoriActions.ts`) — già supporta range
    date custom, aggrega per venditore da `leads` con `salespersonOutcomeAt`.
  - `/conferme/analytics` (`page.tsx` + `confermeAnalyticsActions.ts`) — pattern
    "searchParams → server action con range/filtro → grid di card".
  - Selettore mese Sales Manager (`PanoramicaClient.tsx`, live 2026-07-01) — pattern per
    dropdown ultimi 12 mesi e vista storica read-only.
- **Tenancy/date helper**: `src/lib/tenancy.ts` (`currentTenant`, `companyScope`,
  `assertSalesArea`), `src/lib/dateUtils.ts` (`monthBoundsRome` ecc.),
  `src/lib/workingDaysUtils.ts` (`currentYearMonthRome`).
- **Eventi**: `leadEvents` (`src/db/schema.ts:215-233`), eventType venditore attuali
  `negotiation_started`, `salesperson_outcome_set`.

## 3. Modello dati (nuovo)

### 3.1 `salesAttempts` — un record per ogni esito/tentativo

Colonne:

- `id` (pk)
- `leadId` → `leads.id` (indicizzato)
- `salesUserId` → `users.id`
- `companyId` (multi-tenant, come le altre tabelle)
- `attemptNumber` int — `0` = esito post-appuntamento, `1..3` = follow-up successivi
- `outcome` text — `Chiuso` | `Non chiuso` | `Perso` | `Sparito`
- `notClosedReason` text nullable — uno degli 8 motivi (solo se `Non chiuso`/`Perso`)
- `nextFollowUpDate` timestamp nullable — valorizzato solo se `outcome = Non chiuso`
- `closeProduct` text nullable, `closeAmountEur` real nullable — solo se `Chiuso`
- `createdAt` timestamp default now

Indici: `(leadId)`, `(salesUserId, createdAt)`, `(companyId, createdAt)`.

Le colonne `leads.salespersonOutcome*`, `closeProduct`, `closeAmountEur`,
`notClosedReason`, `followUp1Date/2Date` restano come **stato corrente denormalizzato**
per KPI/board/monitor esistenti; `salesAttempts` è la **storia** su cui gira l'analytics
del nuovo modulo.

### 3.2 `salesWeeklyFocus` — focus di coaching settimanale

- `id` (pk)
- `salesUserId` → `users.id`
- `companyId`
- `weekStart` date — lunedì della settimana (TZ Roma)
- `objection` text nullable — uno degli 8 motivi
- `taskNote` text — nota/task libera
- `createdBy` → `users.id` (il manager)
- `createdAt`, `updatedAt`

Vincolo di unicità su `(salesUserId, weekStart)` (upsert). Storico conservato.

### 3.3 Motivi centralizzati

Spostare gli 8 valori di `NOT_CLOSED_REASONS` in `src/lib/surveys/questions.ts` come
`as const` con eventuale union type esportato, e importarli in `VenditoreDrawer.tsx`,
nell'analytics e nell'editor focus. Valori invariati:

```
Non ha soldi | Deve parlare con terzi | Valuta altri percorsi | Non ha urgenza reale |
Non vuole decidere in call | Troppo spaventato | Fa già altri corsi |
Event imminente che lo blocca
```

### 3.4 Nuovo esito `Perso`

Aggiunto come valore d'esito venditore (via d'uscita definitiva senza follow-up).
Da gestire in `getVenditoriKpi` e `OutcomeGate` come esito "perso": conta negli esitati
totali, non nel fatturato, non richiede follow-up.

## 4. Ciclo di vita & follow-up obbligatorio

Estensione di `saveVenditoreOutcome`:

1. Ad ogni chiamata **inserisce una riga in `salesAttempts`** con `attemptNumber`
   calcolato (conteggio attempt precedenti sul lead) oltre ad aggiornare `leads` come ora.
2. **`Non chiuso` → follow-up obbligatorio**: se `nextFollowUpDate` manca, l'azione
   ritorna errore (guardia server) e l'UI non consente il salvataggio.
3. **Tetto a 3 follow-up**: se il lead è già al 3° follow-up (`attemptNumber` corrente
   = 3), UI e server permettono solo `Chiuso` o `Perso`; `Non chiuso` è rifiutato.
4. `Perso` e `Sparito` chiudono il ciclo (nessun follow-up).
5. Ogni tentativo logga `leadEvents` (`salesperson_outcome_set`, con `attemptNumber` nel
   metadata) per la timeline.
6. MANAGER/ADMIN restano esenti dalle guardie preesistenti (check-in, sondaggio); la
   guardia follow-up-obbligatorio e il tetto valgono per il ruolo VENDITORE.

`VenditoreDrawer.tsx`: il ramo "Non chiuso" rende obbligatorio il campo follow-up e,
quando il tetto è raggiunto, nasconde "Non chiuso" mostrando solo `Chiuso`/`Perso`.

## 5. Dashboard Venditore

`VenditoreDashboardClient.tsx`:

- **Nuova tab "Follow-up"**: elenca i follow-up dovuti in gruppi **Scaduti / Oggi /
  Prossimi**. Ogni riga apre lo stesso `VenditoreDrawer` per registrare il nuovo esito.
  Badge rosso con conteggio scaduti sul toggle della tab. Fonte dati: nuova action
  `getVenditoreFollowUps(sellerId)` che legge i lead con `nextFollowUpDate` aperto
  (l'ultimo `salesAttempts` con `outcome = Non chiuso` e nessun attempt successivo).
- **Nuova tab "Performance"**: renderizza il componente analytics condiviso (§7) sui
  dati del venditore stesso, con selettore mese (pattern selettore mese esistente).
- **Banner "Focus della settimana"** in cima alla dashboard: obiezione + task assegnati
  dal manager per la settimana corrente (read-only per il venditore). Se assente, banner
  nascosto o placeholder neutro.

## 6. Vista Sales Manager

Nuova pagina **`/performance-venditori`** (guardia: ADMIN, più TL Conferme in read-only
come per le altre viste sales — riuso `requireSalesOverviewRead`/analogo):

- **Selettore venditore** + **selettore mese**.
- Renderizza lo **stesso** componente analytics della tab Performance venditore, sui
  dati del venditore selezionato.
- **Editor "Focus della settimana"**: campo obiezione (select dagli 8 motivi,
  pre-selezionata quella più frequente del venditore nel periodo) + task libera; salva
  in `salesWeeklyFocus` via action `setSalesWeeklyFocus(...)`. Storico settimane
  visibile in sola lettura. Per TL read-only: editor disabilitato.

## 7. Analytics: server action & metriche

Nuova action `getVenditorePerformance({ salesUserId, yearMonth })` → oggetto tipizzato:

- **Motivi di non chiusura**: distribuzione (conteggio + %) su `salesAttempts` con
  `outcome ∈ {Non chiuso, Perso}` nel periodo; motivo top con la sua %.
- **Funnel follow-up**:
  - `leadEnteredFollowUp` = n° lead con almeno un attempt `Non chiuso` nel periodo.
  - `followUpClosed` = n° di quei lead il cui esito finale è `Chiuso`.
  - `followUpConversionRate` = `followUpClosed / leadEnteredFollowUp`.
- **Closing rate & fatturato**: chiusi/esitati totali, fatturato (Σ `closeAmountEur`),
  ticket medio, prodotto più venduto (logica allineata a `getVenditoriKpi`, sorgente
  `salesAttempts` o `leads` esiti finali — coerente col periodo).
- **Tentativi medi prima di chiudere**: media `attemptNumber+1` dei lead chiusi; % chiusi
  al 1° colpo (`attemptNumber = 0`) vs dopo follow-up.
- **Follow-up scaduti / non lavorati**: n° follow-up con `nextFollowUpDate < oggi` ancora
  aperti (nessun attempt successivo).
- **Trend mensile**: ultimi ~6 mesi di closing rate e follow-up conversion rate.

Filtri company via `companyScope`, bounds TZ Roma via `monthBoundsRome`. Reso come grid
di card + barra distribuzione motivi, stile `/conferme/analytics`.

Actions di supporto:

- `getVenditoreFollowUps(sellerId)` — lista follow-up dovuti (tab Follow-up).
- `getSalesWeeklyFocus(salesUserId, weekStart)` — focus corrente (banner venditore +
  editor manager).
- `setSalesWeeklyFocus({ salesUserId, weekStart, objection, taskNote })` — upsert
  (manager/admin), scrive `createdBy`.

## 8. Componenti condivisi

- `src/components/venditore-performance/VenditorePerformanceView.tsx` — componente
  analytics condiviso tra tab Performance venditore e pagina manager; riceve i dati (o
  `salesUserId` + periodo) via prop e non conosce il ruolo.
- Card in `src/components/venditore-performance/` (distribuzione motivi, funnel
  follow-up, KPI chiusura, trend), sullo stile di `src/components/conferme-analytics/`.

## 9. Test

- **Unit aggregazioni** (dataset fixture su `salesAttempts`): distribuzione motivi + %
  top, `followUpConversionRate`, tentativi medi, follow-up scaduti.
- **Guardie `saveVenditoreOutcome`**: `Non chiuso` senza `nextFollowUpDate` → errore; 4°
  tentativo con `Non chiuso` → rifiutato; inserimento corretto riga `salesAttempts` con
  `attemptNumber` progressivo.
- **Focus**: upsert `setSalesWeeklyFocus` idempotente su `(salesUserId, weekStart)`;
  permessi (venditore non può scrivere il proprio focus).
- **Build/lint**: TSC pulito, nessun nuovo problema lint oltre la baseline.

## 10. Fuori scope (YAGNI)

- Sincronizzazione dei follow-up con Google Calendar (oltre a quanto già esiste).
- Notifiche push dedicate ai follow-up dovuti (riuso eventuale del sistema notifiche
  esistente in fase successiva, non ora).
- Gamification su follow-up/performance (valutabile in seguito).
- Migrazione retroattiva dei follow-up storici (`followUp1Date/2Date`) in
  `salesAttempts`: l'analytics parte dai nuovi dati; eventuale backfill in fase separata.
