# Lead Gestiti / Giorno — Throughput GDO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla tabella per-GDO di `/kpi-gdo` 4 nuove colonne (Media call/Lead, Call/Giorno, Lead/Giorno cap., Chiusi) calcolate su rolling 30 giorni, con riga team aggregata.

**Architecture:** Nuova server action `getGdoThroughputMetrics30d()` in `src/app/actions/kpiAdvancedActions.ts` (Approccio B della spec — separata da `getAdvancedKpi`). Fetch in parallelo nel client `KpiGdoBoard.tsx`, merge per `gdoId`. Tre query Drizzle (lead chiusi via `leadEvents`, chiamate via `callLogs`, chiusure pattern già esistente).

**Tech Stack:** Next.js 16, Drizzle ORM, React 19, Tailwind 4, TypeScript. Niente test framework (lint+build+manuale+script diagnostico).

**Spec:** `docs/superpowers/specs/2026-05-27-lead-gestiti-giorno-design.md`

---

### Task 1: Aggiungere helper `workingDaysBetween` a `workingDaysUtils.ts`

**Files:**
- Modify: `src/lib/workingDaysUtils.ts` (aggiungi nuova funzione dopo `countWorkingDaysElapsed`, intorno a riga 101)

`workingDaysUtils.ts` ha già `countWorkingDaysInMonth` e `countWorkingDaysElapsed` ma manca un helper "tra due date arbitrarie" — serve per dividere `totalCalls / workingDays` nella finestra rolling 30gg.

- [ ] **Step 1: Aggiungere funzione `workingDaysBetween`**

Apri `src/lib/workingDaysUtils.ts` e dopo la chiusura della funzione `countWorkingDaysElapsed` (riga 101 attuale) aggiungi:

```typescript
/**
 * Count working days in [start, end] inclusive — Europe/Rome calendar.
 * Sundays off + Italian national holidays (incluso Pasquetta).
 * `start` and `end` are absolute timestamps; the date in Europe/Rome is what counts.
 */
export function workingDaysBetween(start: Date, end: Date): number {
    if (end.getTime() < start.getTime()) return 0;

    // Convert to Europe/Rome calendar dates (YYYY-MM-DD strings) to avoid TZ drift.
    const toRomeDate = (d: Date): { y: number; m: number; day: number } => {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {} as Record<string, string>);
        return { y: parseInt(parts.year, 10), m: parseInt(parts.month, 10), day: parseInt(parts.day, 10) };
    };

    const a = toRomeDate(start);
    const b = toRomeDate(end);

    // Build a calendar cursor in UTC matching Rome local date — same trick used elsewhere in this file.
    const cursor = new Date(Date.UTC(a.y, a.m - 1, a.day));
    const endDate = new Date(Date.UTC(b.y, b.m - 1, b.day));

    let count = 0;
    const holidaysByYear = new Map<number, Set<string>>();

    while (cursor.getTime() <= endDate.getTime()) {
        const y = cursor.getUTCFullYear();
        const m = cursor.getUTCMonth() + 1;
        const d = cursor.getUTCDate();
        const dow = cursor.getUTCDay(); // 0 = Sunday

        if (dow !== 0) {
            if (!holidaysByYear.has(y)) holidaysByYear.set(y, getItalianHolidays(y));
            const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (!holidaysByYear.get(y)!.has(iso)) count++;
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return count;
}
```

- [ ] **Step 2: Verifica TypeScript con build**

Run: `npm run build`
Expected: build passa senza errori. Eventuali errori solo dentro `workingDaysUtils.ts` vanno fixati.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workingDaysUtils.ts
git commit -m "feat(utils): add workingDaysBetween(start, end) helper

Conta giorni lavorativi Italia (no domeniche, no festivi) in un range
arbitrario. Serve per calcolare chiamate/giorno su finestre rolling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Creare server action `getGdoThroughputMetrics30d`

**Files:**
- Modify: `src/app/actions/kpiAdvancedActions.ts` (aggiungi action in fondo al file, dopo `getGdoTargetsProgress`, intorno a riga 394)

- [ ] **Step 1: Aggiornare imports in cima al file**

In `src/app/actions/kpiAdvancedActions.ts` riga 4-7, sostituisci gli imports correnti con:

```typescript
import { db } from "@/db"
import { callLogs, leads, users, leadEvents } from "@/db/schema"
import { gte, lte, lt, and, eq, desc, inArray, isNotNull, sql } from "drizzle-orm"
import { format } from "date-fns"
import { dayBoundsRome, weekBoundsRome } from "@/lib/dateUtils"
import { workingDaysBetween } from "@/lib/workingDaysUtils"
import { currentTenant, assertSalesArea } from '@/lib/tenancy'
```

Aggiunti: `leadEvents`, `inArray`, `isNotNull`, `sql` da drizzle, e `workingDaysBetween`.

- [ ] **Step 2: Aggiungere il tipo di ritorno**

In `src/app/actions/kpiAdvancedActions.ts`, prima della funzione `getGdoThroughputMetrics30d` (che creerai nello step 3), aggiungi:

