# Follow-up Review + Risposte Venditori + Metriche per Tentativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere i follow-up della review admin (pulizie, regola workingDays, timezone residui) e aggiungere due feature: tab "Risposte" (tutti gli esiti venditori riga per riga) in `/performance-venditori` e sezione "Resa per tentativo" (tasso risposta/fissaggio per 1ª–4ª+ chiamata, split Nuovi/Database) in `/kpi-gdo`.

**Architecture:** Solo codice, nessuna migrazione DB (il DB è appena stato stabilizzato dopo un outage — vincolo del PO). Le due feature nuove sono ciascuna una server action di lettura + un componente client; i follow-up sono edit puntuali su file esistenti. Spec: `docs/superpowers/specs/2026-07-07-followup-risposte-venditori-metriche-tentativi-design.md`.

**Tech Stack:** Next.js App Router, Drizzle (`src/db/schema.ts`), helper Rome `src/lib/dateUtils.ts`, canon KPI `src/lib/kpi/canon.ts`, Tailwind.

## Global Constraints

- **NESSUNA migrazione DB, nessuna scrittura nuova**: le due action nuove sono SOLO lettura; query paginate/aggregate (DB appena stabilizzato, altro terminale al lavoro sul DB).
- Branch: `feat/risposte-venditori-metriche-tentativi` da **main aggiornato** (`git pull` prima di creare il branch: include realtime Broadcast `5f847e3` e indici `6527a85`).
- Timezone: SOLO helper di `src/lib/dateUtils.ts` (`dayBoundsRome`, `monthBoundsRome`, `weekBoundsRome`, `toRomeDateStr`) — i loro `end` sono **esclusivi**: confronti `>= start && < end`, mai `lte(end)`.
- Tenancy: `currentTenant()` / `companyScope(ctx, col)`. Bot (`users.isBot`) escluso da ogni metrica GDO.
- "Database" = `leads.funnel` uguale a `database` **case-insensitive**; "Nuovi" = tutto il resto.
- Il tetto chiamate GDO NON cambia (resta lo scarto al 3° tentativo a vuoto in `pipelineActions.ts`) — SOLO metriche.
- Niente bottoni dentro `<span>`/`<p>`. Il repo NON ha test suite: verifica = `npx tsc --noEmit` + `npm run build` verdi per ogni task. Un commit per task.

---

### Task 1: Pulizie codice

**Files:**
- Delete: `src/app/(dashboard)/panoramica-generale/SalesManagerSections.tsx` (mai importato — verificare con grep prima di eliminare)
- Modify: `src/components/TeamManagementClient.tsx` (useState di `massDailyTarget`), `src/app/(dashboard)/panoramica-generale/PanoramicaClient.tsx` (messaggi errore grezzi)

**Interfaces:** nessuna nuova.

- [ ] **Step 1:** `grep -rn "SalesManagerSections" src/` → deve comparire SOLO il file stesso. Se sì, `git rm "src/app/(dashboard)/panoramica-generale/SalesManagerSections.tsx"`.
- [ ] **Step 2:** In `TeamManagementClient.tsx` trovare `useState` di `massDailyTarget` (inizializzato a `2`) → inizializzarlo a `DEFAULT_DAILY_APPT_TARGET` (import da `@/lib/kpi/canon` già presente nel file dal fix precedente — verificare).
- [ ] **Step 3:** In `PanoramicaClient.tsx` aggiungere un helper a livello modulo e usarlo nei TRE punti che mostrano `res.error` grezzo (handleSave del target modal ~riga 603, FunnelSection ~riga 525, MetricsSection ~riga 905 — le righe possono slittare, cercare `setError(res.error`):

```ts
function friendlyError(e?: string): string {
    if (e === 'UNAUTHORIZED') return 'Non hai i permessi per modificare i target.'
    return e || 'Errore durante il salvataggio'
}
// nei tre punti: setError(friendlyError(res.error))
```

- [ ] **Step 4:** `npx tsc --noEmit` e `npm run build` → verdi.
- [ ] **Step 5:** Commit — `chore(panoramica): rimozione SalesManagerSections morto, massDailyTarget=8, errori target leggibili`

---

