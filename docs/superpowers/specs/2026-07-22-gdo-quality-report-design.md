# Report Qualità GDO — bottone su /manager-gdo-performance

Data: 2026-07-22 · Stato: approvato da Bruno (brainstorm in sessione)

## Scopo
Dare a Noemi (TL) e ai manager un report settimanale per-GDO dei KPI di qualità usati nel
piano coaching del GDO 110, estraibile in 1 click dalla pagina Performance GDO, consultabile
a schermo e scaricabile in PDF. Nessun hardcode sul GDO 110: il bottone è su tutte le card.

## Decisioni (dal brainstorm)
- **Scope**: bottone "Report qualità" su **tutte** le card GDO di `/manager-gdo-performance`.
- **Output**: modale nel CRM + bottone "Scarica PDF" via stampa browser (print CSS). Nessuna libreria PDF.
- **Periodo**: righe settimanali (lun-dom, Europe/Rome) **dal 20/07/2026** (inizio piano coaching),
  più riga "Baseline pre-piano" (01/06 → 19/07). Le settimane si estendono automaticamente col tempo.
- **Accesso**: eredita i permessi pagina (ADMIN/MANAGER/TL). Noemi = account TL → ok senza modifiche auth.
- **Target del piano (12%/15%)**: restano nel Google Doc, NON nel CRM (niente checkpoint in-app per ora).

## KPI per riga (semantica identica al dossier coaching)
| Colonna | Definizione |
|---|---|
| Lead lavorati | lead con `lastCallDate` nella finestra e `callCount > 0`, `assignedToId` = GDO |
| Fissati (% su lavorati) | `appointmentDate IS NOT NULL` e `COALESCE(appointmentCreatedAt, appointmentDate)` nella finestra |
| Confermati (% su fissati) | dei fissati della finestra (coorte), `confirmationsOutcome = 'confermato'` |
| Scartati 3NR (%) | dei fissati della finestra, `confirmationsOutcome = 'scartato'` e `confirmationsDiscardReason ILIKE '%nr%'` |
| Media tentativi | media `callCount` dei lead lavorati della finestra |
| Scarti alla 1ª chiamata (%) | dei lavorati, `status = 'REJECTED'` e `callCount = 1` |

Sotto le righe del GDO: sezione **"Media team"** con le stesse righe aggregate su tutti i GDO
`isActive && statsActive && !isBot` della company (bot escluso come da canone).

## Architettura
- **Server action** `src/app/actions/gdoCoachingReportActions.ts` → `getGdoQualityReport(gdoUserId)`:
  - Guard: `currentTenant()` + `assertSalesArea` + ruolo in {ADMIN, MANAGER, TL}; il GDO deve
    appartenere alla company del ctx (cross-tenant negato).
  - 2 query Drizzle (lead lavorati + lead fissati, dal 01/06 a oggi, per tutti i GDO attivi della
    company) → bucketing settimanale in JS con i bounds Rome di `src/lib/dateUtils.ts`.
    Costante `PLAN_START = 2026-07-20` locale al file.
  - Ritorna `{ success, gdoName, rows: WeekRow[], teamRows: WeekRow[] }` con la baseline come
    prima riga (label "Baseline (giu → 19/07)").
- **Client** `src/app/(dashboard)/manager-gdo-performance/GdoQualityReportModal.tsx`:
  - Props `{ gdoId, gdoName, onClose }`; fetch della action al mount, spinner, tabella, bottone
    "Scarica PDF" → `window.print()`.
  - Area stampabile marcata `gdo-report-print-area`; in `globals.css` regola `@media print` che
    nasconde il resto e stampa solo l'area (pattern visibility).
- **Wiring**: bottone "Report qualità" (icona FileText) nell'header di ogni card in
  `ManagerGdoClient.tsx` (usa `gdoData.gdoId`/`gdoName` già presenti). Bottone dentro `<div>`,
  mai child di tag testuali (regola hydration CLAUDE.md).

## Error handling
- Action: try/catch → `{ success: false, error }`; modale mostra messaggio e bottone chiudi.
- GDO senza dati nel periodo: righe a 0, percentuali "-" (denominatore 0 → null).

## Test/verifica
- `tsc --noEmit` pulito; verifica visiva in dev (modale + stampa) su un GDO con dati (110) e uno scarico.
- Confronto numeri modale vs query SQL del dossier per la settimana 20-26/07 (GDO 110).