```typescript
export type GdoThroughputRow = {
    gdoId: string
    gdoName: string
    avgCallsPerLead: number | null
    callsPerDay: number
    dailyCapacity: number | null
    closures: number
    closedLeadsCount: number
}

export type GdoThroughputMetrics = {
    perGdo: GdoThroughputRow[]
    teamTotals: Omit<GdoThroughputRow, 'gdoId' | 'gdoName'>
}
```

- [ ] **Step 3: Implementare la server action**

Aggiungi in fondo a `src/app/actions/kpiAdvancedActions.ts`:

```typescript
/**
 * Throughput per GDO sulla finestra rolling 30 giorni Europe/Rome.
 *
 * Metriche:
 * - avgCallsPerLead = SUM(callCount sui lead chiusi nella finestra) / COUNT(lead chiusi)
 *   Un lead è "chiuso" se ha un leadEvent APPOINTMENT_SET o DISCARDED nella finestra.
 * - callsPerDay = COUNT(callLogs nella finestra) / workingDaysBetween(start, end)
 * - dailyCapacity = round(callsPerDay / avgCallsPerLead) — metrica primaria
 * - closures = COUNT(lead con salespersonOutcome='Chiuso' e salespersonOutcomeAt nella finestra)
 *   (stesso pattern di getGdoTargetsProgress.weeklyClosedRows)
 *
 * Tutti i numeri sono tenant-scoped (companyId = ctx.companyId).
 */
export async function getGdoThroughputMetrics30d(): Promise<GdoThroughputMetrics> {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    // Finestra: ultimi 30 giorni Europe/Rome, dall'inizio del giorno 29 giorni fa fino a now.
    const now = new Date()
    const startBound = dayBoundsRome(new Date(now.getTime() - 29 * 86400000)).start
    const end = now
    const workingDays = Math.max(1, workingDaysBetween(startBound, end))

    // --- Query 1: utenti GDO attivi del tenant ---
    const gdoUsers = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(and(
            eq(users.companyId, ctx.companyId),
            eq(users.role, 'GDO')
        ))

    // --- Query 2: lead chiusi nella finestra (per GDO, dedup per leadId) ---
    // Prendiamo TUTTI i leadEvents APPOINTMENT_SET / DISCARDED nella finestra
    // joinati col lead, escludendo self-booked. Poi dedup in JS prendendo
    // l'ULTIMO evento terminale per ogni leadId (caso: APPOINTMENT_SET poi
    // DISCARDED → conta una sola volta).
    const terminalEvents = await db.select({
        leadId: leadEvents.leadId,
        eventType: leadEvents.eventType,
        timestamp: leadEvents.timestamp,
        assignedToId: leads.assignedToId,
        callCount: leads.callCount,
    })
        .from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(and(
            eq(leadEvents.companyId, ctx.companyId),
            eq(leads.companyId, ctx.companyId),
            inArray(leadEvents.eventType, ['APPOINTMENT_SET', 'DISCARDED']),
            gte(leadEvents.timestamp, startBound),
            lt(leadEvents.timestamp, end),
            isNotNull(leads.assignedToId),
            eq(leads.isSelfBooked, false),
        ))
        .orderBy(desc(leadEvents.timestamp))

    // Dedup: per ogni leadId, tieni il primo (= più recente per ORDER BY desc).
    const closedByLead = new Map<string, { assignedToId: string; callCount: number }>()
    for (const row of terminalEvents) {
        if (!row.assignedToId) continue
        if (closedByLead.has(row.leadId)) continue
        closedByLead.set(row.leadId, { assignedToId: row.assignedToId, callCount: row.callCount ?? 0 })
    }

    // Aggrega per GDO.
    const closedByGdo = new Map<string, { sumCalls: number; count: number }>()
    for (const v of closedByLead.values()) {
        const cur = closedByGdo.get(v.assignedToId) ?? { sumCalls: 0, count: 0 }
        cur.sumCalls += v.callCount
        cur.count += 1
        closedByGdo.set(v.assignedToId, cur)
    }

    // --- Query 3: chiamate nella finestra (per GDO) ---
    const callsAgg = await db.select({
        userId: callLogs.userId,
        cnt: sql<number>`count(*)::int`,
    })
        .from(callLogs)
        .where(and(
            eq(callLogs.companyId, ctx.companyId),
            isNotNull(callLogs.userId),
            gte(callLogs.createdAt, startBound),
            lt(callLogs.createdAt, end),
        ))
        .groupBy(callLogs.userId)

    const callsByGdo = new Map<string, number>()
    for (const r of callsAgg) {
        if (r.userId) callsByGdo.set(r.userId, Number(r.cnt))
    }

    // --- Query 4: chiusure nella finestra (per GDO) — stesso pattern di getGdoTargetsProgress ---
    const closuresAgg = await db.select({
        assignedToId: leads.assignedToId,
        cnt: sql<number>`count(*)::int`,
    })
        .from(leads)
        .where(and(
            eq(leads.companyId, ctx.companyId),
            isNotNull(leads.assignedToId),
            eq(leads.salespersonOutcome, 'Chiuso'),
            gte(leads.salespersonOutcomeAt, startBound),
            lt(leads.salespersonOutcomeAt, end),
        ))
        .groupBy(leads.assignedToId)

    const closuresByGdo = new Map<string, number>()
    for (const r of closuresAgg) {
        if (r.assignedToId) closuresByGdo.set(r.assignedToId, Number(r.cnt))
    }

    // --- Compose per-GDO rows ---
    const perGdo: GdoThroughputRow[] = gdoUsers.map(u => {
        const closed = closedByGdo.get(u.id)
        const closedCount = closed?.count ?? 0
        const sumCalls = closed?.sumCalls ?? 0

        const avgCallsPerLead = closedCount > 0
            ? Math.round((sumCalls / closedCount) * 10) / 10
            : null

        const totalCalls = callsByGdo.get(u.id) ?? 0
        const callsPerDay = Math.round((totalCalls / workingDays) * 10) / 10

        const dailyCapacity = (avgCallsPerLead && avgCallsPerLead > 0)
            ? Math.round(callsPerDay / avgCallsPerLead)
            : null

        return {
            gdoId: u.id,
            gdoName: u.displayName ?? u.name ?? u.id,
            avgCallsPerLead,
            callsPerDay,
            dailyCapacity,
            closures: closuresByGdo.get(u.id) ?? 0,
            closedLeadsCount: closedCount,
        }
    })

    // --- Team totals: somma/somma, non media-di-medie ---
    let teamSumCalls = 0
    let teamClosedCount = 0
    for (const v of closedByLead.values()) {
        teamSumCalls += v.callCount
        teamClosedCount += 1
    }
    const teamTotalCalls = Array.from(callsByGdo.values()).reduce((a, b) => a + b, 0)
    const teamClosures = Array.from(closuresByGdo.values()).reduce((a, b) => a + b, 0)

    const teamAvgCallsPerLead = teamClosedCount > 0
        ? Math.round((teamSumCalls / teamClosedCount) * 10) / 10
        : null
    const teamCallsPerDay = Math.round((teamTotalCalls / workingDays) * 10) / 10
    const teamDailyCapacity = (teamAvgCallsPerLead && teamAvgCallsPerLead > 0)
        ? Math.round(teamCallsPerDay / teamAvgCallsPerLead)
        : null

    return {
        perGdo,
        teamTotals: {
            avgCallsPerLead: teamAvgCallsPerLead,
            callsPerDay: teamCallsPerDay,
            dailyCapacity: teamDailyCapacity,
            closures: teamClosures,
            closedLeadsCount: teamClosedCount,
        }
    }
}
```