### Task 2: workingDays — "Auto" valido anche nella config Sales Manager

**Files:**
- Modify: `src/app/actions/panoramicaActions.ts` (`setLeadMonthlyTarget`, ~righe 248-312), `src/app/(dashboard)/panoramica-generale/PanoramicaClient.tsx` (modal config, ~righe 564-666)

**Interfaces:**
- Consumes: convenzione già live `monthlyLeadTargets.workingDays`: `0 = auto` (calcolo Rome-aware), `> 0 = override manuale`. I punti di LETTURA gestiscono già lo 0 (`panoramicaActions.ts:153` fallback `|| countWorkingDaysInMonth`, `targetActions.ts:268`, `confermeKpiActions` `overrideVal > 0 ? ...`) — NON toccarli.
- Produces: `setLeadMonthlyTarget` accetta `workingDays: 0`.

- [ ] **Step 1:** In `setLeadMonthlyTarget` la validazione (riga ~263) `input.workingDays <= 0` → `input.workingDays < 0` (lo 0 diventa legale = auto; i negativi restano invalidi). Aggiornare il commento.
- [ ] **Step 2:** Nel modal di `PanoramicaClient.tsx`:
  - nuovo stato: `const [autoWorkingDays, setAutoWorkingDays] = useState<boolean>(!initialConfig || initialConfig.workingDays === 0)` e `const [suggestedWd, setSuggestedWd] = useState<number>(0)`;
  - l'`useEffect` esistente (~572-578) che chiama `getSuggestedWorkingDays(yearMonth)` va esteso: eseguirlo SEMPRE (non solo senza config) e salvare in `setSuggestedWd`; mantenere il prefill di `workingDays` solo quando `!initialConfig`;
  - sostituire il `LabeledInput` "Giorni lavorativi del mese" (~640-647) con un blocco checkbox+input:

```tsx
<div>
    <label className="flex items-center gap-2 text-xs font-medium text-gray-600 mb-1">
        <input
            type="checkbox"
            checked={autoWorkingDays}
            onChange={e => setAutoWorkingDays(e.target.checked)}
        />
        Giorni lavorativi automatici ({suggestedWd || '…'} per questo mese)
    </label>
    {!autoWorkingDays && (
        <LabeledInput
            label="Giorni lavorativi (override manuale)"
            value={workingDays}
            onChange={setWorkingDays}
            help="Vince sul calcolo automatico ovunque (Sales Manager e Target & Previsioni)."
        />
    )}
</div>
```

  - in `handleSave`: la validazione `workingDays <= 0` si applica SOLO se `!autoWorkingDays`; il payload invia `workingDays: autoWorkingDays ? 0 : workingDays`.
- [ ] **Step 3:** Controllo incrociato: l'header pagina mostra `config.workingDays` grezzo (~riga 132 `/{config.workingDays}`) — con auto=0 mostrerebbe "/0". Verificare come `getLeadOverview` costruisce `config`: se ritorna il valore DB grezzo, sostituire nel client la visualizzazione con il valore effettivo già calcolato altrove nel payload, oppure (preferito, un solo punto) far risolvere a `getLeadOverview` `workingDays: row.workingDays > 0 ? row.workingDays : countWorkingDaysInMonth(...)` PRIMA di ritornare `config` — leggere la funzione e applicare la soluzione col minor raggio.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm run build` → verdi.
- [ ] **Step 5:** Commit — `feat(targets): giorni lavorativi "auto" (0) valido anche dalla config Sales Manager, stessa semantica di manager-targets`

---

### Task 3: Timezone residui → helper Rome

**Files:**
- Modify: `src/app/actions/confermeKpiActions.ts` (`monthBoundsForCalendar` ~30-32, griglia `getConfermeKpiStats` ~44-160, `getConfermeDailyObjectives` ~606-638), `src/app/actions/gdoPerformanceActions.ts` (`getGdoLeadOutcomeMetrics` ~426-500, `getGdoDailyObjectives` ~505-545, lookup `weeklyGamificationRules` righe ~294 e ~364)

