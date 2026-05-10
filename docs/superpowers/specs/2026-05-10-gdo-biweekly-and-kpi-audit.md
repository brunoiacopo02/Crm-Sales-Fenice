# GDO bisettimanale + audit KPI individuali

**Data**: 2026-05-10
**Branch**: `feat/gdo-biweekly-and-kpi-audit`

## Obiettivo

1. Correggere imprecisioni nei KPI mostrati al singolo GDO su `/kpi-gdo` ("Le mie Performance").
2. Convertire il target "Presenze" da settimanale a bisettimanale per i soli GDO.
3. Aggiungere a `/kpi-gdo` un widget ciclo corrente + tabella storico cicli con bonus maturato.

## Parte A — Audit fix KPI

| # | File / funzione | Problema | Fix |
|---|---|---|---|
| 1 | `kpiAdvancedActions.getGdoTargetsProgress` | `setHours(0,0,0,0)` in TZ server (UTC su Vercel) → sfasamento ~2h | Usa `dayBoundsRome` / `weekBoundsRome` (`gte` + `lt`) |
| 2 | `kpiAdvancedActions.getGdoTargetsProgress` "Appuntamenti Oggi" | Conta righe `callLogs` senza dedup per lead | Set di leadId distinti |
| 3 | `kpiAdvancedActions.getAdvancedKpi.gdoStats` | `appointments` non deduplicato per lead → distorce % Fissaggio / % Conferme / % Presenziati | `appointments = apptLeadIds.size` |
| 4 | `kpiAdvancedActions.getGdoTargetsProgress` "Conferme settimana" | Tooltip non spiega filtro per `confirmationsTimestamp` | Label/tooltip espliciti |
| 5 | `gdoPerformanceActions.getCurrentGdoGamificationState` | Widget azzerato quando la settimana attraversa il bordo mese | Ciclo bisettimanale (Parte B) elimina il bug a monte |
| 6 | `manualAdjustments` solo nel widget bonus | Numeri divergenti tra widget e ranking | Helper `countPresences` unificato; KPI ranking riceve riga "aggiust. manuali" |
| 7 | `gdoPerformanceActions.getGdoLeadOutcomeMetrics` | Filtra per `appointmentDate` (app schedulati nel range) anziché esiti maturati | Param `mode: 'scheduled' \| 'outcome'`, default 'outcome' |

## Parte B — Ciclo bisettimanale per Presenze GDO

### Ciclo
- **Ancora**: lun **4 maggio 2026** 00:00 Europe/Rome.
- Durata 14 giorni. Cicli successivi: 18-31 mag, 1-14 giu, 15-28 giu, …
- Utility: `getBiweeklyCycle(date)` → `{ index, start, end, label }`.

### Conteggio "presenze del ciclo"
- Lead `assignedToId = userId`
- `salespersonOutcome IN ('Chiuso','Non chiuso')`
- `salespersonOutcomeAt` ∈ `[start, end)`
- + somma `manualAdjustments` (`type='presenze'`, `createdAt` nel range)

### Target/bonus (default GDO)
- Tier1: **18 presenze** → **€270**
- Tier2: **22 presenze** → **€540**
- Manager modifica mese per mese via `/manager-targets` (riusa `weeklyGamificationRules`; il manager sovrascrive i default per mese se vuole).
- **Conferme: invariati** (settimanale, override 18/145 e 21/290).

### Refactor `getCurrentGdoGamificationState`
- Branch GDO usa ciclo bisettimanale + `countPresences` + `salespersonOutcomeAt`.
- Branch CONFERME invariato.

### UI
- `WeeklyBonusWidget`: titolo "Tracker Bisettimanale" per GDO, target 18/22, reward 270/540.
- Nuova action `getBiweeklyHistory(userId, lookback=8)`: ritorna ultimi N cicli chiusi.
- Nuovo componente `BiweeklyHistoryTable` su `/kpi-gdo` sotto i widget Target, con colonne Ciclo / Presenze / Tier1 / Tier2 / Bonus maturato.
- Manager: per il GDO selezionato dal dropdown già esistente di `/kpi-gdo` vede lo stesso storico.

## Definition of Done
- `npm run build` passa.
- Smoke test mentale: oggi 10-mag (ciclo 4-17 mag) → widget mostra "Ciclo 4-17 mag", target 18/22.
- Storico mostra cicli chiusi precedenti (vuoto se nessuno ancora chiuso).
- Nessuna modifica al DB schema.
