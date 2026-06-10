# Design — Modalità "Tutte le aziende" (KPI aggregati admin)

**Data:** 2026-06-10
**Autore:** Claude (CRM Fenice)
**Stato:** Approvato (Bruno) — pronto per il piano implementativo

## Obiettivo

L'admin del gruppo deve poter vedere i KPI di **Fenice + Serenamente (e future aziende)
sommati**, come se fossero un'unica azienda, scegliendo una terza voce **"Tutte le
aziende"** nello switcher azienda in topbar (oltre alle due aziende reali).

Quando "Tutte le aziende" è attiva:
- le dashboard **KPI/reporting** mostrano i numeri aggregati su tutte le aziende
  consentite all'utente;
- le pagine **operative** (lavorazione lead) sono bloccate con un avviso, perché non si
  può lavorare un lead su un gruppo fittizio.

## Vincoli e contesto

- Multi-tenancy già esistente: `src/lib/tenancy.ts` → `currentTenant()` ritorna una
  singola `companyId` (cookie `sales_active_company`, validato vs `allowedCompanies`).
- Ogni query KPI filtra `eq(<table>.companyId, ctx.companyId)`.
- Solo gli account abilitati a più aziende (oggi: admin + gdo114 su Serenamente) hanno
  `allowedCompanies.length > 1`.
- Nessuna migration DB.

## Perimetro (deciso con Bruno)

Aggregano in all-mode questi 5 file action (sola lettura):

| Superficie | Pagina | Action file |
|---|---|---|
| Sales Manager / Panoramica | `panoramica-generale` | `panoramicaActions.ts` |
| KPI GDO | `kpi-gdo` (+ `kpi-team` redirect) | `kpiAdvancedActions.ts` |
| KPI Conferme | `kpi-conferme` | `confermeKpiActions.ts` |
| KPI Venditori | `kpi-venditori` | `kpiVenditoriActions.ts` |
| Conferme Analytics | `conferme/analytics` | `confermeAnalyticsActions.ts` |

## Architettura

### 1. Sentinella in `tenancy.ts` (mai nel DB)

- `export const ALL_COMPANIES = '__all__'` — valore valido **solo** nel cookie.
- `TenantContext` guadagna `isAllCompanies: boolean`.
- In `currentTenant()`: `isAllCompanies = true` **solo se**
  `cookie === ALL_COMPANIES && role === 'ADMIN' && allowedCompanies.length > 1`.
  Negli altri casi resta `false` e si applica la risoluzione normale.
- **Sicurezza chiave:** anche in all-mode, `ctx.companyId` resta un'azienda **reale**
  (il fallback). Il sentinella non raggiunge mai una query DB diretta; un'eventuale
  scrittura accidentale finisce su un'azienda vera, mai su un gruppo orfano.
- Nuovo helper:
  ```ts
  export function companyScope(ctx: TenantContext, col: AnyPgColumn) {
    return ctx.isAllCompanies
      ? inArray(col, ctx.allowedCompanies)
      : eq(col, ctx.companyId);
  }
  ```
  Funziona su qualsiasi colonna `companyId` (`leads`, `callLogs`, `users`,
  `leadEvents`, `monthlyTargets`, ...).
- Nuova guardia `assertSingleCompany(ctx)`: lancia se `isAllCompanies` (usata dalle
  action di scrittura e dal blocco pagine operative).

### 2. Switcher + API

- `GET /api/company/selection`: per admin con >1 aziende, aggiunge in coda la voce
  sintetica `{ id: '__all__', display_name: 'Tutte le aziende' }` e un flag
  `canSelectAll`. `active` riflette `ALL_COMPANIES` quando attivo.
- `POST /api/company/select`: accetta `__all__` **solo** se admin && >1 allowed
  (altrimenti 403). Il valore consentito è `ctx.allowedCompanies` ∪ `{ALL_COMPANIES}`
  per gli admin idonei.
- `SalesCompanySwitcher.tsx`: voce "Tutte le aziende" con icona `Layers` e separatore
  sopra; badge topbar mostra "Tutte le aziende" quando attiva.

### 3. Aggregazione KPI

- **File semplici** (`kpiAdvancedActions`, `confermeKpiActions`, `kpiVenditoriActions`,
  funzioni di lettura di `confermeAnalyticsActions`): sostituire ogni
  `eq(<table>.companyId, ctx.companyId)` con `companyScope(ctx, <table>.companyId)`.
  Sono pure aggregazioni → la somma su più aziende è corretta per costruzione.
- **`panoramicaActions`** (stato baseline/delta per azienda): NON swap inline. Le 3
  funzioni di lettura (`getLeadOverview`, `getFunnelOverview`, `getMetricsOverview`)
  vengono incapsulate: in all-mode **iterano** su `ctx.allowedCompanies`, calcolano il
  risultato per ciascuna azienda con la logica single-company esistente e **sommano** i
  numeri finali (righe funnel unite per `funnelName`, totali sommati, percentuali
  ricalcolate sui totali aggregati). Questo preserva la semantica `baselineSetAt`
  per-azienda.
- **Scritture panoramica** (`setLeadMonthlyTarget`, `setFunnelRow`,
  `setMonthlyMetricTargets`): `assertSingleCompany(ctx)` in testa → in all-mode i modali
  target sono read-only con avviso "Configura i target su una singola azienda".
- **Scritture in `confermeAnalyticsActions`** (salvataggio esiti/insert): idem
  `assertSingleCompany(ctx)`.

### 4. Blocco pagine operative

- Allowlist route reporting: `panoramica-generale`, `kpi-gdo`, `kpi-conferme`,
  `kpi-venditori`, `kpi-team`, `conferme/analytics` (+ eventuali pagine di sola lettura
  innocue come `profilo`, `classifica` se opportuno — default: blocca tutto ciò che non
  è nell'allowlist).
- Nel `layout.tsx` della dashboard: se `tctx.isAllCompanies` e la route corrente non è
  nell'allowlist → renderizza un pannello d'avviso al posto di `children`
  ("📊 Modalità Tutte le aziende — seleziona una singola azienda per lavorare i lead",
  con CTA che riapre lo switcher / torna alla panoramica).
- `data-company` nel layout resta neutro (`'fenice'`) in all-mode, così il tema
  Serenamente non si applica alla vista di gruppo.

## Sicurezza

- Sentinella mai in query DB; `companyId` sempre reale.
- Attivabile solo da admin con ≥2 aziende, validato anche lato server nel POST.
- Le scritture sono esplicitamente bloccate in all-mode.

## Non-goal (YAGNI)

- Nessuna aggregazione per le pagine operative o di gamification.
- Nessun confronto affiancato per-azienda (solo somma unica).
- Nessuna persistenza di target a livello gruppo (i target restano per-azienda).

## Impatto

- Mono-azienda (Fenice) e utenti senza multi-company: zero impatto, nessuna voce nuova.
- Nessuna migration. Cambi confinati a `tenancy.ts`, 2 route API, `SalesCompanySwitcher`,
  `layout.tsx`, 5 file action KPI.