**Interfaces:**
- Consumes: `dayBoundsRome(at)`, `monthBoundsRome('YYYY-MM')`, `weekBoundsRome(at)`, `toRomeDateStr(at)` — tutti con `end` ESCLUSIVO.
- Produces: shape di ritorno delle funzioni INVARIATE (solo i bound cambiano).

- [ ] **Step 1 — `getConfermeDailyObjectives` e `getGdoDailyObjectives`:** sostituire il blocco `toLocaleDateString`+`new Date(year, month-1, day, ...)` con:

```ts
const { start: todayStart, end: todayEnd } = dayBoundsRome(new Date())
// nelle where: gte(col, todayStart), lt(col, todayEnd)   // end esclusivo: lt, NON lte
```

- [ ] **Step 2 — `getGdoLeadOutcomeMetrics`:** sostituire il calcolo manuale settimana/mese (righe ~430-441) con:

```ts
const now = new Date()
const { start: weekStart, end: weekEnd } = weekBoundsRome(now)      // end esclusivo
const monthStr = toRomeDateStr(now).slice(0, 7)
const { start: monthStart, end: monthEnd } = monthBoundsRome(monthStr) // end esclusivo
```

e aggiornare i confronti: `apptAt >= monthStart && apptAt < monthEnd`, `apptAt >= weekStart && apptAt < weekEnd`; nelle where SQL `lte(leads.appointmentDate, rangeEnd)` → `lt(...)` con `rangeEnd = weekEnd > monthEnd ? weekEnd : monthEnd`. Il return `weekEnd.toISOString()` ora è esclusivo: verificare i consumer del campo (grep `weekEnd`) — se un client lo mostra come "fine settimana", sottrarre 1ms SOLO nella stringa mostrata, non nei confronti.
- [ ] **Step 3 — lookup `weeklyGamificationRules`:** alle righe ~294 e ~364 di `gdoPerformanceActions.ts`, `today.toISOString().slice(0, 7)` → `toRomeDateStr(today).slice(0, 7)`.
- [ ] **Step 4 — griglia calendario `getConfermeKpiStats`:** sostituire `monthBoundsForCalendar` e le date-fns server-locale con costruzione Rome-native:

```ts
const monthStr = toRomeDateStr(monthDate).slice(0, 7)
const { start, end } = monthBoundsRome(monthStr) // end esclusivo
const calendarStart = weekBoundsRome(new Date(start.getTime() + 12 * 3600_000)).start
const calendarEnd = weekBoundsRome(new Date(end.getTime() - 12 * 3600_000)).end // fine (esclusiva) della settimana che contiene l'ultimo giorno

// Giorni del mese come stringhe Rome (il passo a mezzogiorno evita i bordi DST)
const daysInMonth: string[] = []
for (let t = start.getTime() + 12 * 3600_000; t < end.getTime(); t += 24 * 3600_000) {
    const s = toRomeDateStr(new Date(t))
    if (daysInMonth[daysInMonth.length - 1] !== s) daysInMonth.push(s)
}
const dailyStats = daysInMonth.map(dayStr => {
    const leadsOfDay = calendarLeads.filter(l =>
        l.appointmentDate && toRomeDateStr(new Date(l.appointmentDate)) === dayStr,
    )
    // ... conteggi INVARIATI ...
    return {
        date: dayStr,
        dayOfWeek: new Date(dayStr + 'T12:00:00Z').getUTCDay(),
        fixed, confirmed, discarded,
    }
})

// Settimane che intersecano il mese, Rome-native
const weekStartsRome: Date[] = []
let w = weekBoundsRome(new Date(start.getTime() + 12 * 3600_000)).start
while (w < end) {
    weekStartsRome.push(w)
    w = weekBoundsRome(new Date(w.getTime() + 7 * 86400_000 + 12 * 3600_000)).start
}
const weeklyHistory = weekStartsRome.map((weekStart, index) => {
    const wEnd = weekBoundsRome(new Date(weekStart.getTime() + 12 * 3600_000)).end // esclusivo
    const actThisWeek = confirmedLeads.filter(l =>
        l.date && l.outcome === 'confermato' &&
        new Date(l.date) >= weekStart && new Date(l.date) < wEnd,
    ).length
    const isCurrent = new Date() >= weekStart && new Date() < wEnd
    const fmt = (d: Date) => { const [Y, M, D] = toRomeDateStr(d).split('-'); return `${D}/${M}` }
    return {
        weekName: `Sett. ${index + 1}`,
        dateRange: `${fmt(weekStart)} - ${fmt(new Date(wEnd.getTime() - 12 * 3600_000))}`,
        act: actThisWeek,
        // ... resto INVARIATO ...
    }
})
```