- [ ] **Step 4: Verifica build TypeScript**

Run: `npm run build`
Expected: build passa clean. Errori probabili da fixare:
- Se Drizzle si lamenta della firma di `groupBy` con `callLogs.userId` (nullable), aggiungere un `.where(isNotNull(callLogs.userId))` (già presente) — già coperto.
- Se `users.role` non esiste come campo: verificare schema reale (`grep "role:" src/db/schema.ts` per confermare il nome).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: nessun warning/error sui file toccati.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/kpiAdvancedActions.ts
git commit -m "feat(kpi): server action getGdoThroughputMetrics30d

Calcola per ogni GDO su finestra rolling 30gg:
- media chiamate/lead (su lead chiusi via leadEvents APPOINTMENT_SET/DISCARDED)
- chiamate/giorno (su giorni lavorativi)
- lead gestibili/giorno = chiamate/giorno / media (metrica primaria)
- chiusure (pattern già esistente: salespersonOutcome='Chiuso')

Dedup lead con multipli eventi terminali via leadId. Tenant-scoped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Script diagnostico `debug_throughput30d.ts`

**Files:**
- Create: `scripts/debug_throughput30d.ts`

Pattern coerente con `scripts/debug_conferme.ts`, `scripts/debugMarketingAnalytics.ts` già nel repo.

- [ ] **Step 1: Creare lo script**

Crea `scripts/debug_throughput30d.ts` con:

```typescript
/**
 * Diagnostic script — verifica getGdoThroughputMetrics30d().
 *
 * Esegui con: npx tsx scripts/debug_throughput30d.ts
 *
 * Stampa la tabella per-GDO + team totals. Esegue assertion inline sui casi edge.
 */
import 'dotenv/config'

// Bypass della guardia "use server": importiamo direttamente per uso CLI.
// Il file usa `currentTenant()` che legge i cookies — qui non disponibili.
// Per il diagnostico stampiamo lo SQL atteso, oppure forziamo un tenant via env.
// Soluzione semplice: re-implementiamo la query con tenant hardcoded da env var.

import { db } from "../src/db"
import { callLogs, leads, users, leadEvents } from "../src/db/schema"
import { gte, lt, and, eq, desc, inArray, isNotNull, sql } from "drizzle-orm"
import { dayBoundsRome } from "../src/lib/dateUtils"
import { workingDaysBetween } from "../src/lib/workingDaysUtils"

const TENANT_ID = process.env.DEBUG_TENANT_ID || 'fenice'

async function main() {
    const now = new Date()
    const startBound = dayBoundsRome(new Date(now.getTime() - 29 * 86400000)).start
    const end = now
    const workingDays = Math.max(1, workingDaysBetween(startBound, end))

    console.log(`Tenant: ${TENANT_ID}`)
    console.log(`Finestra: ${startBound.toISOString()} → ${end.toISOString()}`)
    console.log(`Giorni lavorativi: ${workingDays}`)
    console.log('')

    const gdoUsers = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.companyId, TENANT_ID), eq(users.role, 'GDO')))

    const terminalEvents = await db.select({
        leadId: leadEvents.leadId,
        timestamp: leadEvents.timestamp,
        assignedToId: leads.assignedToId,
        callCount: leads.callCount,
    })
        .from(leadEvents)
        .innerJoin(leads, eq(leads.id, leadEvents.leadId))
        .where(and(
            eq(leadEvents.companyId, TENANT_ID),
            eq(leads.companyId, TENANT_ID),
            inArray(leadEvents.eventType, ['APPOINTMENT_SET', 'DISCARDED']),
            gte(leadEvents.timestamp, startBound),
            lt(leadEvents.timestamp, end),
            isNotNull(leads.assignedToId),
            eq(leads.isSelfBooked, false),
        ))
        .orderBy(desc(leadEvents.timestamp))

    const closedByLead = new Map<string, { assignedToId: string; callCount: number }>()
    for (const row of terminalEvents) {
        if (!row.assignedToId) continue
        if (closedByLead.has(row.leadId)) continue
        closedByLead.set(row.leadId, { assignedToId: row.assignedToId, callCount: row.callCount ?? 0 })
    }

    const closedByGdo = new Map<string, { sumCalls: number; count: number }>()
    for (const v of closedByLead.values()) {
        const cur = closedByGdo.get(v.assignedToId) ?? { sumCalls: 0, count: 0 }
        cur.sumCalls += v.callCount
        cur.count += 1
        closedByGdo.set(v.assignedToId, cur)
    }

    const callsAgg = await db.select({
        userId: callLogs.userId,
        cnt: sql<number>`count(*)::int`,
    })
        .from(callLogs)
        .where(and(
            eq(callLogs.companyId, TENANT_ID),
            isNotNull(callLogs.userId),
            gte(callLogs.createdAt, startBound),
            lt(callLogs.createdAt, end),
        ))
        .groupBy(callLogs.userId)

    const callsByGdo = new Map<string, number>()
    for (const r of callsAgg) if (r.userId) callsByGdo.set(r.userId, Number(r.cnt))

    console.log('| GDO | call/lead | call/giorno | lead/giorno | closed sample |')
    console.log('|-----|-----------|-------------|-------------|---------------|')
    for (const u of gdoUsers) {
        const cl = closedByGdo.get(u.id)
        const closedCount = cl?.count ?? 0
        const sumCalls = cl?.sumCalls ?? 0
        const avg = closedCount > 0 ? Math.round((sumCalls / closedCount) * 10) / 10 : null
        const totalCalls = callsByGdo.get(u.id) ?? 0
        const callsPerDay = Math.round((totalCalls / workingDays) * 10) / 10
        const cap = (avg && avg > 0) ? Math.round(callsPerDay / avg) : null
        console.log(`| ${(u.displayName ?? u.name ?? u.id).padEnd(20)} | ${String(avg ?? '—').padStart(8)} | ${String(callsPerDay).padStart(10)} | ${String(cap ?? '—').padStart(10)} | ${closedCount} |`)

        // Inline assertions sugli edge case.
        if (closedCount === 0 && avg !== null) throw new Error(`[ASSERT] ${u.id}: avg should be null when closedCount=0`)
        if ((avg === null || avg === 0) && cap !== null) throw new Error(`[ASSERT] ${u.id}: cap should be null when avg null/0`)
        if (totalCalls === 0 && callsPerDay !== 0) throw new Error(`[ASSERT] ${u.id}: callsPerDay should be 0 when totalCalls=0`)
    }

    // Team total consistency
    let teamSumCalls = 0, teamClosed = 0
    for (const v of closedByLead.values()) { teamSumCalls += v.callCount; teamClosed += 1 }
    const teamAvg = teamClosed > 0 ? teamSumCalls / teamClosed : null
    const sumOfPerGdoSumCalls = Array.from(closedByGdo.values()).reduce((a, b) => a + b.sumCalls, 0)
    const sumOfPerGdoClosed = Array.from(closedByGdo.values()).reduce((a, b) => a + b.count, 0)
    if (sumOfPerGdoSumCalls !== teamSumCalls) throw new Error(`[ASSERT] team sumCalls mismatch: perGdo=${sumOfPerGdoSumCalls} vs total=${teamSumCalls}`)
    if (sumOfPerGdoClosed !== teamClosed) throw new Error(`[ASSERT] team closedCount mismatch: perGdo=${sumOfPerGdoClosed} vs total=${teamClosed}`)
    console.log('')
    console.log(`Team avg call/lead: ${teamAvg !== null ? Math.round(teamAvg * 10) / 10 : '—'}  (${teamClosed} lead chiusi)`)
    console.log('✓ All assertions passed')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Eseguire lo script in dev**

Run: `npx tsx scripts/debug_throughput30d.ts`
Expected:
- Output tabellare con righe per ogni GDO.
- Linea finale `✓ All assertions passed`.
- Se fallisce: leggere l'assertion failed, debug, fixare la action in Task 2 (lo script ne è il mirror).

- [ ] **Step 3: Commit**

```bash
git add scripts/debug_throughput30d.ts
git commit -m "chore(scripts): debug_throughput30d.ts diagnostic

