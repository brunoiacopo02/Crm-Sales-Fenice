# Sales Manager — Selettore mese Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un selettore mese su `/panoramica-generale` che ricarica le tabelle *Caricamento Lead* e *Numeri Mensili* su qualunque mese degli ultimi 12, in sola lettura sui mesi chiusi, nascondendo le strisce operative live.

**Architecture:** Un nuovo wrapper client `SalesManagerView` possiede lo stato `selectedMonth`, disegna il selettore, monta le strisce operative solo per il mese corrente e passa il mese a `PanoramicaClient` (che rifetcha i 3 overview `yearMonth`-aware già esistenti). Una sola modifica backend rende `resolveAlertState` read-only sui mesi non correnti, per evitare che la consultazione di uno storico sovrascriva lo stato allarmi.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Drizzle ORM, Tailwind CSS, `lucide-react`.

## Global Constraints

- **Nessuna query DB nuova:** `getLeadOverview`, `getFunnelOverview`, `getMetricsOverview` accettano già `yearMonth?` e defaultano a `currentYearMonthRome()`. Non modificarne le firme pubbliche.
- **Bottoni interattivi mai dentro `<span>`/`<p>`:** usare `<div>` (regola anti-WSOD del progetto).
- **Ordinamento classi Tailwind e preset aziendali** (`bg-brand-orange`, `text-ash-*`, `border-ash-200`).
- **Nessun test runner unitario nel repo:** la verifica è `npx tsc --noEmit` (gate primario) + `npm run lint` + QA browser sul dev server. Non inventare suite Jest/Vitest inesistenti.
- **Timezone Europe/Rome:** confronti mese via `currentYearMonthRome()` / stringhe `YYYY-MM`, mai `new Date().getMonth()` grezzo.
- **Gating invariato:** `ManagerParamsStrip` solo se `!isAllCompanies && !isTlConfermeViewer`; `SalesAlertStrip` sempre; accesso pagina = `ADMIN` o TL Conferme (già gestito in `page.tsx`).

## File Structure

- **Modify** `src/app/actions/panoramicaActions.ts` — `funnelOverviewForCompany` accetta `persistAlertState`; `getFunnelOverview` e `metricsOverviewForCompany` calcolano il flag da `ym === currentYearMonthRome()`.
- **Modify** `src/app/(dashboard)/panoramica-generale/PanoramicaClient.tsx` — nuove prop `selectedMonth`/`currentYearMonth`, rifetch al cambio mese, header dinamico, bottoni modifica nascosti e colonna "Today" a `—` sui mesi passati.
- **Create** `src/app/(dashboard)/panoramica-generale/SalesManagerView.tsx` — wrapper client con selettore mese, montaggio condizionale delle strisce.
- **Modify** `src/app/(dashboard)/panoramica-generale/page.tsx` — calcola `currentYearMonth`, passa strisce e mese al wrapper.

---

### Task 1: Backend — `resolveAlertState` read-only sui mesi non correnti

**Files:**
- Modify: `src/app/actions/panoramicaActions.ts`

**Interfaces:**
- Consumes: `currentYearMonthRome()` (già importato, riga ~13), `monthlyFunnelBaselines` row type (`row.statoSegnalazione`, `row.dataPrimoSottoSoglia`).
- Produces: `funnelOverviewForCompany(ctx: TenantContext, ym: string, persistAlertState?: boolean)` — firma interna estesa; `getFunnelOverview`/`getMetricsOverview` invariati nella firma pubblica.

- [ ] **Step 1: Estendere `funnelOverviewForCompany` con `persistAlertState`**

Nel file, cambiare la firma (attorno a riga 929):

```typescript
async function funnelOverviewForCompany(ctx: TenantContext, ym: string, persistAlertState = true): Promise<FunnelOverviewResult> {
```

E dentro il loop `for (const funnelName of ordered)`, sostituire il blocco che risolve lo stato allarme (attorno a righe 991-997):