Le query che usavano `calendarStart/calendarEnd` con `lte` passano a `lt(calendarEnd)`. Import di `eachDayOfInterval`/`eachWeekOfInterval`/`startOfWeek`/`endOfWeek` rimossi se non più usati altrove nel file.
- [ ] **Step 5:** `npx tsc --noEmit` + `npm run build` → verdi.
- [ ] **Step 6:** Commit — `fix(tz): calendario e obiettivi Conferme/GDO su helper Europe/Rome (chiusura follow-up B3)`

---

### Task 4: Tab "Risposte" in /performance-venditori

**Files:**
- Modify: `src/app/actions/venditorePerformanceActions.ts` (nuova action in coda), `src/app/(dashboard)/performance-venditori/PerformanceVenditoriClient.tsx` (tab switcher)
- Create: `src/components/venditore-performance/VenditoriRisposteTab.tsx`

**Interfaces:**
- Consumes: `salesAttempts` (schema.ts:897-914: `attemptNumber` 0=esito app/1-3=FU, `outcome`, `notClosedReason`, `nextFollowUpDate`, `closeProduct`, `closeAmountEur`, `outcomeAt`), `leads` (`name`, `phone`, `funnel`, `salespersonOutcomeNotes`), `users.name`; `monthBoundsRome`; gate staff esistente di `getVenditorePerformance` (righe 41-46).
- Produces:

```ts
export interface VenditoreRispostaRow {
    id: string; outcomeAt: string;            // ISO
    venditoreName: string;
    leadId: string; leadName: string | null; leadPhone: string | null; funnel: string | null;
    attemptNumber: number;                     // 0 = esito app, 1-3 = FU #n
    outcome: string;                           // 'Chiuso' | 'Non chiuso' | 'Perso' | 'Sparito'
    notClosedReason: string | null;
    nextFollowUpDate: string | null;           // ISO
    closeProduct: string | null; closeAmountEur: number | null;
    notes: string | null;                      // leads.salespersonOutcomeNotes
}
export async function getVenditoriRisposte(input: {
    yearMonth: string;
    salesUserId?: string;      // undefined = tutti
    outcome?: string;
    notClosedReason?: string;
    page?: number;             // 1-based, default 1
}): Promise<{ rows: VenditoreRispostaRow[]; total: number; pageSize: number }>
```

- [ ] **Step 1 — action:** in `venditorePerformanceActions.ts`, riusando lo stesso blocco di autorizzazione staff di `getVenditorePerformance` (righe 41-46) ma SOLO staff (niente ramo self: la tab è manager-facing; un venditore non chiama questa action):