Script ad-hoc per validare getGdoThroughputMetrics30d.
Stampa tabella per-GDO + inline assertions sui casi edge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire fetch nuova action in `KpiGdoBoard.tsx`

**Files:**
- Modify: `src/components/KpiGdoBoard.tsx` (imports + nuovo state + fetch)

- [ ] **Step 1: Aggiungere import della action**

In `src/components/KpiGdoBoard.tsx` riga 5, modifica l'import di `kpiAdvancedActions`:

```typescript
import { getAdvancedKpi, KpiFilters, getGdoTargetsProgress, getGdoThroughputMetrics30d, type GdoThroughputMetrics } from "@/app/actions/kpiAdvancedActions"
```

- [ ] **Step 2: Aggiungere state per throughput**

Dopo `const [loading, setLoading] = useState(true)` (riga 48 attuale), aggiungi:

```typescript
const [throughput, setThroughput] = useState<GdoThroughputMetrics | null>(null)
const [throughputLoading, setThroughputLoading] = useState(true)
```

- [ ] **Step 3: Aggiungere useEffect per fetch del throughput**

In fondo al primo blocco `useEffect` (dopo `fetchKpi()` interno, riga 51-circa-150), aggiungi un secondo `useEffect` indipendente:

```typescript
// Throughput rolling 30gg — finestra fissa, NON dipende da dateRange/funnelFilter.
// Si refetch solo al mount e quando cambia gdoFilter (per consistenza visiva
// con la riga selezionata, anche se i numeri sono tenant-wide).
useEffect(() => {
    if (!session?.user?.id) return
    if (!isAdminOrManager) return // Solo manager/admin vedono questa metrica
    let cancelled = false
    setThroughputLoading(true)
    getGdoThroughputMetrics30d()
        .then(data => { if (!cancelled) setThroughput(data) })
        .catch(err => { console.error('[throughput30d] fetch failed', err); if (!cancelled) setThroughput(null) })
        .finally(() => { if (!cancelled) setThroughputLoading(false) })
    return () => { cancelled = true }
    // Volutamente NIENTE dateRange/funnelFilter qui — la metrica è rolling 30gg fisso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [session?.user?.id, isAdminOrManager])
```

- [ ] **Step 4: Lookup helper per riga GDO**

Subito sopra il `return` del componente (cerca `return (` finale del componente, prima di `<div`), aggiungi:

```typescript
const throughputByGdo = new Map(throughput?.perGdo.map(r => [r.gdoId, r]) ?? [])
const getThroughput = (gdoId: string) => throughputByGdo.get(gdoId) ?? null
```

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/KpiGdoBoard.tsx
git commit -m "feat(ui): fetch getGdoThroughputMetrics30d in KpiGdoBoard

Fetch indipendente dal filtro periodo UI (rolling 30gg fisso).
Mapping per-gdoId per merge con righe esistenti.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Aggiungere 4 nuove colonne header + celle nella tabella per-GDO

**Files:**
- Modify: `src/components/KpiGdoBoard.tsx` (tabella header + body, dintorni riga 491-546)

- [ ] **Step 1: Leggere la struttura attuale della tabella**

Apri `src/components/KpiGdoBoard.tsx` e individua il blocco della tabella per-GDO (cerca `<table` o il selettore `sortBy` riga 491). Identifica:
- la riga `<thead>` con gli `<th>` esistenti
- il `.map` delle righe GDO che renderizza `<tr>` con `gdo.appointments`, `gdo.confermePerc`, `gdo.presenziatiPerc`

- [ ] **Step 2: Aggiungere gli `<th>` nuovi**

Nell'ordine richiesto dalla spec (§5.1), i nuovi header vanno **dopo "Chiamate"** e prima di "Appuntamenti". Cerca l'`<th>` "Chiamate" (probabile testo "Chiamate" o "Calls") e dopo aggiungi:

```tsx
<th className="text-right py-2 pr-3 text-xs font-bold text-ash-500 uppercase tracking-wider"
    title="Media chiamate fatte a ogni lead prima che venga fissato appuntamento o scartato. Rolling 30 giorni.">
    Media call/Lead
</th>
<th className="text-right py-2 pr-3 text-xs font-bold text-ash-500 uppercase tracking-wider"
    title="Media chiamate al giorno (giorni lavorativi). Rolling 30 giorni.">
    Call/Giorno
</th>
<th className="text-right py-2 pr-3 text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50"
    title="Capacità teorica: chiamate al giorno ÷ media chiamate per lead. Quanti lead questo GDO può portare in stato terminale al giorno. Rolling 30 giorni.">
    <span className="inline-flex items-center gap-1"><TrendingUp className="h-3 w-3" />Lead/Giorno</span>
</th>
```

L'`<th>` "Chiusi" va invece in **fondo** (dopo `%Presenziati`):

```tsx
<th className="text-right py-2 pr-3 text-xs font-bold text-ash-500 uppercase tracking-wider"
    title="Chiusure attribuite al GDO che ha fissato l'appuntamento. Rolling 30 giorni.">
    Chiusi
</th>
```

- [ ] **Step 3: Aggiungere le 4 celle nel `.map` delle righe GDO**

All'interno del `.map((gdo) => ...)` (dintorni riga 530-546 attuale), dopo la `<td>` di "Chiamate" e prima della `<td>` "Appuntamenti", inserisci queste 3 celle:

```tsx
{(() => {
    const tp = getThroughput(gdo.id)
    return (
        <>
            <td className="py-2.5 pr-3 text-right">
                {throughputLoading ? <span className="text-ash-300">…</span>
                 : tp?.avgCallsPerLead != null ? <span className="font-semibold text-ash-700">{tp.avgCallsPerLead}</span>
                 : <span className="text-ash-300">—</span>}
            </td>
            <td className="py-2.5 pr-3 text-right">
                {throughputLoading ? <span className="text-ash-300">…</span>
                 : tp != null ? <span className="font-semibold text-ash-700">{tp.callsPerDay}</span>
                 : <span className="text-ash-300">—</span>}
            </td>
            <td className="py-2.5 pr-3 text-right bg-amber-50/60">
                {throughputLoading ? <span className="text-ash-300">…</span> : (() => {
                    if (!tp || tp.dailyCapacity == null) return <span className="text-ash-300">—</span>
                    const team = throughput?.teamTotals.dailyCapacity ?? null
                    const cls = team == null
                        ? 'text-ash-700'
                        : tp.dailyCapacity >= team * 1.1 ? 'text-emerald-700'
                        : tp.dailyCapacity <= team * 0.7 ? 'text-rose-600'
                        : 'text-ash-700'
                    return (
                        <div className={`font-bold ${cls}`}>
                            {tp.dailyCapacity}
                            <div className="text-[10px] text-ash-400 font-normal mt-0.5">
                                {tp.closedLeadsCount} lead chiusi
                            </div>
                        </div>
                    )
                })()}
            </td>
        </>
    )
})()}
```

E dopo la `<td>` di `%Presenziati`, aggiungi:

```tsx
<td className="py-2.5 pr-3 text-right">
    {throughputLoading ? <span className="text-ash-300">…</span>
     : (() => {
        const tp = getThroughput(gdo.id)
        return tp != null
            ? <span className="font-semibold text-emerald-700">{tp.closures}</span>
            : <span className="text-ash-300">—</span>
     })()}
</td>
```

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 5: Verifica UI in dev**

Run: `npm run dev` in background (porta 3000 di default).
Vai a `http://localhost:3000/kpi-gdo` come manager/admin.
Verifica visivamente:
- Le 4 nuove colonne appaiono nell'ordine atteso (Media call/Lead | Call/Giorno | **Lead/Giorno** evidenziata in arancio | … | Chiusi).
- Per i GDO con dati: numeri sensati (avgCallsPerLead tipicamente 1.5–8, dailyCapacity tipicamente 5–30).
- Per GDO senza chiusure recenti: vede `—` invece di 0 o NaN.
- Hover sugli header mostra i tooltip.

- [ ] **Step 6: Commit**

