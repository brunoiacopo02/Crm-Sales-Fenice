# Monitor Lancio Black Summer in /appuntamenti-oggi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pannello di monitoraggio del lancio Black Summer nella pagina `/appuntamenti-oggi`: quanti lead BS chiamati almeno una volta, fissati, confermati e chiusi — sia oggi sia cumulativo dall'inizio del lancio, con percentuali di conversione.

**Architecture:** Funzione di aggregazione server-side in `src/lib/blackSummerStats.ts` (poche query Drizzle con `count(*) FILTER`), componente presentazionale `BlackSummerLaunchPanel`, montato nella pagina server `/appuntamenti-oggi` sopra la lista appuntamenti riusando i bounds giornalieri Europe/Rome già calcolati lì.

**Tech Stack:** Next.js App Router (server component), Drizzle ORM, Tailwind.

## Global Constraints

- Perimetro lancio: `leads.funnel = 'Black Summer'` AND `leads.companyId = 'fenice'` (include sia i lead distribuiti dal pool sia i 33 caricati dal TL e bonificati oggi).
- Definizioni metriche (canon del progetto, `src/lib/kpi/canon.ts` + campi reali):
  - **Chiamati ≥1** — cumulativo: `callCount >= 1`; oggi: lead BS distinti con riga in `callLogs` con `createdAt` nei bounds odierni.
  - **Fissati** — cumulativo: `appointmentCreatedAt IS NOT NULL`; oggi: `appointmentCreatedAt` nei bounds odierni (stessa definizione della lista "Appuntamenti Fissati Oggi" della pagina, per coerenza tra pannello e lista).
  - **Confermati** — cumulativo: `confirmationsOutcome = 'confermato'`; oggi: confermato con `confirmationsTimestamp` nei bounds.
  - **Chiusi** — cumulativo: `salespersonOutcome = 'Chiuso'`; oggi: chiuso con `salespersonOutcomeAt` nei bounds.
  - Contesto: totale lancio, assegnati (`assignedToId IS NOT NULL`), pool residuo (non assegnati).
- Percentuali: ogni stadio mostra la conversione sullo stadio precedente (chiamati % su assegnati, fissati % su chiamati, confermati % su fissati, chiusi % su fissati). Percentuale = 0 quando il denominatore è 0 (mai NaN/∞).
- Il pannello si nasconde se il lancio non ha lead (count totale 0).
- Bounds giornalieri: riusare ESATTAMENTE il calcolo Europe/Rome già presente in `src/app/(dashboard)/appuntamenti-oggi/page.tsx:23-27` (todayStart/todayEnd), passandoli alla funzione stats.
- Solo lettura: nessuna mutazione, nessun evento.
- Tailwind ordinato, tema ambra coerente con la card pool Black Summer; bottoni mai figli di `<span>`/`<p>` (qui non servono bottoni).
- Verifica: `npm run build` verde (nessuna unit-test infra; smoke E2E in prod dopo deploy).

---

### Task 1: `getBlackSummerLaunchStats` + `BlackSummerLaunchPanel` + mount

**Files:**
- Create: `src/lib/blackSummerStats.ts`
- Create: `src/components/BlackSummerLaunchPanel.tsx`
- Modify: `src/app/(dashboard)/appuntamenti-oggi/page.tsx` (import + chiamata stats + mount pannello tra header e lista)

**Interfaces:**
- Produces: `getBlackSummerLaunchStats(todayStart: Date, todayEnd: Date): Promise<BlackSummerLaunchStats>` e componente `<BlackSummerLaunchPanel stats={stats} />`.

- [ ] **Step 1: Crea `src/lib/blackSummerStats.ts`**