```ts
const PAGE_SIZE = 50
export async function getVenditoriRisposte(input: { yearMonth: string; salesUserId?: string; outcome?: string; notClosedReason?: string; page?: number }) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const role = user?.user_metadata?.role
    const email = user?.user_metadata?.email ?? user?.email
    const isStaff = role === 'MANAGER' || role === 'ADMIN' || (role === 'CONFERME' && isConfermeTl(email))
    if (!isStaff) throw new Error('Forbidden')

    const { start, end } = monthBoundsRome(input.yearMonth)
    const conds = [
        companyScope(ctx, salesAttempts.companyId),
        gte(salesAttempts.outcomeAt, start),
        lt(salesAttempts.outcomeAt, end),
        ...(input.salesUserId ? [eq(salesAttempts.salesUserId, input.salesUserId)] : []),
        ...(input.outcome ? [eq(salesAttempts.outcome, input.outcome)] : []),
        ...(input.notClosedReason ? [eq(salesAttempts.notClosedReason, input.notClosedReason)] : []),
    ]
    const page = Math.max(1, input.page ?? 1)
    const [rows, totalRes] = await Promise.all([
        db.select({
            id: salesAttempts.id, outcomeAt: salesAttempts.outcomeAt,
            venditoreName: users.name,
            leadId: salesAttempts.leadId, leadName: leads.name, leadPhone: leads.phone, funnel: leads.funnel,
            attemptNumber: salesAttempts.attemptNumber, outcome: salesAttempts.outcome,
            notClosedReason: salesAttempts.notClosedReason, nextFollowUpDate: salesAttempts.nextFollowUpDate,
            closeProduct: salesAttempts.closeProduct, closeAmountEur: salesAttempts.closeAmountEur,
            notes: leads.salespersonOutcomeNotes,
        }).from(salesAttempts)
          .innerJoin(leads, eq(leads.id, salesAttempts.leadId))
          .innerJoin(users, eq(users.id, salesAttempts.salesUserId))
          .where(and(...conds))
          .orderBy(desc(salesAttempts.outcomeAt), desc(salesAttempts.id))
          .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
        db.select({ count: sql<number>`count(*)::integer` }).from(salesAttempts).where(and(...conds)),
    ])
    return {
        rows: rows.map(r => ({ ...r, outcomeAt: r.outcomeAt.toISOString(), nextFollowUpDate: r.nextFollowUpDate?.toISOString() ?? null })),
        total: totalRes[0]?.count ?? 0,
        pageSize: PAGE_SIZE,
    }
}
```