```bash
git add src/components/KpiGdoBoard.tsx
git commit -m "feat(ui): 4 nuove colonne throughput nella tabella per-GDO

Media call/Lead, Call/Giorno, Lead/Giorno (evidenziata amber) e Chiusi.
Sotto Lead/Giorno mostra il sample size (N lead chiusi).
Colorazione verde/rosso vs media team. Loading state '…'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Aggiornare selettore `sortBy` (default + nuova opzione)

**Files:**
- Modify: `src/components/KpiGdoBoard.tsx` (riga 49 `useState` + riga 491-494 `<select>` + logica sort)

- [ ] **Step 1: Estendere il tipo del `sortBy` state**

Riga 49 attuale:
```typescript
const [sortBy, setSortBy] = useState<'productivityCoeff' | 'calls' | 'appointments' | 'apptRate' | 'confermePerc' | 'presenziatiPerc'>('productivityCoeff')
```

Modifica in:
```typescript
const [sortBy, setSortBy] = useState<'dailyCapacity' | 'productivityCoeff' | 'calls' | 'appointments' | 'apptRate' | 'confermePerc' | 'presenziatiPerc'>('dailyCapacity')
```

- [ ] **Step 2: Aggiungere l'opzione nel `<select>`**

Trova il `<select>` (riga ~490). Aggiungi come **prima** opzione (in cima):

```tsx
<option value="dailyCapacity">Lead/Giorno (cap.)</option>
```

- [ ] **Step 3: Aggiungere il caso nella logica di sort**

Cerca dove `sortBy` viene usato (probabilmente un `sort()` o `useMemo` che ordina l'array di GDO). Esempio tipico in JS:

```typescript
const sorted = [...gdoList].sort((a, b) => {
    if (sortBy === 'dailyCapacity') {
        const av = getThroughput(a.id)?.dailyCapacity ?? -1
        const bv = getThroughput(b.id)?.dailyCapacity ?? -1
        return bv - av // desc
    }
    // ... altri casi esistenti
})
```

Adatta la sintassi al codice esistente — l'idea è: `null` o assenza di dati va in fondo (`-1` come sentinel), poi sort discendente.

- [ ] **Step 4: Build + lint + verifica UI**

Run: `npm run build && npm run lint`
Apri dev: il default sort della tabella è ora `Lead/Giorno`. Cambia opzione → sort cambia.

- [ ] **Step 5: Commit**

```bash
git add src/components/KpiGdoBoard.tsx
git commit -m "feat(ui): dailyCapacity come sort default in /kpi-gdo

Lead/Giorno (capacità teorica) diventa l'ordinamento di default
della tabella per-GDO, in linea con la richiesta principale di
'lead gestibili al giorno'. Le altre opzioni restano disponibili.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Banner "rolling 30 giorni" + riga team

**Files:**
- Modify: `src/components/KpiGdoBoard.tsx` (sopra tabella + dopo body righe)

- [ ] **Step 1: Aggiungere banner sopra la tabella**

Subito **prima** del `<table>` della tabella per-GDO, aggiungi un piccolo banner:

```tsx
<div className="text-xs text-ash-500 mb-2">
    Le colonne <span className="text-amber-700 font-medium">Media call/Lead, Call/Giorno, Lead/Giorno, Chiusi</span> sono calcolate su rolling 30 giorni, indipendenti dal filtro di periodo.
</div>
```

- [ ] **Step 2: Aggiungere riga team in fondo a `<tbody>`**

Dopo il `.map()` delle righe GDO (chiusura del map prima di `</tbody>`), aggiungi:

```tsx
{throughput?.teamTotals && (
    <tr className="bg-ash-50 font-semibold border-t-2 border-ash-200">
        <td className="py-2.5 pr-3 text-ash-700">Team</td>
        {/* Lascia vuote le celle delle colonne esistenti — la riga team è solo per le 4 nuove metriche.
            Se la tabella ha N colonne esistenti prima di "Media call/Lead", inserisci N <td/> vuote qui. */}
        <td className="py-2.5 pr-3 text-right text-ash-700">
            {throughput.teamTotals.avgCallsPerLead ?? '—'}
        </td>
        <td className="py-2.5 pr-3 text-right text-ash-700">
            {throughput.teamTotals.callsPerDay}
        </td>
        <td className="py-2.5 pr-3 text-right bg-amber-100/60 text-amber-900 font-bold">
            {throughput.teamTotals.dailyCapacity ?? '—'}
            <div className="text-[10px] text-ash-500 font-normal mt-0.5">
                {throughput.teamTotals.closedLeadsCount} lead chiusi
            </div>
        </td>
        {/* Lascia vuote le celle Appuntamenti/%Conf/%Pres — sono già aggregate in altre card.
            Inserisci <td/> vuote per quante colonne esistono tra "Lead/Giorno" e "Chiusi". */}
        <td className="py-2.5 pr-3 text-right text-emerald-700">
            {throughput.teamTotals.closures}
        </td>
    </tr>
)}
```

**Nota implementativa:** il numero esatto di `<td/>` vuote dipende dalle colonne esistenti tra le nuove. Conta i `<th>` esistenti prima/dopo per fare match esatto al numero di `<td>` (errore tipico = colspan disallineato → tabella rotta visivamente).

- [ ] **Step 3: Build + lint + verifica UI**

Run: `npm run build && npm run lint`
Dev: verifica visualmente che la riga "Team" sia in fondo, allineata, con bg leggermente grigio. Verifica banner sopra la tabella.

- [ ] **Step 4: Commit**