```ts
import { db } from "@/db"
import { leads, callLogs } from "@/db/schema"
import { and, eq, gte, lte, sql } from "drizzle-orm"

const BS_FUNNEL = 'Black Summer'
const BS_COMPANY = 'fenice'

export type BlackSummerStageStats = {
    chiamati: number
    fissati: number
    confermati: number
    chiusi: number
}

export type BlackSummerLaunchStats = {
    totale: number
    assegnati: number
    poolResiduo: number
    oggi: BlackSummerStageStats
    totaleLancio: BlackSummerStageStats
}

/**
 * Statistiche del lancio Black Summer per il pannello di /appuntamenti-oggi.
 * Perimetro: funnel 'Black Summer' + company fenice (lead dal pool E caricati
 * a mano dal TL, bonificati 2026-07-13). Definizioni allineate al canon:
 * fissati = appointmentCreatedAt (stessa base della lista "Fissati Oggi"),
 * confermati = confirmationsOutcome 'confermato', chiusi = salespersonOutcome
 * 'Chiuso'. Sola lettura.
 */
export async function getBlackSummerLaunchStats(todayStart: Date, todayEnd: Date): Promise<BlackSummerLaunchStats> {
    const base = and(eq(leads.companyId, BS_COMPANY), eq(leads.funnel, BS_FUNNEL))

    const [agg] = await db
        .select({
            totale: sql<number>`count(*)::int`,
            assegnati: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NOT NULL)::int`,
            poolResiduo: sql<number>`count(*) FILTER (WHERE ${leads.assignedToId} IS NULL)::int`,
            chiamatiTot: sql<number>`count(*) FILTER (WHERE ${leads.callCount} >= 1)::int`,
            fissatiTot: sql<number>`count(*) FILTER (WHERE ${leads.appointmentCreatedAt} IS NOT NULL)::int`,
            confermatiTot: sql<number>`count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato')::int`,
            chiusiTot: sql<number>`count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso')::int`,
            fissatiOggi: sql<number>`count(*) FILTER (WHERE ${leads.appointmentCreatedAt} >= ${todayStart} AND ${leads.appointmentCreatedAt} <= ${todayEnd})::int`,
            confermatiOggi: sql<number>`count(*) FILTER (WHERE ${leads.confirmationsOutcome} = 'confermato' AND ${leads.confirmationsTimestamp} >= ${todayStart} AND ${leads.confirmationsTimestamp} <= ${todayEnd})::int`,
            chiusiOggi: sql<number>`count(*) FILTER (WHERE ${leads.salespersonOutcome} = 'Chiuso' AND ${leads.salespersonOutcomeAt} >= ${todayStart} AND ${leads.salespersonOutcomeAt} <= ${todayEnd})::int`,
        })
        .from(leads)
        .where(base)

    // Chiamati oggi: lead BS distinti con almeno un callLog odierno.
    const [chiamatiOggiRow] = await db
        .select({ n: sql<number>`count(DISTINCT ${callLogs.leadId})::int` })
        .from(callLogs)
        .innerJoin(leads, eq(callLogs.leadId, leads.id))
        .where(and(
            base,
            gte(callLogs.createdAt, todayStart),
            lte(callLogs.createdAt, todayEnd),
        ))

    return {
        totale: agg?.totale ?? 0,
        assegnati: agg?.assegnati ?? 0,
        poolResiduo: agg?.poolResiduo ?? 0,
        oggi: {
            chiamati: chiamatiOggiRow?.n ?? 0,
            fissati: agg?.fissatiOggi ?? 0,
            confermati: agg?.confermatiOggi ?? 0,
            chiusi: agg?.chiusiOggi ?? 0,
        },
        totaleLancio: {
            chiamati: agg?.chiamatiTot ?? 0,
            fissati: agg?.fissatiTot ?? 0,
            confermati: agg?.confermatiTot ?? 0,
            chiusi: agg?.chiusiTot ?? 0,
        },
    }
}
```

- [ ] **Step 2: Crea `src/components/BlackSummerLaunchPanel.tsx`** (presentazionale, nessun "use client")

```tsx
import { Sun, PhoneCall, CalendarCheck, BadgeCheck, Trophy } from "lucide-react"
import type { BlackSummerLaunchStats, BlackSummerStageStats } from "@/lib/blackSummerStats"

function pct(num: number, den: number): string {
    if (den <= 0) return '0%'
    return `${Math.round((num / den) * 100)}%`
}