(import da aggiungere: `leads`, `users` da schema; `gte`, `lt`, `desc`, `sql` da drizzle-orm.)
- [ ] **Step 2 — componente tab:** creare `VenditoriRisposteTab.tsx` (client): props `{ venditori: {id,name}[]; initialYearMonth: string }`; stato filtri (venditore=tutti, mese, esito, motivo) + `page` + `data`; `useEffect` che chiama `getVenditoriRisposte` al cambio di filtri/pagina (reset `page=1` al cambio filtro). Tabella dentro `<div className="overflow-x-auto">`: colonne Data (formato `toLocaleString('it-IT', { timeZone: 'Europe/Rome' })`), Venditore, Lead (nome + telefono sotto, + badge funnel), Tentativo (`attemptNumber === 0 ? 'Esito app' : \`FU #${n}\``), Esito (badge: Chiuso `bg-green-100 text-green-800`, Non chiuso `bg-amber-100 text-amber-800`, Perso `bg-red-100 text-red-800`, Sparito `bg-gray-100 text-gray-600`), Motivo, Prossimo FU, Prodotto/€ (solo se Chiuso: `closeProduct` + `closeAmountEur.toLocaleString('it-IT')€`), Note (troncate `max-w-[240px] truncate` con `title=` per il testo pieno). Footer: "N risposte" + bottoni ‹ › con `page`/`Math.ceil(total/pageSize)`. I filtri esito e motivo sono `<select>` con le opzioni fisse: esiti `Chiuso|Non chiuso|Perso|Sparito`; motivi: derivare le opzioni dai valori distinti presenti nella pagina corrente NON basta — usare la lista canonica degli 8 motivi: cercarla in `src/lib/venditorePerformance/` o dove è definita per il form venditore (grep `notClosedReason`) e importarla, NON duplicarla.
- [ ] **Step 3 — tab switcher:** in `PerformanceVenditoriClient.tsx` aggiungere `const [tab, setTab] = useState<'performance' | 'risposte'>('performance')` e i due bottoni tab sopra i selettori (stile pill coerente con le tab esistenti del CRM, es. quelle in qualita-lead); `tab === 'performance'` → contenuto attuale invariato; `tab === 'risposte'` → `<VenditoriRisposteTab venditori={venditori} initialYearMonth={initialYearMonth} />`.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm run build` → verdi.
- [ ] **Step 5:** Commit — `feat(venditori): tab Risposte in performance-venditori, tutti gli esiti riga per riga con filtri e paginazione`

---

### Task 5: "Resa per tentativo" in /kpi-gdo

**Files:**
- Modify: `src/app/actions/kpiAdvancedActions.ts` (nuova action in coda), `src/components/KpiGdoBoard.tsx` (fetch + nuova sezione)

**Interfaces:**
- Consumes: `callLogs` (schema.ts:202-217), `leads.funnel`, `users.isBot`; `isNeverAnsweredLog(outcome, discardReason)` già nel file (righe 39-42); filtri esistenti di `KpiGdoBoard` (`startDate/endDate` Date, `funnel?`, `gdoId?`).
- Produces:

```ts
export interface CallAttemptBucket { calls: number; answerPct: number; apptPct: number }
export interface CallAttemptMetricsRow { attempt: '1ª' | '2ª' | '3ª' | '4ª+'; nuovi: CallAttemptBucket; database: CallAttemptBucket }
export async function getGdoCallAttemptMetrics(filters: { startDate: Date | string; endDate: Date | string; funnel?: string; gdoId?: string }): Promise<CallAttemptMetricsRow[]>
```

- [ ] **Step 1 — action:** il numero di tentativo è la posizione della chiamata nella storia COMPLETA del lead (una chiamata nel periodo può essere la 3ª del lead) → `row_number()` su tutta la storia company-scoped in una CTE Drizzle, poi filtro periodo e aggregazione in JS:

```ts
export async function getGdoCallAttemptMetrics(filters: { startDate: Date | string; endDate: Date | string; funnel?: string; gdoId?: string }): Promise<CallAttemptMetricsRow[]> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const start = new Date(filters.startDate)
    const end = new Date(filters.endDate)

    const botRows = await db.select({ id: users.id }).from(users)
        .where(and(companyScope(ctx, users.companyId), eq(users.isBot, true)))
    const botIds = new Set(botRows.map(r => r.id))

    // CTE: rn = posizione della chiamata nella storia completa del lead
    const ranked = db.$with('ranked').as(
        db.select({
            leadId: callLogs.leadId,
            userId: callLogs.userId,
            outcome: callLogs.outcome,
            discardReason: callLogs.discardReason,
            createdAt: callLogs.createdAt,
            rn: sql<number>`row_number() over (partition by ${callLogs.leadId} order by ${callLogs.createdAt}, ${callLogs.id})`.as('rn'),
        }).from(callLogs).where(companyScope(ctx, callLogs.companyId)),
    )
    const rows = await db.with(ranked)
        .select({
            rn: ranked.rn,
            userId: ranked.userId,
            outcome: ranked.outcome,
            discardReason: ranked.discardReason,
            funnel: leads.funnel,
        })
        .from(ranked)
        .innerJoin(leads, eq(leads.id, ranked.leadId))
        .where(and(
            gte(ranked.createdAt, start),
            lte(ranked.createdAt, end), // i filtri di KpiGdoBoard passano end INCLUSIVO (stesso contratto di getAdvancedKpi): mantenere lte qui
            ...(filters.funnel ? [eq(leads.funnel, filters.funnel)] : []),
            ...(filters.gdoId ? [eq(ranked.userId, filters.gdoId)] : []),
        ))

    const emptyBucket = () => ({ calls: 0, answered: 0, appts: 0 })
    const buckets = new Map<string, { nuovi: ReturnType<typeof emptyBucket>; database: ReturnType<typeof emptyBucket> }>(
        ['1ª', '2ª', '3ª', '4ª+'].map(k => [k, { nuovi: emptyBucket(), database: emptyBucket() }]),
    )
    for (const r of rows) {
        if (r.userId && botIds.has(r.userId)) continue // bot escluso
        const key = r.rn >= 4 ? '4ª+' : (`${r.rn}ª` as const)
        const side = (r.funnel ?? '').toLowerCase() === 'database' ? 'database' : 'nuovi'
        const b = buckets.get(key)![side]
        b.calls++
        if (r.outcome !== 'NON_RISPOSTO' && !isNeverAnsweredLog(r.outcome, r.discardReason)) b.answered++
        if (r.outcome === 'APPUNTAMENTO') b.appts++
    }
    const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0
    return (['1ª', '2ª', '3ª', '4ª+'] as const).map(attempt => {
        const b = buckets.get(attempt)!
        return {
            attempt,
            nuovi: { calls: b.nuovi.calls, answerPct: pct(b.nuovi.answered, b.nuovi.calls), apptPct: pct(b.nuovi.appts, b.nuovi.calls) },
            database: { calls: b.database.calls, answerPct: pct(b.database.answered, b.database.calls), apptPct: pct(b.database.appts, b.database.calls) },
        }
    })
}
```

Nota fissaggio: qui misura la RESA della singola chiamata (outcome `APPUNTAMENTO` su quel tentativo); l'attribuzione canonica dei fissati per data (`apptSetAt`) NON è toccata.
- [ ] **Step 2 — UI:** in `KpiGdoBoard.tsx`: nuovo stato `const [attemptMetrics, setAttemptMetrics] = useState<CallAttemptMetricsRow[] | null>(null)`; nel `useEffect` principale (dove già chiama `getAdvancedKpi`, ~riga 114) aggiungere in parallelo `getGdoCallAttemptMetrics({ startDate: start, endDate: end, funnel: funnelFilter !== 'ALL' ? funnelFilter : undefined, gdoId: gdoFilter !== 'ALL' ? gdoFilter : undefined }).then(setAttemptMetrics)`. Nuova sezione DOPO il blocco GRAPHS (~riga 570), card con heading "Resa per tentativo" (icona `Repeat` o `ListOrdered` da lucide) e tabella in `overflow-x-auto`: colonna Tentativo (1ª/2ª/3ª/4ª+) poi due gruppi di colonne "Nuovi" e "Database", ognuno con Chiamate · % Risposta · % Fissaggio. Se `funnelFilter !== 'ALL'`: mostrare solo il gruppo pertinente (il gruppo "Database" se il funnel selezionato è `database` case-insensitive, altrimenti solo "Nuovi"). Righe con `calls === 0` su entrambi i lati: mostrare "—" nelle percentuali. Sotto la tabella una riga di caption: `Numero di tentativo = posizione della chiamata nella storia del lead. Il tetto attuale resta 3 tentativi a vuoto.`
- [ ] **Step 3:** `npx tsc --noEmit` + `npm run build` → verdi.
- [ ] **Step 4:** Commit — `feat(kpi-gdo): sezione Resa per tentativo (risposta/fissaggio per numero chiamata, split Nuovi vs Database)`

---

### Task 6: Verifica finale, QA e deploy

- [ ] **Step 1:** `npm run build` finale verde sul branch completo.
- [ ] **Step 2:** QA browser locale (dev server porta 3001, admin admin@fenice.com):
  - `/performance-venditori` → tab Risposte: righe presenti, filtri venditore/mese/esito/motivo funzionanti, paginazione se >50; tab Performance invariata.
  - `/kpi-gdo` → card "Resa per tentativo": somma chiamate per tentativo ≈ card Chiamate del periodo (bot escluso); filtro funnel DATABASE → resta solo il gruppo Database.
  - `/panoramica-generale` → modal target: checkbox Auto attiva di default sui mesi senza override, salvataggio con Auto → riapertura mostra ancora Auto; header giorni lavorativi mai "/0".
  - KPI Conferme (`/kpi-conferme`) → griglia calendario e settimane con label coerenti.
- [ ] **Step 3:** Merge su main aggiornato + push → deploy Vercel → smoke test prod (login 200, /kpi-gdo carica).
- [ ] **Step 4:** Aggiornare la memoria di progetto con l'esito.

---

## Self-Review (fatto)

- Copertura spec: 1a→Task 1, 1b→Task 2, 1c→Task 3, Blocco 2→Task 4, Blocco 3→Task 5, QA/rollout→Task 6. Fuori scope (password, unique yearMonth, asimmetria ranking kpi-team) dichiarato nella spec.
- Nessuna migrazione DB in nessun task; le due action nuove sono read-only.
- Tipi coerenti: `VenditoreRispostaRow`/`getVenditoriRisposte` (Task 4) e `CallAttemptMetricsRow`/`getGdoCallAttemptMetrics` (Task 5) definiti una volta e riusati nei rispettivi client.
- Convenzione end-esclusivo rispettata nei task 2-4; in Task 5 il contratto `lte(end)` è ereditato dai filtri esistenti di KpiGdoBoard (stesso comportamento di `getAdvancedKpi`) e annotato.