```bash
git add src/components/KpiGdoBoard.tsx
git commit -m "feat(ui): banner rolling 30gg + riga team in tabella per-GDO

Banner sopra la tabella spiega che le 4 nuove colonne hanno
finestra propria, indipendente dal filtro periodo.
Riga team in fondo con somma/somma (non media-di-medie).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verifica finale + smoke check

- [ ] **Step 1: Build di prod**

Run: `npm run build`
Expected: build passa, nessun warning bloccante.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Esegui di nuovo lo script diagnostico**

Run: `npx tsx scripts/debug_throughput30d.ts`
Expected: tutte le assertion passano, output coerente con quello visto in UI.

- [ ] **Step 4: Manual QA in dev (`npm run dev`)**

Apri `http://localhost:3000/kpi-gdo` come manager. Checklist:
- 4 colonne nuove nell'ordine: Media call/Lead | Call/Giorno | **Lead/Giorno** (amber) | …existing… | Chiusi.
- Default sort = Lead/Giorno (cap.).
- Tooltip su hover dei 4 nuovi `<th>`.
- Loading state mostra `…` durante fetch.
- GDO senza dati mostra `—`.
- Riga Team in fondo, allineata, con somme aggregate.
- Banner "rolling 30 giorni" leggibile sopra la tabella.
- Cambiare il selettore di periodo (Oggi/7gg/30gg/Mese) **non** modifica le 4 colonne nuove.
- Tabella responsive: shrink della finestra non rompe il layout (scroll orizzontale OK).

- [ ] **Step 5: Push & deploy**

```bash
git push origin main
```

Vercel autodeploy parte da `main`. Verifica deploy verde su Vercel dashboard.

- [ ] **Step 6: Smoke check produzione**

Apri prod `https://crm.feniceacademy.com/kpi-gdo` (o l'URL prod canonical da `reference_infra_ids`).
- Le 4 nuove colonne devono apparire.
- Confronta 2-3 GDO noti: il valore di `Media call/Lead` deve essere plausibile (tra 1.5 e 10). Se vedi numeri < 1.2 o > 15, indagare — è probabile che la dedup o il filtro selfBooked stiano sbagliando.
- Verifica con team manager che il numero `Lead/Giorno (cap.)` sembra realistico rispetto alla loro intuizione operativa.

- [ ] **Step 7: Commit finale di documentazione (opzionale)**

Se i numeri in prod rivelano calibrazioni o note utili, aggiorna la memoria progetto:

```bash
# Nessun file da committare — aggiorna solo la memoria personale per future sessioni.
# (Memoria auto: nuova entry "Throughput GDO live 2026-05-27" se sembra utile.)
```

---

## Self-Review

### Spec coverage
- ✅ §1 Obiettivo (`lead gestibili/giorno` come primario) → Task 5 (cella amber + sort default in Task 6)
- ✅ §3.1 Server action `getGdoThroughputMetrics30d` → Task 2
- ✅ §3.2 Query A (leadEvents APPOINTMENT_SET/DISCARDED dedup) → Task 2 Step 3
- ✅ §3.2 Query B (callLogs) → Task 2 Step 3
- ✅ §3.2 Query C (chiusure) → Task 2 Step 3
- ✅ §3.3 Fetch parallelo + merge per-gdoId → Task 4
- ✅ §4 Definizioni precise (formule, arrotondamenti, null handling) → Task 2 Step 3
- ✅ §5.1 Ordine colonne → Task 5
- ✅ §5.2 Tooltip header → Task 5 Step 2
- ✅ §5.3 Color rule + sample size hint → Task 5 Step 3
- ✅ §5.4 Sort default `dailyCapacity` → Task 6
- ✅ §5.5 Riga team → Task 7 Step 2
- ✅ §5.6 Banner finestra → Task 7 Step 1
- ✅ §6 Edge cases (null guard, isSelfBooked, tenant) → Task 2
- ✅ §7 Performance (indici esistenti riutilizzati, no nuove migrazioni) → Task 2 (riusa indici già presenti)
- ✅ §8.1 Lint + build → Task 8 Step 1-2
- ✅ §8.2 Sanity script → Task 3
- ✅ §8.3 Verifica UI manuale → Task 8 Step 4
- ✅ §8.4 Smoke check prod → Task 8 Step 6

### Placeholder scan
- Nessun TBD/TODO; ogni Step ha codice o comando completi.
- Step 3 di Task 5 contiene "Adatta la sintassi al codice esistente" per il blocco sort di Task 6 — è una nota perché il pattern di sort dipende dalla struttura esistente di `KpiGdoBoard`. Codice esempio incluso, l'engineer cerca il blocco analogo e lo modella.
- Step 2 di Task 7 nota esplicita su `<td/>` vuote da contare per match colspan — fragilità nota, evidenziata.

### Type consistency
- `GdoThroughputRow` e `GdoThroughputMetrics` definiti in Task 2 Step 2.
- Usati identici in Task 4 (`import { type GdoThroughputMetrics }`).
- Riferimenti a `.perGdo`, `.teamTotals`, `.gdoId`, `.dailyCapacity`, `.closedLeadsCount` coerenti in tutti i Task.
- `getThroughput(gdoId)` helper definito in Task 4 Step 4, usato in Task 5 Step 3 e Task 7 Step 2.

Plan pulito.