```typescript
            // Resolve alert state. Su mesi passati (persistAlertState=false) NON si
            // scrive sul DB: si mostrano i valori memorizzati così com'erano, altrimenti
            // consultare uno storico ne sovrascriverebbe lo stato macchina in base a oggi.
            let dataPrimoSottoSoglia: string | null = null;
            let statoSegnalazione: FunnelStato = 'OK';
            if (baseline) {
                if (persistAlertState) {
                    const resolved = await resolveAlertState(baseline, closeCount, ctx.companyId);
                    dataPrimoSottoSoglia = resolved.dataPrimoSottoSoglia ? resolved.dataPrimoSottoSoglia.toISOString() : null;
                    statoSegnalazione = resolved.statoSegnalazione;
                } else {
                    dataPrimoSottoSoglia = baseline.dataPrimoSottoSoglia ? baseline.dataPrimoSottoSoglia.toISOString() : null;
                    statoSegnalazione = baseline.statoSegnalazione;
                }
            }
```

- [ ] **Step 2: Passare il flag da `getFunnelOverview`**

Nella funzione `getFunnelOverview` (attorno a righe 908-927), calcolare il flag e passarlo in entrambi i rami:

```typescript
        const ym = yearMonth || currentYearMonthRome();
        const persistAlerts = ym === currentYearMonthRome();
        if (ctx.isAllCompanies) {
            const parts = await Promise.all(
                ctx.allowedCompanies.map((c) => funnelOverviewForCompany(singleCompanyCtx(ctx, c), ym, persistAlerts)),
            );
            return mergeFunnelOverviews(parts, ym);
        }
        return await funnelOverviewForCompany(ctx, ym, persistAlerts);
```

- [ ] **Step 3: Passare il flag da `metricsOverviewForCompany`**

In `metricsOverviewForCompany` (attorno a riga 500), la prima riga chiama `funnelOverviewForCompany(ctx, ym)`. Sostituirla con:

```typescript
        // 1) Re-use funnel overview to get APP/Conf/Trat/Close totals (per stage).
        //    Su mesi passati non persistere lo stato allarme (read-only).
        const persistAlerts = ym === currentYearMonthRome();
        const funnelOverview = await funnelOverviewForCompany(ctx, ym, persistAlerts);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore nei file toccati.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/panoramicaActions.ts
git commit -m "fix(panoramica): resolveAlertState read-only sui mesi non correnti

Consultare uno storico via getMetricsOverview/getFunnelOverview non deve
più sovrascrivere lo stato macchina degli allarmi in base a oggi.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `PanoramicaClient` guidato dal mese selezionato

**Files:**
- Modify: `src/app/(dashboard)/panoramica-generale/PanoramicaClient.tsx`

**Interfaces:**
- Consumes: server actions `getLeadOverview(ym?)`, `getFunnelOverview(ym?)`, `getMetricsOverview(ym?)` (già importate).
- Produces: `PanoramicaClient` accetta due prop nuove `selectedMonth: string` e `currentYearMonth: string` (oltre alle esistenti). Usato dal wrapper del Task 3.

- [ ] **Step 1: Aggiungere le prop e lo stato derivato**

Nella firma props del componente (attorno a righe 33-47), aggiungere dopo `readOnlyVariant`:

```typescript
    selectedMonth,
    currentYearMonth,
}: {
    initialData: LeadOverviewResult;
    initialFunnelData: FunnelOverviewResult;
    initialMetricsData: MetricsOverviewResult;
    readOnly?: boolean;
    readOnlyVariant?: 'all-companies' | 'viewer';
    /** Mese selezionato dal wrapper ('YYYY-MM'). */
    selectedMonth: string;
    /** Mese in corso ('YYYY-MM') per distinguere la vista storica. */
    currentYearMonth: string;
}) {
```

- [ ] **Step 2: Aggiungere stato loading e derivazione `isPastMonth`**

Subito dopo `const [modalOpen, setModalOpen] = useState(false);` (riga ~52):

```typescript
    const [loading, setLoading] = useState(false);
    const isPastMonth = selectedMonth !== currentYearMonth;
```

- [ ] **Step 3: Aggiungere l'effetto di rifetch al cambio mese**

Importare `useEffect` è già presente (riga 3). Aggiungere dopo la definizione di `refresh` (dopo riga 64):

```typescript
    // Rifetch quando cambia il mese selezionato dal wrapper. Il mese corrente
    // iniziale usa i dati SSR (nessun fetch se già allineato).
    useEffect(() => {
        const loadedYm = data.success ? data.yearMonth : null;
        if (loadedYm === selectedMonth) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            const [fresh, freshFunnel, freshMetrics] = await Promise.all([
                getLeadOverview(selectedMonth),
                getFunnelOverview(selectedMonth),
                getMetricsOverview(selectedMonth),
            ]);
            if (cancelled) return;
            setData(fresh);
            setFunnelData(freshFunnel);
            setMetricsData(freshMetrics);
            setLoading(false);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth]);
```

- [ ] **Step 4: Header dinamico + badge sola lettura + indicatore loading**

Sostituire il blocco "Mese corrente" (righe ~84-87) con:

```typescript
                    <div>
                        <div className="text-xs uppercase tracking-wider text-ash-500 font-semibold">
                            {isPastMonth ? 'Mese storico' : 'Mese in corso'}
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="text-base font-bold text-ash-800">{formatMonthLabel(yearMonth)}</div>
                            {loading && <span className="text-[11px] text-ash-400">Caricamento…</span>}
                        </div>
                    </div>
```

- [ ] **Step 5: Nascondere il bottone "Modifica target" sui mesi passati**

Alla condizione del bottone target (riga ~109) sostituire `{!readOnly && (` con:

```typescript
                    {!readOnly && !isPastMonth && (
```

- [ ] **Step 6: Passare read-only effettivo e `isPastMonth` a `MetricsSection`**

Sostituire la riga di render (riga ~199):

```typescript
            <MetricsSection data={metricsData} onRefresh={refresh} readOnly={readOnly || isPastMonth} isPastMonth={isPastMonth} />
```

- [ ] **Step 7: Aggiornare la firma di `MetricsSection` e la colonna "Today"**

Cambiare la firma di `MetricsSection` (riga ~658):

```typescript
function MetricsSection({ data, onRefresh, readOnly = false, isPastMonth = false }: { data: MetricsOverviewResult; onRefresh: () => void; readOnly?: boolean; isPastMonth?: boolean }) {
```

E la cella "Today" nel corpo tabella (righe ~727-729) — mostrare `—` sui mesi passati:

```typescript
                                <td className={`px-4 py-3 text-right tabular-nums border-l border-ash-100 font-semibold ${!isPastMonth && row.today > 0 ? 'text-emerald-600' : 'text-ash-400'}`}>
                                    {isPastMonth ? '—' : (row.isCurrency ? fmtEur(row.today) : fmtInt(row.today))}
                                </td>
```

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: nessun errore; nessun warning nuovo su `PanoramicaClient.tsx`.

- [ ] **Step 9: Commit**

```bash
git add src/app/(dashboard)/panoramica-generale/PanoramicaClient.tsx
git commit -m "feat(panoramica): PanoramicaClient guidato dal mese selezionato

Rifetch dei 3 overview al cambio mese, header dinamico Mese in corso/storico,
bottoni modifica target nascosti e colonna Today a — sui mesi passati.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wrapper `SalesManagerView` + wiring `page.tsx`

**Files:**
- Create: `src/app/(dashboard)/panoramica-generale/SalesManagerView.tsx`
- Modify: `src/app/(dashboard)/panoramica-generale/page.tsx`

**Interfaces:**
- Consumes: `PanoramicaClient` (prop `selectedMonth`, `currentYearMonth` dal Task 2); tipi `LeadOverviewResult`, `FunnelOverviewResult`, `MetricsOverviewResult` da `@/app/actions/panoramicaActions`.
- Produces: componente client `SalesManagerView` con prop `{ initialData, initialFunnelData, initialMetricsData, readOnly?, readOnlyVariant?, currentYearMonth: string, strips: ReactNode }`.

- [ ] **Step 1: Creare `SalesManagerView.tsx`**

Create `src/app/(dashboard)/panoramica-generale/SalesManagerView.tsx`:

```typescript
'use client';

import { useState, type ReactNode } from 'react';
import { Calendar } from 'lucide-react';
import { PanoramicaClient } from './PanoramicaClient';
import type {
    LeadOverviewResult,
    FunnelOverviewResult,
    MetricsOverviewResult,
} from '@/app/actions/panoramicaActions';

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

/** Ultimi n mesi ('YYYY-MM'), dal più recente, a partire dal mese corrente. */
function lastNMonths(currentYm: string, n: number): string[] {
    const [y, m] = currentYm.split('-').map(Number);
    const out: string[] = [];
    let yy = y;
    let mm = m;
    for (let i = 0; i < n; i++) {
        out.push(`${yy}-${String(mm).padStart(2, '0')}`);
        mm -= 1;
        if (mm === 0) { mm = 12; yy -= 1; }
    }
    return out;
}

function monthLabel(ym: string): string {
    const [y, m] = ym.split('-');
    return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

export function SalesManagerView({
    initialData,
    initialFunnelData,
    initialMetricsData,
    readOnly = false,
    readOnlyVariant = 'all-companies',
    currentYearMonth,
    strips,
}: {
    initialData: LeadOverviewResult;
    initialFunnelData: FunnelOverviewResult;
    initialMetricsData: MetricsOverviewResult;
    readOnly?: boolean;
    readOnlyVariant?: 'all-companies' | 'viewer';
    currentYearMonth: string;
    /** Strisce operative (Alert MTD, Parametri Manager) montate solo sul mese corrente. */
    strips: ReactNode;
}) {
    const [selectedMonth, setSelectedMonth] = useState(currentYearMonth);
    const months = lastNMonths(currentYearMonth, 12);
    const isCurrent = selectedMonth === currentYearMonth;

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-ash-200 bg-white px-3 py-2 shadow-sm">
                    <Calendar className="w-4 h-4 text-brand-orange" />
                    <label htmlFor="sm-month" className="text-xs font-semibold uppercase tracking-wider text-ash-500">
                        Periodo
                    </label>
                    <select
                        id="sm-month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="cursor-pointer bg-transparent text-sm font-bold text-ash-800 outline-none"
                    >
                        {months.map((ym) => (
                            <option key={ym} value={ym}>
                                {monthLabel(ym)}{ym === currentYearMonth ? ' (in corso)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
                {!isCurrent && (
                    <span className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                        Vista storica in sola lettura
                    </span>
                )}
            </div>

            {isCurrent && strips}

            <PanoramicaClient
                initialData={initialData}
                initialFunnelData={initialFunnelData}
                initialMetricsData={initialMetricsData}
                readOnly={readOnly}
                readOnlyVariant={readOnlyVariant}
                selectedMonth={selectedMonth}
                currentYearMonth={currentYearMonth}
            />
        </div>
    );
}
```

- [ ] **Step 2: Wiring in `page.tsx` — import e `currentYearMonth`**

In `src/app/(dashboard)/panoramica-generale/page.tsx`, aggiungere agli import (dopo riga 8):

```typescript
import { SalesManagerView } from "./SalesManagerView";
import { currentYearMonthRome } from "@/lib/workingDaysUtils";
```

E dopo il blocco `Promise.all` degli overview (dopo riga 36), aggiungere:

```typescript
    const currentYearMonth = currentYearMonthRome();
```

- [ ] **Step 3: Sostituire il render di strisce + `PanoramicaClient` con il wrapper**

Sostituire il blocco JSX da `<SalesAlertStrip />` fino a `/>` di `PanoramicaClient` (righe ~53-63) con:

```typescript
            <SalesManagerView
                initialData={overview}
                initialFunnelData={funnelOverview}
                initialMetricsData={metricsOverview}
                readOnly={readOnly}
                readOnlyVariant={isAllCompanies ? 'all-companies' : 'viewer'}
                currentYearMonth={currentYearMonth}
                strips={
                    <>
                        <SalesAlertStrip />
                        {!isAllCompanies && !isTlConfermeViewer && <ManagerParamsStrip />}
                    </>
                }
            />
```

(Gli import di `SalesAlertStrip`, `ManagerParamsStrip`, `PanoramicaClient` restano; `PanoramicaClient` ora è usato solo internamente da `SalesManagerView` — rimuovere l'import diretto di `PanoramicaClient` da `page.tsx` per evitare warning "unused import".)

- [ ] **Step 4: Rimuovere l'import inutilizzato di `PanoramicaClient` da `page.tsx`**

Eliminare la riga `import { PanoramicaClient } from "./PanoramicaClient";` (riga 5).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: nessun errore; nessun import inutilizzato segnalato in `page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/panoramica-generale/SalesManagerView.tsx" "src/app/(dashboard)/panoramica-generale/page.tsx"
git commit -m "feat(panoramica): selettore mese Sales Manager (ultimi 12 mesi)

Wrapper SalesManagerView con dropdown periodo; strisce operative montate solo
sul mese corrente, tabelle Caricamento Lead e Numeri Mensili ricaricate sul
mese scelto in sola lettura.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: QA browser end-to-end

**Files:** nessuno (verifica manuale sul dev server).

**Interfaces:**
- Consumes: build funzionante dei Task 1-3.

- [ ] **Step 1: Avviare il dev server**

Run: `npm run dev`
Expected: server su `http://localhost:3000` senza errori di compilazione.

- [ ] **Step 2: QA come ADMIN — mese corrente (baseline invariata)**

Con le browser tool / playwright MCP: login admin, aprire `/panoramica-generale`.
Verificare:
- In cima compare `Periodo: [<mese corrente> (in corso) ▼]`.
- Le strisce Alert MTD e Parametri Manager sono visibili.
- Le tabelle *Caricamento Lead* e *Numeri Mensili* mostrano gli stessi numeri di prima della feature.
- I bottoni "Modifica target" / "Modifica target metriche" sono presenti.
- Nessun errore in console (`read_console_messages`).

- [ ] **Step 3: QA come ADMIN — mese passato (vista storica)**

Selezionare il mese precedente nel dropdown. Verificare:
- Compare il badge "Vista storica in sola lettura".
- Le strisce Alert MTD e Parametri Manager **scompaiono**.
- Le tabelle si ricaricano (breve "Caricamento…") sui numeri del mese scelto.
- I bottoni "Modifica target" / "Modifica target metriche" **non** sono presenti.
- L'header mostra "Mese storico" e la colonna "Today" dei Numeri Mensili è `—`.
- Nessun errore in console.

- [ ] **Step 4: Verifica no-side-effect allarmi**

Ricaricare la pagina e riportare il dropdown sul mese corrente. Verificare che gli stati allarme del funnel/segnalazioni del mese corrente non siano cambiati per il solo fatto di aver consultato un mese passato (i badge stato del mese corrente restano coerenti). Nessuna riga baseline di un mese passato deve risultare modificata.

- [ ] **Step 5: QA come TL Conferme (sola lettura)**

Login come TL Conferme (Alberto). Aprire `/panoramica-generale`. Verificare:
- Il selettore mese funziona (ultimi 12 mesi).
- Nessun bottone di modifica in nessun mese (già read-only).
- `ManagerParamsStrip` resta assente (gate invariato); `SalesAlertStrip` visibile sul mese corrente.

- [ ] **Step 6: Build di produzione**

Run: `npm run build`
Expected: build completata senza errori (nessun WSOD/hydration su questa route).

- [ ] **Step 7: Commit (se emergono micro-fix di QA)**

Solo se il QA ha richiesto correzioni:

```bash
git add -A
git commit -m "fix(panoramica): correzioni QA selettore mese

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Range ultimi 12 mesi → Task 3 (`lastNMonths(currentYearMonth, 12)`). ✓
- Sola lettura sui mesi chiusi → Task 2 Step 5-6 (bottoni nascosti). ✓
- Strisce nascoste sui mesi passati → Task 3 (`{isCurrent && strips}`). ✓
- Colonna "Today" → `—` sui mesi passati → Task 2 Step 7. ✓
- Header "Mese storico" + badge → Task 2 Step 4 + Task 3 badge. ✓
- Target Prev = target pieno sui mesi chiusi → nessun codice: `countWorkingDaysElapsed` già ritorna i giorni pieni per mese passato (verificato in `workingDaysUtils.ts:88`). ✓
- Fix `resolveAlertState` read-only → Task 1. ✓
- Scope limitato a Caricamento Lead + Numeri Mensili (Funnel Overview / SalesManagerSections fuori) → nessun render aggiunto. ✓
- Gating invariato (Tutte-le-aziende / TL Conferme) → Task 3 Step 3 preserva le condizioni. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step di codice ha il blocco completo. ✓

**Type consistency:** `SalesManagerView` passa `selectedMonth`/`currentYearMonth` esattamente come definiti nella firma estesa di `PanoramicaClient` (Task 2 Step 1); `MetricsSection` riceve `isPastMonth?: boolean` coerente tra Step 6 e Step 7; `funnelOverviewForCompany(..., persistAlertState = true)` chiamato con 3° arg booleano in `getFunnelOverview` e `metricsOverviewForCompany`. ✓