function StageRow({ label, stats, denomChiamati }: { label: string; stats: BlackSummerStageStats; denomChiamati: number }) {
    const cells = [
        { icon: PhoneCall, name: 'Chiamati ≥1', value: stats.chiamati, sub: denomChiamati > 0 ? `${pct(stats.chiamati, denomChiamati)} degli assegnati` : null, color: 'text-sky-600' },
        { icon: CalendarCheck, name: 'Fissati', value: stats.fissati, sub: `${pct(stats.fissati, stats.chiamati)} dei chiamati`, color: 'text-amber-600' },
        { icon: BadgeCheck, name: 'Confermati', value: stats.confermati, sub: `${pct(stats.confermati, stats.fissati)} dei fissati`, color: 'text-emerald-600' },
        { icon: Trophy, name: 'Chiusi', value: stats.chiusi, sub: `${pct(stats.chiusi, stats.fissati)} dei fissati`, color: 'text-purple-600' },
    ]
    return (
        <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-ash-500 mb-2">{label}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {cells.map((c) => (
                    <div key={c.name} className="bg-white rounded-lg border border-amber-100 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ash-500">
                            <c.icon className={`h-3.5 w-3.5 ${c.color}`} />
                            {c.name}
                        </div>
                        <div className="text-2xl font-black text-ash-900 mt-1">{c.value}</div>
                        {c.sub && <div className="text-[11px] text-ash-500 mt-0.5">{c.sub}</div>}
                    </div>
                ))}
            </div>
        </div>
    )
}

export function BlackSummerLaunchPanel({ stats }: { stats: BlackSummerLaunchStats }) {
    if (stats.totale === 0) return null
    return (
        <div className="bg-gradient-to-br from-amber-50 to-white rounded-2xl border-2 border-amber-300 shadow-sm p-5 space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-amber-500 text-white flex items-center justify-center">
                        <Sun className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-ash-900">Monitor Lancio Black Summer</h2>
                        <div className="text-xs text-ash-500">Funnel &quot;Black Summer&quot; — dal pool e caricati a mano.</div>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs font-semibold">
                    <div className="bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-ash-700">Totale lancio: <strong className="text-ash-900">{stats.totale}</strong></div>
                    <div className="bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-ash-700">Assegnati: <strong className="text-ash-900">{stats.assegnati}</strong></div>
                    <div className="bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-ash-700">Nel pool: <strong className="text-ash-900">{stats.poolResiduo}</strong></div>
                </div>
            </div>
            <StageRow label="Oggi" stats={stats.oggi} denomChiamati={0} />
            <StageRow label="Totale lancio" stats={stats.totaleLancio} denomChiamati={stats.assegnati} />
        </div>
    )
}
```

Nota: nella riga "Oggi" il sub della cella Chiamati è omesso (denomChiamati=0 → sub null) perché la percentuale sugli assegnati ha senso solo cumulativa; le altre percentuali odierne (fissati/chiamati ecc.) restano.

- [ ] **Step 3: Mount in `src/app/(dashboard)/appuntamenti-oggi/page.tsx`**

- Import: `import { getBlackSummerLaunchStats } from "@/lib/blackSummerStats"` e `import { BlackSummerLaunchPanel } from "@/components/BlackSummerLaunchPanel"`.
- Dopo il calcolo `todayStart`/`todayEnd` (riga ~27) e la query `todayAppointments`, aggiungi: `const bsStats = await getBlackSummerLaunchStats(todayStart, todayEnd)`.
- Nel JSX, subito DOPO il blocco Header (chiude riga ~89) e PRIMA della lista appuntamenti, monta `<BlackSummerLaunchPanel stats={bsStats} />`.

- [ ] **Step 4: Verifica build**

Run: `npm run build`
Expected: verde, nessun warning nuovo sui 3 file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blackSummerStats.ts src/components/BlackSummerLaunchPanel.tsx "src/app/(dashboard)/appuntamenti-oggi/page.tsx"
git commit -m "feat(black-summer): monitor lancio in /appuntamenti-oggi — oggi + cumulativo con conversioni"
```

---

### Task 2: Deploy + verifica E2E prod

- [ ] Push su main, attesa deploy Ready.
- [ ] Smoke: `/appuntamenti-oggi` mostra il pannello con Totale 2818 (2785 pool + 33 TL), Assegnati ≥ 33, coerenza "Fissati oggi" pannello vs contatore lista della pagina; percentuali senza NaN.
