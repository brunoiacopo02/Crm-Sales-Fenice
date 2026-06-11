# Sales Alerts — Striscia "Stato Alert" su Sales Manager

**Data:** 2026-06-11 · **Stato:** approvato da Bruno (chat) · **Pagina:** `/panoramica-generale`

## Obiettivo

Replicare sulla schermata Sales Manager il pattern alert del CRM marketing
(`/api/marketing/alerts` + striscia "STATO ALERT — MESE CORRENTE"): card per metrica
con scostamento % vs target proporzionale MTD, giorni consecutivi sotto soglia e
badge ALERT / PRE-ALERT / OK.

## Metriche e regole (decise da Bruno)

Regola uniforme: scostamento cumulativo MTD vs target proporzionale; sotto soglia per
**≥ 7 giorni consecutivi** → **ALERT** (rosso); sotto soglia oggi ma streak < 7 →
**PRE-ALERT** (giallo); altrimenti **OK** (verde). Target assente/zero → card neutra
"no target", mai falso alert.

| # | Card | Actual giornaliero | Target mensile | Soglia |
|---|------|--------------------|----------------|--------|
| 1 | Valore Contratti | SUM `leads.closeAmountEur` per giorno di `salespersonOutcomeAt` (solo `salespersonOutcome='Chiuso'`) + `fatturatoExtraEur` | `monthlyLeadTargets.targetFatturatoMonthly` | -20% |
| 2 | App Fissati | conteggio lead con `appointmentDate` per giorno di `appointmentCreatedAt \|\| appointmentDate` + `appExtra` | `monthlyLeadTargets.targetAppMonthly` | -20% |
| 3 | Trattative | presenziati: `salespersonOutcome IN ('Chiuso','Non chiuso')` per giorno di `salespersonOutcomeAt` + `trattativeExtra` | `monthlyLeadTargets.targetPresMonthly` | -20% |
| 4 | Chiusure | `salespersonOutcome='Chiuso'` per giorno di `salespersonOutcomeAt` + `closeExtra` | `monthlyLeadTargets.targetCloseMonthly` | -20% |
| 5 | ROAS | fatturato cumulato (card 1) ÷ spesa cumulata (`metaAccountDaily.spend`, account dei funnel company) | `marketingTargets.roasTarget` (riuso del target marketing, id=1 per company) | -15% |
| 6 | Media App/gg/GDO | app MTD ÷ giorni lavorativi trascorsi ÷ # GDO attivi | `targetAppMonthly` ÷ giorni lavorativi del mese ÷ # GDO attivi | -20% |
| 7 | Media Chiusure/gg/GDO | chiusure MTD ÷ giorni lavorativi trascorsi ÷ # GDO attivi | `targetCloseMonthly` ÷ giorni lavorativi del mese ÷ # GDO attivi | -20% |

**Correzione post-QA (2026-06-11):** la fonte target è **`monthlyLeadTargets`**
(yearMonth, companyId) — la stessa tabella dei target "Numeri Mensili" della panoramica —
NON `monthlyTargets` (tabella di /manager-targets, ferma ad aprile 2026). Il target
proporzionale delle card 1-4 usa i **giorni lavorativi** (`monthlyLeadTargets.workingDays`,
fallback `countWorkingDaysInMonth`), identico al "Target Prev" di Numeri Mensili: daily =
monthly/workingDays, prev = daily × giorni lavorativi trascorsi. Gli offset manuali `*Extra`
sono sommati agli ACT (come in `getMetricsOverview`) così le card tornano con la tabella.

Note:
- Le definizioni 1-4 sono identiche a quelle di `panoramicaActions.ts` (stesse colonne/whitelist),
  così i numeri delle card tornano con quelli già mostrati in pagina.
- Card 6-7: giorni **lavorativi** (lun-ven, rispettando `monthlyTargets.workingDaysOverride`
  come totale mese se impostato), non calendario. "# GDO attivi" = utenti `role='GDO'`,
  attivi, della company. Streak calcolata sulla serie della *media* giornaliera cumulata.
- Card 5: deviazione = `(roas - roasTarget) / roasTarget` (il target non è proporzionale:
  il ROAS è già un rapporto). Identico al route marketing.
- "Più di 7 gg" implementato come streak ≥ 7, coerente con la legenda del CRM marketing
  ("≥ 7gg = ALERT").

## Architettura

**Nessuna migration, nessuna env nuova.** Serie storiche ricostruite al volo dal DB.

1. **`src/app/actions/salesAlertsActions.ts`** (nuova server action)
   - `getSalesAlerts(): Promise<SalesAlertsResult>` — `currentTenant()` + `assertSalesArea`.
   - Mese corrente con confini UTC (come panoramicaActions); bucket giornalieri ISO.
   - Costruisce per ogni metrica la serie `DayPoint { date, actual, proportionalTarget,
     deviation, belowThreshold }`, poi `trailingStreak` + `classify` (porting 1:1 delle
     funzioni del route marketing).
   - **Multiazienda:** se `ctx.isAllCompanies`, calcola per ogni company di
     `ctx.allowedCompanies` con il pattern `singleCompanyCtx` (come panoramicaActions)
     e ritorna `groups: [{ companyId, companyLabel, cards }]` — nessun merge, i target
     sono per-azienda. In modalità singola: un solo group.

2. **`src/app/(dashboard)/panoramica-generale/SalesAlertStrip.tsx`** (client)
   - Striscia in cima alla pagina: header "STATO ALERT — MESE CORRENTE" + legenda soglie.
   - Card: label, `scost. -X% · Ngg`, badge colorato (rosso ALERT / giallo PRE-ALERT /
     verde OK / grigio NO TARGET). `title` tooltip con actual vs target proporzionale odierno.
   - Carica via `getSalesAlerts()` in `useEffect`; refresh su evento `realtime_update`
     (stesso pattern di `SalesManagerSections`).
   - In all-mode: una riga di card per azienda, con etichetta company.

3. **Wiring:** render di `<SalesAlertStrip />` in `page.tsx` di panoramica-generale,
   sopra `PanoramicaClient`. Visibile a chi vede la pagina (manager/admin).

## Error handling

- Action fallita → striscia mostra messaggio compatto con retry, non rompe la pagina.
- `marketingTargets` row assente (es. Serenamente) → card ROAS "no target".
- 0 GDO attivi o 0 giorni lavorativi trascorsi → card medie "no target"/'—' (no div/0).

## Test/verifica

- `npx tsc --noEmit` pulito; lint sui file nuovi senza errori nuovi.
- Verifica visiva in prod (admin): Fenice con target popolati → card con scostamenti
  reali; Serenamente senza target → card neutre; all-mode → due righe etichettate.
