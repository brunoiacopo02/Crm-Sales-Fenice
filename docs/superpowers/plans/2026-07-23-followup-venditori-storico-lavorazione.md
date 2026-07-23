# Follow-up Venditori (Sposta / Storico / In lavorazione) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** I venditori possono spostare data/ora di un follow-up senza consumare esiti, consultare uno Storico trattative filtrabile per esito (con riapertura dei non-Chiusi), e parcheggiare lead "In lavorazione" senza data precisa.

**Architecture:** Approccio A della spec `docs/superpowers/specs/2026-07-23-followup-venditori-storico-lavorazione-design.md`: 2 colonne nuove su `leads` (`inLavorazioneAt`, `salesCycleStartAt`), `salesAttempts` mai riscritta. Fonte di verità del follow-up pendente = `leads.followUp1Date`. Il tetto 3 conta solo gli attempt `Non chiuso` con `outcomeAt >= salesCycleStartAt` (null = tutti, identico a oggi).

**Tech Stack:** Next.js App Router, Drizzle ORM (mai SQL raw nel codice app), Supabase Postgres, Tailwind, node:test via tsx per le lib pure.

## Global Constraints

- La spec dice "migrazione 0024" ma `0024_leads_bucket_accontact_uq.sql` esiste già → la migrazione è **0025**.
- Migrazioni scritte A MANO in `drizzle/migrations/` e applicate in prod via MCP Supabase `apply_migration` (drizzle-kit generate è inutilizzabile in questo repo).
- Esiti validi: `Chiuso` | `Non chiuso` | `Sparito`. `Perso` esiste solo in dati legacy (nello Storico va mostrato sotto "Non chiuso").
- Bottoni interattivi MAI child di `<span>`/`<p>` (CLAUDE.md — rischio WSOD).
- Date da `<input type="datetime-local">` → SEMPRE `parseRomeDatetimeLocal`/`toRomeDatetimeLocal` da `@/lib/dateUtils`.
- `salesAttempts` non si tocca (né schema né righe esistenti). Nessuna gamification nuova. Nessun canale realtime nuovo.
- Test: `npm test` (node --import tsx --test). Build: `npm run build`.
- Commit frequenti su `main`, messaggi in italiano stile repo (`feat(venditore): ...`), footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migrazione 0025 + colonne schema

**Files:**
- Create: `drizzle/migrations/0025_leads_in_lavorazione_cycle.sql`
- Modify: `src/db/schema.ts` (dopo `followUp2Date`, riga ~184)

**Interfaces:**
- Produces: `leads.inLavorazioneAt: Date | null`, `leads.salesCycleStartAt: Date | null` (Drizzle timestamp withTimezone mode date) — usati da tutti i task successivi.

- [ ] **Step 1: Scrivi la migrazione**

```sql
-- Follow-up venditori (spec 2026-07-23-followup-venditori-storico-lavorazione).
-- inLavorazioneAt: se valorizzato il lead è parcheggiato "In lavorazione"
--   (senza data follow-up precisa) ed esce dai bucket Scaduti/Oggi/Prossimi.
-- salesCycleStartAt: valorizzato alla riapertura dallo Storico; il tetto dei
--   3 follow-up conta solo i salesAttempts con outcomeAt >= questa data.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "inLavorazioneAt" timestamptz;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "salesCycleStartAt" timestamptz;
```

- [ ] **Step 2: Aggiungi le colonne a `src/db/schema.ts`**

Subito dopo la riga `followUp2Date: timestamp('followUp2Date', { withTimezone: true, mode: 'date' }),`:

```ts
    // "In lavorazione" (spec 2026-07-23): se valorizzato il lead è parcheggiato
    // senza data follow-up precisa ed esce dai bucket Scaduti/Oggi/Prossimi.
    inLavorazioneAt: timestamp('inLavorazioneAt', { withTimezone: true, mode: 'date' }),
    // Riapertura trattativa dallo Storico: inizio del ciclo corrente. Il tetto
    // dei 3 follow-up conta solo gli attempt con outcomeAt >= questa data.
    salesCycleStartAt: timestamp('salesCycleStartAt', { withTimezone: true, mode: 'date' }),
```

- [ ] **Step 3: Applica la migrazione in produzione**

Usa il tool MCP `mcp__supabase__apply_migration` con name `leads_in_lavorazione_cycle` e come query il contenuto del file SQL. Poi verifica con `mcp__supabase__execute_sql`: `SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name IN ('inLavorazioneAt','salesCycleStartAt');` → attese 2 righe.

- [ ] **Step 4: Verifica che il progetto compili** — `npx tsc --noEmit` (o `npm run build` se veloce). Atteso: nessun errore nuovo.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0025_leads_in_lavorazione_cycle.sql src/db/schema.ts
git commit -m "feat(venditore): colonne inLavorazioneAt + salesCycleStartAt su leads (migr. 0025)"
```

---

### Task 2: Helper puro `countCycleNonClosed` (TDD)

**Files:**
- Modify: `src/lib/venditorePerformance/guard.ts`
- Test: `src/lib/venditorePerformance/guard.test.ts`

**Interfaces:**
- Produces: `countCycleNonClosed(attempts: Array<{ outcome: string; outcomeAt: Date | null }>, cycleStartAt: Date | null): number` — usato da Task 3 (saveVenditoreOutcome, getVenditoreFollowUps).
- `validateOutcomeTransition` NON cambia firma.

- [ ] **Step 1: Scrivi i test che falliscono** (append a `guard.test.ts`)

```ts
import { countCycleNonClosed } from './guard.ts';

test('countCycleNonClosed senza ciclo → conta tutti i Non chiuso', () => {
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-01T10:00:00Z') },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-05T10:00:00Z') },
        { outcome: 'Sparito', outcomeAt: new Date('2026-07-10T10:00:00Z') },
    ], null);
    assert.equal(n, 2);
});

test('countCycleNonClosed con riapertura → conta solo gli attempt del nuovo ciclo', () => {
    const cycleStart = new Date('2026-07-15T00:00:00Z');
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-01T10:00:00Z') },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-05T10:00:00Z') },
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-20T10:00:00Z') },
    ], cycleStart);
    assert.equal(n, 1);
});

test('countCycleNonClosed: attempt con outcomeAt esattamente a cycleStart conta nel nuovo ciclo', () => {
    const cycleStart = new Date('2026-07-15T00:00:00Z');
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: new Date('2026-07-15T00:00:00Z') },
    ], cycleStart);
    assert.equal(n, 1);
});

test('countCycleNonClosed: outcomeAt null con ciclo attivo NON conta', () => {
    const n = countCycleNonClosed([
        { outcome: 'Non chiuso', outcomeAt: null },
    ], new Date('2026-07-15T00:00:00Z'));
    assert.equal(n, 0);
});
```

(Nota: `assert` e `test` sono già importati in testa al file.)

- [ ] **Step 2: Verifica che falliscano** — Run: `npm test`. Atteso: FAIL con "countCycleNonClosed is not a function" / export mancante.

- [ ] **Step 3: Implementa in `guard.ts`** (append in fondo)

```ts
// Conta i 'Non chiuso' del CICLO CORRENTE: dopo una riapertura dallo Storico
// (leads.salesCycleStartAt valorizzato) il tetto MAX_FOLLOW_UPS riparte,
// contando solo gli attempt con outcomeAt >= cycleStartAt. cycleStartAt null
// = nessuna riapertura = comportamento storico (conta tutto).
export function countCycleNonClosed(
    attempts: Array<{ outcome: string; outcomeAt: Date | null }>,
    cycleStartAt: Date | null,
): number {
    return attempts.filter(a =>
        a.outcome === 'Non chiuso'
        && (!cycleStartAt || (a.outcomeAt !== null && a.outcomeAt >= cycleStartAt))
    ).length;
}
```

- [ ] **Step 4: Verifica che passino** — Run: `npm test`. Atteso: PASS (tutti, inclusi i 6 preesistenti + 2 di aggregate).

- [ ] **Step 5: Commit**

```bash
git add src/lib/venditorePerformance/guard.ts src/lib/venditorePerformance/guard.test.ts
git commit -m "feat(venditore): countCycleNonClosed — tetto follow-up per ciclo di trattativa"
```

---

### Task 3: saveVenditoreOutcome ciclo-aware + refactor getVenditoreFollowUps

**Files:**
- Modify: `src/app/actions/venditoreActions.ts`

**Interfaces:**
- Consumes: `countCycleNonClosed` (Task 2), colonne Task 1.
- Produces: `getVenditoreFollowUps(sellerId)` ritorna righe con `bucket: 'overdue' | 'today' | 'upcoming' | 'parked'`, `nextFollowUpDate: Date | null` (null solo per parked), `parkedDays: number | null`, `inLavorazioneAt`, più i campi esistenti (`attemptCount`, `priorNonClosedCount`, ecc.). I task UI dipendono da questa forma.
- `saveVenditoreOutcome`: firma invariata; azzera sempre `inLavorazioneAt`; tetto calcolato sul ciclo corrente.

- [ ] **Step 1: Aggiorna gli import**

Riga 7: aggiungi `or`, `isNull`, `ne`, `inArray`, `asc` a drizzle-orm:

```ts
import { eq, and, desc, sql, gte, lte, isNotNull, or, isNull, ne, inArray, asc } from "drizzle-orm"
```

Riga 14: aggiungi `countCycleNonClosed`:

```ts
import { validateOutcomeTransition, countCycleNonClosed } from "@/lib/venditorePerformance/guard"
```

- [ ] **Step 2: saveVenditoreOutcome — conteggio per ciclo**

Sostituisci il blocco "Conteggio tentativi pregressi" (righe ~253-258):

```ts
    // Conteggio tentativi pregressi sul lead (per attemptNumber e tetto follow-up).
    // Il tetto conta solo il ciclo corrente: dopo una riapertura dallo Storico
    // (salesCycleStartAt) i 3 follow-up ripartono da zero.
    const priorAttempts = await db.select({ outcome: salesAttempts.outcome, outcomeAt: salesAttempts.outcomeAt })
        .from(salesAttempts)
        .where(and(eq(salesAttempts.companyId, ctx.companyId), eq(salesAttempts.leadId, leadId)));
    const attemptNumber = priorAttempts.length;
    const priorNonClosedCount = countCycleNonClosed(priorAttempts, oldLead.salesCycleStartAt ?? null);
```

- [ ] **Step 3: saveVenditoreOutcome — azzera il parcheggio**

Nel `tx.update(leads).set({...})` (righe ~281-297), dopo `followUp2Date: null,` aggiungi:

```ts
                // Qualunque esito toglie il lead da "In lavorazione".
                inLavorazioneAt: null,
```

- [ ] **Step 4: Riscrivi `getVenditoreFollowUps`**

Sostituisci l'intera funzione (righe ~106-192) con:

```ts
// Lead con follow-up pendente (fonte di verità: leads.followUp1Date, mirrorata
// da saveVenditoreOutcome/rescheduleFollowUp) + lead parcheggiati "In lavorazione"
// (inLavorazioneAt valorizzato, bucket 'parked'). Righe nella stessa forma di
// getVenditoreAppointments così il VenditoreDrawer si riusa identico.
export async function getVenditoreFollowUps(sellerId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = await resolveIsStaff()
    if (!isStaff && sellerId !== ctx.userId) throw new Error('Forbidden')

    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        funnel: leads.funnel,
        appointmentDate: leads.appointmentDate,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeAt: leads.salespersonOutcomeAt,
        salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
        followUp1Date: leads.followUp1Date,
        followUp2Date: leads.followUp2Date,
        gdoUserId: leads.assignedToId,
        gdoName: users.displayName,
        gdoCode: users.gdoCode,
        appointmentNote: leads.appointmentNote,
        version: leads.version,
        closeProduct: leads.closeProduct,
        closeAmountEur: leads.closeAmountEur,
        notClosedReason: leads.notClosedReason,
        negotiationStartedAt: leads.negotiationStartedAt,
        inLavorazioneAt: leads.inLavorazioneAt,
        salesCycleStartAt: leads.salesCycleStartAt,
    })
        .from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, sellerId),
            or(
                isNotNull(leads.inLavorazioneAt),
                and(eq(leads.salespersonOutcome, 'Non chiuso'), isNotNull(leads.followUp1Date)),
            ),
        ))

    // attemptCount globale (storia completa) + priorNonClosedCount sul ciclo corrente.
    const leadIds = rows.map(r => r.id)
    const attemptRows = leadIds.length
        ? await db.select({
            leadId: salesAttempts.leadId,
            outcome: salesAttempts.outcome,
            outcomeAt: salesAttempts.outcomeAt,
        }).from(salesAttempts).where(and(
            eq(salesAttempts.companyId, ctx.companyId),
            inArray(salesAttempts.leadId, leadIds),
        ))
        : []

    const attemptsByLead = new Map<string, { outcome: string; outcomeAt: Date | null }[]>()
    for (const r of attemptRows) {
        const list = attemptsByLead.get(r.leadId) ?? []
        list.push({ outcome: r.outcome, outcomeAt: r.outcomeAt })
        attemptsByLead.set(r.leadId, list)
    }

    const now = new Date()
    const { start: todayStart, end: todayEnd } = dayBoundsRome(now)

    return rows
        .map(r => {
            const attempts = attemptsByLead.get(r.id) ?? []
            const parked = !!r.inLavorazioneAt
            const fu = parked ? null : r.followUp1Date
            return {
                ...r,
                phone: r.negotiationStartedAt ? r.phone : null,
                attemptCount: attempts.length,
                priorNonClosedCount: countCycleNonClosed(attempts, r.salesCycleStartAt ?? null),
                nextFollowUpDate: fu,
                parkedDays: parked ? Math.floor((now.getTime() - r.inLavorazioneAt!.getTime()) / 86_400_000) : null,
                bucket: (parked
                    ? 'parked'
                    : (fu! < todayStart ? 'overdue' : (fu! < todayEnd ? 'today' : 'upcoming'))
                ) as 'overdue' | 'today' | 'upcoming' | 'parked',
            }
        })
        .sort((x, y) => {
            if (x.bucket === 'parked' && y.bucket === 'parked') return (y.parkedDays ?? 0) - (x.parkedDays ?? 0)
            if (x.bucket === 'parked') return 1
            if (y.bucket === 'parked') return -1
            return x.nextFollowUpDate!.getTime() - y.nextFollowUpDate!.getTime()
        })
}
```

- [ ] **Step 5: Verifica** — `npx tsc --noEmit` pulito e `npm test` PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/venditoreActions.ts
git commit -m "feat(venditore): tetto follow-up per ciclo + bucket parked in getVenditoreFollowUps"
```

---

### Task 4: Nuove server action — rescheduleFollowUp, parkLead, reopenNegotiation, getVenditoreStorico

**Files:**
- Modify: `src/app/actions/venditoreActions.ts` (append in fondo al file)

**Interfaces:**
- Consumes: colonne Task 1, forma righe di Task 3.
- Produces (usate dai task UI):
  - `rescheduleFollowUp(leadId: string, newDate: Date): Promise<{ success: boolean; error?: string }>`
  - `parkLead(leadId: string): Promise<{ success: boolean; error?: string }>`
  - `reopenNegotiation(leadId: string): Promise<{ success: boolean; error?: string }>`
  - `getVenditoreStorico(sellerId: string)`: righe forma-appointments + `attempts: Array<{ attemptNumber, outcome, notClosedReason, closeProduct, closeAmountEur, outcomeAt, nextFollowUpDate }>`

- [ ] **Step 1: Aggiungi helper auth condiviso + le 4 action** (append in fondo a `venditoreActions.ts`)

```ts
// ── Follow-up lifecycle (spec 2026-07-23) ────────────────────────────────────

// Auth comune alle azioni sul singolo lead: il venditore opera solo sui propri
// lead; MANAGER/ADMIN senza vincolo. Ritorna lead + userId o un errore.
async function requireOwnLead(leadId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || !['VENDITORE', 'MANAGER', 'ADMIN'].includes(role)) {
        return { ok: false as const, error: 'Unauthorized' };
    }
    const ctx = await currentTenant();
    assertSalesArea(ctx);
    const lead = (await db.select().from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        eq(leads.id, leadId),
    )))[0];
    if (!lead) return { ok: false as const, error: 'Lead non trovato' };
    const isStaff = role === 'MANAGER' || role === 'ADMIN';
    if (!isStaff && lead.salespersonUserId !== supabaseUser.id) {
        return { ok: false as const, error: 'Lead non assegnato' };
    }
    return { ok: true as const, lead, ctx, userId: supabaseUser.id };
}

// Sposta SOLO data/ora del follow-up (il lead ha spostato la chiamata): nessun
// nuovo salesAttempt, il tetto dei 3 follow-up non viene toccato. Serve anche
// da "Fissa follow-up" per i lead In lavorazione e per quelli appena riaperti.
export async function rescheduleFollowUp(leadId: string, newDate: Date): Promise<{ success: boolean; error?: string }> {
    const auth = await requireOwnLead(leadId);
    if (!auth.ok) return { success: false, error: auth.error };
    const { lead, ctx, userId } = auth;

    if (!(newDate instanceof Date) || isNaN(newDate.getTime())) {
        return { success: false, error: 'Data follow-up non valida.' };
    }
    if (!lead.followUp1Date && !lead.inLavorazioneAt) {
        return { success: false, error: 'Nessun follow-up pendente da spostare per questo lead.' };
    }

    // Ultimo attempt 'Non chiuso' del ciclo corrente: teniamo coerente anche la
    // storia (nextFollowUpDate) usata da analytics e Monitor Vendite.
    const attempts = await db.select({
        id: salesAttempts.id,
        outcome: salesAttempts.outcome,
        outcomeAt: salesAttempts.outcomeAt,
    }).from(salesAttempts)
        .where(and(eq(salesAttempts.companyId, ctx.companyId), eq(salesAttempts.leadId, leadId)))
        .orderBy(desc(salesAttempts.outcomeAt));
    const cycleStart = lead.salesCycleStartAt ?? null;
    const lastNonClosed = attempts.find(a =>
        a.outcome === 'Non chiuso' && (!cycleStart || (a.outcomeAt !== null && a.outcomeAt >= cycleStart)));

    await db.transaction(async (tx) => {
        await tx.update(leads)
            .set({ followUp1Date: newDate, inLavorazioneAt: null })
            .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId)));
        if (lastNonClosed) {
            await tx.update(salesAttempts)
                .set({ nextFollowUpDate: newDate })
                .where(eq(salesAttempts.id, lastNonClosed.id));
        }
        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'followup_rescheduled',
            userId,
            timestamp: new Date(),
            metadata: { oldDate: lead.followUp1Date, newDate },
            companyId: ctx.companyId,
        });
    });

    revalidatePath('/venditore');
    return { success: true };
}

// Parcheggia un lead con follow-up pendente in "In lavorazione" (niente data
// precisa). Non consuma tentativi e non registra esiti.
export async function parkLead(leadId: string): Promise<{ success: boolean; error?: string }> {
    const auth = await requireOwnLead(leadId);
    if (!auth.ok) return { success: false, error: auth.error };
    const { lead, ctx, userId } = auth;

    if (lead.inLavorazioneAt) return { success: false, error: 'Lead già in lavorazione.' };
    if (!lead.followUp1Date) {
        return { success: false, error: 'Solo un lead con follow-up pendente può andare in lavorazione.' };
    }

    await db.transaction(async (tx) => {
        await tx.update(leads)
            .set({ inLavorazioneAt: new Date() })
            .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId)));
        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'lead_parked',
            userId,
            timestamp: new Date(),
            metadata: { previousFollowUpDate: lead.followUp1Date },
            companyId: ctx.companyId,
        });
    });

    revalidatePath('/venditore');
    return { success: true };
}

// Riapre una trattativa non-Chiusa dallo Storico: nuovo ciclo, tetto 3 pieno.
// La storia salesAttempts resta intatta; il lead torna in "In lavorazione".
// Il check-in trattativa NON va rifatto (negotiationStartedAt resta).
export async function reopenNegotiation(leadId: string): Promise<{ success: boolean; error?: string }> {
    const auth = await requireOwnLead(leadId);
    if (!auth.ok) return { success: false, error: auth.error };
    const { lead, ctx, userId } = auth;

    if (!lead.salespersonOutcome) return { success: false, error: 'La trattativa è già aperta.' };
    if (lead.salespersonOutcome === 'Chiuso') {
        return { success: false, error: 'Un lead Chiuso non è riapribile.' };
    }

    const now = new Date();
    await db.transaction(async (tx) => {
        await tx.update(leads)
            .set({
                salesCycleStartAt: now,
                inLavorazioneAt: now,
                salespersonOutcome: null,
                salespersonOutcomeNotes: null,
                notClosedReason: null,
                followUp1Date: null,
                followUp2Date: null,
                version: lead.version + 1,
            })
            .where(and(eq(leads.companyId, ctx.companyId), eq(leads.id, leadId)));
        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'negotiation_reopened',
            userId,
            timestamp: now,
            metadata: { previousOutcome: lead.salespersonOutcome, previousNotClosedReason: lead.notClosedReason },
            companyId: ctx.companyId,
        });
    });

    revalidatePath('/venditore');
    return { success: true };
}

// Storico trattative: lead del venditore con esito finale, usciti dalle viste
// operative (niente follow-up pendente, non in lavorazione). Include la storia
// completa dei tentativi per il dettaglio espandibile.
export async function getVenditoreStorico(sellerId: string) {
    const ctx = await currentTenant()
    assertSalesArea(ctx)
    const isStaff = await resolveIsStaff()
    if (!isStaff && sellerId !== ctx.userId) throw new Error('Forbidden')

    const rows = await db.select({
        id: leads.id,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        funnel: leads.funnel,
        appointmentDate: leads.appointmentDate,
        appointmentCreatedAt: leads.appointmentCreatedAt,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeAt: leads.salespersonOutcomeAt,
        salespersonOutcomeNotes: leads.salespersonOutcomeNotes,
        followUp1Date: leads.followUp1Date,
        followUp2Date: leads.followUp2Date,
        gdoUserId: leads.assignedToId,
        gdoName: users.displayName,
        gdoCode: users.gdoCode,
        appointmentNote: leads.appointmentNote,
        version: leads.version,
        closeProduct: leads.closeProduct,
        closeAmountEur: leads.closeAmountEur,
        notClosedReason: leads.notClosedReason,
        negotiationStartedAt: leads.negotiationStartedAt,
    })
        .from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(and(
            eq(leads.companyId, ctx.companyId),
            eq(leads.salespersonUserId, sellerId),
            isNotNull(leads.salespersonOutcome),
            isNull(leads.inLavorazioneAt),
            // 'Non chiuso' CON follow-up pendente sta nella tab Follow-up, non qui.
            or(ne(leads.salespersonOutcome, 'Non chiuso'), isNull(leads.followUp1Date)),
        ))
        .orderBy(desc(leads.salespersonOutcomeAt))

    const leadIds = rows.map(r => r.id)
    const attemptRows = leadIds.length
        ? await db.select({
            leadId: salesAttempts.leadId,
            attemptNumber: salesAttempts.attemptNumber,
            outcome: salesAttempts.outcome,
            notClosedReason: salesAttempts.notClosedReason,
            closeProduct: salesAttempts.closeProduct,
            closeAmountEur: salesAttempts.closeAmountEur,
            outcomeAt: salesAttempts.outcomeAt,
            nextFollowUpDate: salesAttempts.nextFollowUpDate,
        }).from(salesAttempts)
            .where(and(
                eq(salesAttempts.companyId, ctx.companyId),
                inArray(salesAttempts.leadId, leadIds),
            ))
            .orderBy(asc(salesAttempts.attemptNumber))
        : []

    const byLead = new Map<string, typeof attemptRows>()
    for (const a of attemptRows) {
        const list = byLead.get(a.leadId) ?? []
        list.push(a)
        byLead.set(a.leadId, list)
    }

    return rows.map(r => ({
        ...r,
        phone: r.negotiationStartedAt ? r.phone : null,
        attempts: byLead.get(r.id) ?? [],
    }))
}
```

- [ ] **Step 2: Verifica** — `npx tsc --noEmit` pulito, `npm test` PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/venditoreActions.ts
git commit -m "feat(venditore): action sposta follow-up, parcheggio in lavorazione, storico e riapertura trattative"
```

---

### Task 5: Tab Follow-up — bottoni Sposta / In lavorazione + sezione parked

**Files:**
- Modify: `src/components/VenditoreDashboardClient.tsx`

**Interfaces:**
- Consumes: `rescheduleFollowUp`, `parkLead` (Task 4), bucket `'parked'` + `parkedDays` (Task 3), `toRomeDatetimeLocal`/`parseRomeDatetimeLocal` da `@/lib/dateUtils`.

- [ ] **Step 1: Import e stato**

Aggiorna gli import (riga 4 e 6):

```ts
import { getVenditoreAppointments, getVenditoreFollowUps, saveVenditoreOutcome, startNegotiation, getLeadBriefing, rescheduleFollowUp, parkLead } from "@/app/actions/venditoreActions"
import { Calendar, List, Search, Filter, Phone, Mail, User, Clock, CheckCircle2, AlertCircle, HelpCircle, Trophy, Bell, BarChart3, CalendarClock, PauseCircle, History } from "lucide-react"
import { toRomeDatetimeLocal, parseRomeDatetimeLocal } from "@/lib/dateUtils"
```

Dopo `const [drawerFollowUpMode, setDrawerFollowUpMode] = useState(false)` aggiungi:

```ts
    // Sposta/parcheggia follow-up (spec 2026-07-23)
    const [reschedulingId, setReschedulingId] = useState<string | null>(null)
    const [rescheduleValue, setRescheduleValue] = useState("")
    const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
```

- [ ] **Step 2: Handler** (dopo `closeDrawer`)

```ts
    const openReschedule = (f: any) => {
        setReschedulingId(f.id)
        setRescheduleValue(f.nextFollowUpDate ? toRomeDatetimeLocal(new Date(f.nextFollowUpDate)) : toRomeDatetimeLocal(new Date()))
    }

    const confirmReschedule = async (leadId: string) => {
        if (!rescheduleValue) return
        setBusyLeadId(leadId)
        try {
            const res = await rescheduleFollowUp(leadId, parseRomeDatetimeLocal(rescheduleValue))
            if (!res.success) { alert(res.error || "Errore durante lo spostamento del follow-up"); return }
            setReschedulingId(null)
            fetchFollowUps()
            fetchAppointments()
        } finally {
            setBusyLeadId(null)
        }
    }

    const handlePark = async (leadId: string) => {
        setBusyLeadId(leadId)
        try {
            const res = await parkLead(leadId)
            if (!res.success) { alert(res.error || "Errore durante il parcheggio del lead"); return }
            fetchFollowUps()
        } finally {
            setBusyLeadId(null)
        }
    }
```

- [ ] **Step 3: Card follow-up — bottoni e picker inline**

Nel blocco `view === 'FOLLOWUP'`, dentro `items.map(...)`, sostituisci il `<div className="flex items-center gap-3 shrink-0">...</div>` (righe ~418-427) con:

```tsx
                                                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                                        <div className="text-xs text-ash-400 mr-1">Tentativi: {f.attemptCount}</div>
                                                        {reschedulingId === f.id ? (
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type="datetime-local"
                                                                    value={rescheduleValue}
                                                                    onChange={e => setRescheduleValue(e.target.value)}
                                                                    className="bg-ash-50 border border-ash-200 rounded-lg text-xs p-1.5 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                                                                />
                                                                <button
                                                                    onClick={() => confirmReschedule(f.id)}
                                                                    disabled={busyLeadId === f.id}
                                                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                                                >
                                                                    Conferma
                                                                </button>
                                                                <button
                                                                    onClick={() => setReschedulingId(null)}
                                                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-ash-100 text-ash-600 hover:bg-ash-200 transition-colors"
                                                                >
                                                                    Annulla
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => openReschedule(f)}
                                                                    title="Il lead ha spostato? Cambia solo data/ora: non consuma un follow-up"
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-brand-orange/40 hover:text-brand-orange transition-colors"
                                                                >
                                                                    <CalendarClock className="h-3.5 w-3.5" />
                                                                    Sposta
                                                                </button>
                                                                <button
                                                                    onClick={() => handlePark(f.id)}
                                                                    disabled={busyLeadId === f.id}
                                                                    title="Nessuna data precisa? Sposta il lead in In lavorazione"
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50 transition-colors"
                                                                >
                                                                    <PauseCircle className="h-3.5 w-3.5" />
                                                                    In lavorazione
                                                                </button>
                                                                <button
                                                                    onClick={() => openLead(f, true)}
                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-orange-600 text-white hover:bg-brand-orange-700 transition-colors"
                                                                >
                                                                    <Phone className="h-3.5 w-3.5" />
                                                                    Registra esito
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
```

- [ ] **Step 4: Sezione "In lavorazione"**

Subito PRIMA di `{followUps.length === 0 && (` (riga ~434) inserisci:

```tsx
                            {(() => {
                                const parked = followUps.filter(f => f.bucket === 'parked')
                                if (!parked.length) return null
                                return (
                                    <div>
                                        <h3 className="text-sm font-bold uppercase tracking-wider mb-2 text-blue-600">In lavorazione ({parked.length})</h3>
                                        <p className="text-xs text-ash-400 mb-2">Lead senza data/ora precisa di follow-up: fissa una data appena il lead te la dà.</p>
                                        <div className="space-y-2">
                                            {parked.map((f, idx) => {
                                                const days = f.parkedDays ?? 0
                                                const ageClass = days > 14
                                                    ? 'bg-red-100 text-red-700 border-red-200'
                                                    : days > 7
                                                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                                                        : 'bg-ash-100 text-ash-600 border-ash-200'
                                                return (
                                                    <div
                                                        key={f.id}
                                                        onClick={() => openLead(f, true)}
                                                        className="w-full text-left bg-white border border-ash-200/60 rounded-lg p-4 hover:border-blue-400/40 hover:shadow-card transition-all cursor-pointer flex items-center justify-between gap-4 animate-fade-in"
                                                        style={{ animationDelay: `${Math.min(idx * 30, 300)}ms`, animationFillMode: 'backwards' }}
                                                    >
                                                        <div>
                                                            <div className="font-semibold text-ash-800">{f.name}</div>
                                                            <div className="text-xs text-ash-500 mt-1 flex items-center gap-2">
                                                                <span>{f.funnel || 'Sconosciuto'}</span>
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${ageClass}`}>
                                                                    In lavorazione da {days} {days === 1 ? 'giorno' : 'giorni'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                                            <div className="text-xs text-ash-400 mr-1">Tentativi: {f.attemptCount}</div>
                                                            {reschedulingId === f.id ? (
                                                                <div className="flex items-center gap-2">
                                                                    <input
                                                                        type="datetime-local"
                                                                        value={rescheduleValue}
                                                                        onChange={e => setRescheduleValue(e.target.value)}
                                                                        className="bg-ash-50 border border-ash-200 rounded-lg text-xs p-1.5 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                                                                    />
                                                                    <button
                                                                        onClick={() => confirmReschedule(f.id)}
                                                                        disabled={busyLeadId === f.id}
                                                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                                                    >
                                                                        Conferma
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setReschedulingId(null)}
                                                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-ash-100 text-ash-600 hover:bg-ash-200 transition-colors"
                                                                    >
                                                                        Annulla
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={() => openReschedule(f)}
                                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-brand-orange/40 hover:text-brand-orange transition-colors"
                                                                    >
                                                                        <CalendarClock className="h-3.5 w-3.5" />
                                                                        Fissa follow-up
                                                                    </button>
                                                                    <button
                                                                        onClick={() => openLead(f, true)}
                                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-orange-600 text-white hover:bg-brand-orange-700 transition-colors"
                                                                    >
                                                                        <Phone className="h-3.5 w-3.5" />
                                                                        Registra esito
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })()}
```

Nota: la riga data della card pendente (`Follow-up: {format(new Date(f.nextFollowUpDate), ...)}`) resta invariata — le card parked non la usano perché `nextFollowUpDate` è null e stanno in un blocco separato.

- [ ] **Step 5: Verifica** — `npx tsc --noEmit` pulito. Poi `npm run dev` e controlla visivamente la tab Follow-up (con un account venditore o via codice). Le card pendenti mostrano i 3 bottoni; "In lavorazione" sposta la card nella sezione blu; "Sposta" apre il picker inline e aggiorna la data.

- [ ] **Step 6: Commit**

```bash
git add src/components/VenditoreDashboardClient.tsx
git commit -m "feat(venditore): sposta follow-up senza esito + sezione In lavorazione nella tab Follow-up"
```

---

### Task 6: Tab Storico trattative

**Files:**
- Create: `src/components/venditore/StoricoTrattativeTab.tsx`
- Modify: `src/components/VenditoreDashboardClient.tsx`

**Interfaces:**
- Consumes: `getVenditoreStorico`, `reopenNegotiation` (Task 4).
- Produces: `<StoricoTrattativeTab sellerId={string} onReopened={() => void} />`

- [ ] **Step 1: Crea `src/components/venditore/StoricoTrattativeTab.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { getVenditoreStorico, reopenNegotiation } from "@/app/actions/venditoreActions"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import { Search, RotateCcw, ChevronDown, ChevronUp } from "lucide-react"

const OUTCOME_FILTERS = ["Tutti", "Chiuso", "Non chiuso", "Sparito"] as const
type OutcomeFilter = (typeof OUTCOME_FILTERS)[number]

// 'Perso' è un esito legacy (rimosso 2026-07-08): nello Storico è mostrato
// e filtrato come 'Non chiuso'.
const effectiveOutcome = (o: string | null) => (o === "Perso" ? "Non chiuso" : o || "")

const outcomeBadgeClass = (o: string) =>
    o === "Chiuso"
        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
        : o === "Sparito"
            ? "bg-ash-100 text-ash-600 border-ash-200"
            : "bg-amber-100 text-amber-700 border-amber-200"

export function StoricoTrattativeTab({ sellerId, onReopened }: { sellerId: string; onReopened: () => void }) {
    const [rows, setRows] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [filter, setFilter] = useState<OutcomeFilter>("Tutti")
    const [search, setSearch] = useState("")
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [reopeningId, setReopeningId] = useState<string | null>(null)

    const load = () => {
        setIsLoading(true)
        getVenditoreStorico(sellerId)
            .then(r => setRows(r))
            .catch(() => setRows([]))
            .finally(() => setIsLoading(false))
    }
    useEffect(load, [sellerId])

    const filtered = rows.filter(r => {
        if (filter !== "Tutti" && effectiveOutcome(r.salespersonOutcome) !== filter) return false
        const q = search.toLowerCase()
        if (q && !((r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q))) return false
        return true
    })

    const countFor = (f: OutcomeFilter) =>
        f === "Tutti" ? rows.length : rows.filter(r => effectiveOutcome(r.salespersonOutcome) === f).length

    const handleReopen = async (r: any) => {
        if (!confirm(`Riaprire la trattativa con ${r.name}? Il ciclo follow-up riparte da zero e il lead torna in "In lavorazione".`)) return
        setReopeningId(r.id)
        try {
            const res = await reopenNegotiation(r.id)
            if (!res.success) { alert(res.error || "Errore durante la riapertura"); return }
            load()
            onReopened()
        } finally {
            setReopeningId(null)
        }
    }

    return (
        <div className="p-6 bg-gradient-to-b from-ash-50/50 to-white space-y-4">
            {/* Filtri */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex flex-wrap gap-2">
                    {OUTCOME_FILTERS.map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${filter === f
                                ? "bg-brand-orange-600 text-white border-brand-orange-600"
                                : "bg-white text-ash-600 border-ash-200 hover:border-brand-orange/40"}`}
                        >
                            {f} ({countFor(f)})
                        </button>
                    ))}
                </div>
                <div className="relative md:ml-auto md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ash-400" />
                    <input
                        type="text"
                        placeholder="Cerca nome o telefono..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-ash-50/50 border border-ash-200/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/30 focus:border-brand-orange transition-all"
                    />
                </div>
            </div>

            {/* Lista */}
            {isLoading ? (
                <div className="text-center text-ash-400 py-12">Caricamento storico…</div>
            ) : filtered.length === 0 ? (
                <div className="text-center text-ash-400 py-12">Nessuna trattativa nello storico.</div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(r => {
                        const outcome = effectiveOutcome(r.salespersonOutcome)
                        const expanded = expandedId === r.id
                        return (
                            <div key={r.id} className="bg-white border border-ash-200/60 rounded-lg overflow-hidden">
                                <div
                                    onClick={() => setExpandedId(expanded ? null : r.id)}
                                    className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-ash-50/50 transition-colors"
                                >
                                    <div className="min-w-0">
                                        <div className="font-semibold text-ash-800 truncate">{r.name}</div>
                                        <div className="text-xs text-ash-500 mt-1">
                                            {r.funnel || "Sconosciuto"}
                                            {r.salespersonOutcomeAt && <> · Esitato il {format(new Date(r.salespersonOutcomeAt), "dd MMM yyyy", { locale: it })}</>}
                                            {outcome === "Chiuso" && r.closeAmountEur ? <> · <strong>€{r.closeAmountEur}</strong>{r.closeProduct ? ` (${r.closeProduct})` : ""}</> : null}
                                            {outcome !== "Chiuso" && r.notClosedReason ? <> · {r.notClosedReason}</> : null}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold border ${outcomeBadgeClass(outcome)}`}>
                                            {outcome}
                                        </div>
                                        {outcome !== "Chiuso" && (
                                            <div onClick={e => e.stopPropagation()}>
                                                <button
                                                    onClick={() => handleReopen(r)}
                                                    disabled={reopeningId === r.id}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-brand-orange/40 hover:text-brand-orange disabled:opacity-50 transition-colors"
                                                >
                                                    <RotateCcw className="h-3.5 w-3.5" />
                                                    {reopeningId === r.id ? "Riapertura…" : "Riapri trattativa"}
                                                </button>
                                            </div>
                                        )}
                                        {expanded ? <ChevronUp className="h-4 w-4 text-ash-400" /> : <ChevronDown className="h-4 w-4 text-ash-400" />}
                                    </div>
                                </div>
                                {expanded && (
                                    <div className="border-t border-ash-100 bg-ash-50/40 p-4">
                                        <h4 className="text-xs font-bold text-ash-500 uppercase tracking-widest mb-2">Storia dei tentativi</h4>
                                        {r.attempts.length === 0 ? (
                                            <div className="text-xs text-ash-400">Nessun tentativo registrato.</div>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {r.attempts.map((a: any) => (
                                                    <div key={`${r.id}-${a.attemptNumber}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ash-600">
                                                        <span className="font-bold text-ash-400 w-24 shrink-0">
                                                            {a.attemptNumber === 0 ? "Appuntamento" : `Follow-up ${a.attemptNumber}`}
                                                        </span>
                                                        <span>{a.outcomeAt ? format(new Date(a.outcomeAt), "dd MMM yyyy - HH:mm", { locale: it }) : "—"}</span>
                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${outcomeBadgeClass(effectiveOutcome(a.outcome))}`}>
                                                            {effectiveOutcome(a.outcome)}
                                                        </span>
                                                        {a.notClosedReason && <span>· {a.notClosedReason}</span>}
                                                        {a.closeAmountEur ? <span>· €{a.closeAmountEur}{a.closeProduct ? ` (${a.closeProduct})` : ""}</span> : null}
                                                        {a.nextFollowUpDate && <span className="text-ash-400">· follow-up pianificato {format(new Date(a.nextFollowUpDate), "dd MMM", { locale: it })}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {r.salespersonOutcomeNotes && (
                                            <div className="text-xs text-ash-500 mt-2">Note finali: {r.salespersonOutcomeNotes}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Collega la tab in `VenditoreDashboardClient.tsx`**

1. Import: `import { StoricoTrattativeTab } from "@/components/venditore/StoricoTrattativeTab"` (l'icona `History` è già importata dal Task 5).
2. Estendi il tipo view: `useState<'LISTA' | 'FOLLOWUP' | 'AGENDA' | 'CLASSIFICA' | 'PERFORMANCE' | 'STORICO'>('LISTA')`.
3. Nel View Toggle, dopo il bottone Follow-up (per vicinanza logica) aggiungi:

```tsx
                    <button
                        onClick={() => setView('STORICO')}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${view === 'STORICO' ? 'bg-white shadow-soft text-brand-charcoal' : 'text-ash-500 hover:text-ash-700'}`}
                    >
                        <History className="h-4 w-4" />
                        Storico
                    </button>
```

4. Nel Content, aggiungi il ramo PRIMA del fallback CLASSIFICA (dopo il ramo `view === 'PERFORMANCE'`):

```tsx
                ) : view === 'STORICO' ? (
                    <StoricoTrattativeTab sellerId={sellerId} onReopened={() => { fetchFollowUps(); fetchAppointments() }} />
```

- [ ] **Step 3: Verifica** — `npx tsc --noEmit` pulito; in dev la tab Storico lista i lead esitati, i filtri contano giusto, l'espansione mostra i tentativi, "Riapri trattativa" (con conferma) rimanda il lead in Follow-up → In lavorazione.

- [ ] **Step 4: Commit**

```bash
git add src/components/venditore/StoricoTrattativeTab.tsx src/components/VenditoreDashboardClient.tsx
git commit -m "feat(venditore): tab Storico trattative con filtro esito e riapertura"
```

---

### Task 7: Bottone "Sposta follow-up" nel VenditoreDrawer

**Files:**
- Modify: `src/components/VenditoreDrawer.tsx`

**Interfaces:**
- Consumes: `rescheduleFollowUp` (Task 4), prop esistente `onSaved` (chiude il drawer e rifetcha), `lead.nextFollowUpDate` (Task 3).

- [ ] **Step 1: Import e stato**

Aggiungi `rescheduleFollowUp` all'import delle action del drawer (il file importa già `saveVenditoreOutcome` da `@/app/actions/venditoreActions` — aggiungila lì) e `CalendarClock` alle icone lucide importate. `parseRomeDatetimeLocal`/`toRomeDatetimeLocal` sono già importate (riga 9).

Vicino agli altri useState (dopo `notes`):

```ts
    // Sposta follow-up senza esito (spec 2026-07-23)
    const [showReschedule, setShowReschedule] = useState(false)
    const [rescheduleValue, setRescheduleValue] = useState("")
    const [isRescheduling, setIsRescheduling] = useState(false)
```

- [ ] **Step 2: Handler** (vicino agli altri handler del componente)

```ts
    const handleReschedule = async () => {
        if (!rescheduleValue) return
        setIsRescheduling(true)
        try {
            const res = await rescheduleFollowUp(lead.id, parseRomeDatetimeLocal(rescheduleValue))
            if (!res.success) { alert(res.error || "Errore durante lo spostamento del follow-up"); return }
            onSaved()
        } finally {
            setIsRescheduling(false)
        }
    }
```

- [ ] **Step 3: UI nel recap "Tentativo precedente"**

Dentro il blocco `{followUpMode && lead?.salespersonOutcome && (...)}`, dopo il `</div>` che chiude `<div className="text-sm text-ash-700 space-y-1">` e prima della chiusura del box, aggiungi:

```tsx
                        <div className="mt-3 pt-3 border-t border-ash-200">
                            {!showReschedule ? (
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowReschedule(true)
                                            setRescheduleValue(lead?.nextFollowUpDate ? toRomeDatetimeLocal(new Date(lead.nextFollowUpDate)) : toRomeDatetimeLocal(new Date()))
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-ash-200 text-ash-700 hover:border-brand-orange/40 hover:text-brand-orange transition-colors"
                                    >
                                        <CalendarClock className="h-3.5 w-3.5" />
                                        Sposta follow-up
                                    </button>
                                    <div className="text-[11px] text-ash-400">Il lead ha spostato? Cambia solo l&apos;orario: non consuma un follow-up.</div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        type="datetime-local"
                                        value={rescheduleValue}
                                        onChange={e => setRescheduleValue(e.target.value)}
                                        className="bg-white border border-ash-200 rounded-lg text-xs p-1.5 focus:outline-none focus:ring-2 focus:ring-brand-orange/30"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleReschedule}
                                        disabled={isRescheduling || !rescheduleValue}
                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                    >
                                        {isRescheduling ? "Salvataggio…" : "Conferma nuova data"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowReschedule(false)}
                                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-ash-100 text-ash-600 hover:bg-ash-200 transition-colors"
                                    >
                                        Annulla
                                    </button>
                                </div>
                            )}
                        </div>
```

- [ ] **Step 4: Verifica** — `npx tsc --noEmit` pulito; in dev: aprire un lead dalla tab Follow-up → nel recap compare "Sposta follow-up"; confermare la nuova data chiude il drawer e la card mostra la data aggiornata.

- [ ] **Step 5: Commit**

```bash
git add src/components/VenditoreDrawer.tsx
git commit -m "feat(venditore): sposta follow-up dal drawer senza registrare esito"
```

---

### Task 8: Monitor Vendite — contatore "In lavorazione" per venditore

**Files:**
- Modify: `src/app/actions/venditoriMonitorActions.ts`
- Modify: `src/app/(dashboard)/monitor-vendite/MonitorVenditeClient.tsx`

**Interfaces:**
- Consumes: `leads.inLavorazioneAt` (Task 1).
- Produces: `VenditoriMonitorData.inLavorazione: InLavorazioneSummary[]` con `interface InLavorazioneSummary { venditoreId: string; venditoreName: string; count: number; maxDays: number }`.

- [ ] **Step 1: Action — escludi i parked dai follow-up e aggiungi il riepilogo**

In `venditoriMonitorActions.ts`:

1. Import: aggiungi `isNull` a drizzle-orm (riga 5).
2. Dopo `export interface FollowUpRow {...}` aggiungi:

```ts
export interface InLavorazioneSummary {
    venditoreId: string
    venditoreName: string
    count: number
    maxDays: number
}
```

3. In `VenditoriMonitorData` aggiungi `inLavorazione: InLavorazioneSummary[]`.
4. Nell'early-return (riga ~101) aggiungi `inLavorazione: []`.
5. Nel `where` della query `attemptRows` (righe ~158-162) aggiungi la condizione `isNull(leads.inLavorazioneAt),` — un lead parcheggiato non deve comparire tra i follow-up scaduti/prossimi.
6. Prima del `return` finale aggiungi:

```ts
    // Lead parcheggiati "In lavorazione" (senza data follow-up) per venditore.
    const parkedRows = await db.select({
        salespersonUserId: leads.salespersonUserId,
        inLavorazioneAt: leads.inLavorazioneAt,
    }).from(leads).where(and(
        eq(leads.companyId, ctx.companyId),
        inArray(leads.salespersonUserId, targetIds),
        isNotNull(leads.inLavorazioneAt),
    ))

    const parkedByVenditore = new Map<string, { count: number; maxDays: number }>()
    for (const r of parkedRows) {
        if (!r.salespersonUserId || !r.inLavorazioneAt) continue
        const days = Math.floor((now.getTime() - r.inLavorazioneAt.getTime()) / 86_400_000)
        const cur = parkedByVenditore.get(r.salespersonUserId) ?? { count: 0, maxDays: 0 }
        cur.count += 1
        cur.maxDays = Math.max(cur.maxDays, days)
        parkedByVenditore.set(r.salespersonUserId, cur)
    }
    const inLavorazione: InLavorazioneSummary[] = [...parkedByVenditore.entries()]
        .map(([venditoreId, v]) => ({
            venditoreId,
            venditoreName: nameOf.get(venditoreId) || '—',
            count: v.count,
            maxDays: v.maxDays,
        }))
        .sort((a, b) => b.maxDays - a.maxDays)
```

7. Aggiorna il return: `return { venditori, appointments, upcomingFollowUps: upcoming, overdueFollowUps: overdue, inLavorazione }`.

- [ ] **Step 2: Client — sezione riepilogo**

In `MonitorVenditeClient.tsx`, subito PRIMA del blocco `{data.overdueFollowUps.length > 0 && (` (riga ~172) aggiungi:

```tsx
            {/* Lead in lavorazione (parcheggiati senza data follow-up) */}
            {data.inLavorazione.length > 0 && (
                <section className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-sm">
                    <h2 className="text-sm font-bold text-blue-900 mb-3">
                        Lead in lavorazione (senza data follow-up)
                        <span className="ml-2 rounded-full bg-blue-200 text-blue-800 px-2 py-0.5 text-[11px] font-bold">
                            {data.inLavorazione.reduce((s, v) => s + v.count, 0)}
                        </span>
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {data.inLavorazione.map(v => (
                            <div
                                key={v.venditoreId}
                                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${v.maxDays > 14
                                    ? 'border-rose-200 bg-rose-50 text-rose-800'
                                    : v.maxDays > 7
                                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                                        : 'border-ash-200 bg-white text-ash-700'}`}
                            >
                                <span className="font-bold">{v.venditoreName}</span>
                                <span>{v.count} lead</span>
                                <span className="text-[10px] opacity-70">max {v.maxDays} gg</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}
```

- [ ] **Step 3: Verifica** — `npx tsc --noEmit` pulito (il page.tsx server passa `initialData` tipato: il campo nuovo arriva automaticamente).

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/venditoriMonitorActions.ts "src/app/(dashboard)/monitor-vendite/MonitorVenditeClient.tsx"
git commit -m "feat(manager): contatore lead In lavorazione per venditore su /monitor-vendite"
```

---

### Task 9: Verifica finale, build e deploy

**Files:** nessuno nuovo.

- [ ] **Step 1: Test** — Run: `npm test`. Atteso: PASS tutti.
- [ ] **Step 2: Build** — Run: `npm run build`. Atteso: build pulita senza errori (i warning preesistenti non bloccano).
- [ ] **Step 3: Push** — `git push` su main → deploy Vercel automatico.
- [ ] **Step 4: QA browser su prod** (deploy live): con un account venditore percorrere il flusso: card follow-up → Sposta (data aggiornata, nessun tentativo consumato) → In lavorazione (sezione blu, badge età) → Fissa follow-up (torna nei bucket) → Registra esito Sparito → tab Storico (lead presente, filtri ok) → Riapri trattativa (torna In lavorazione, "Follow-up 0 di 3" nel drawer). Da admin: /monitor-vendite mostra il contatore In lavorazione e NON mostra i parked tra gli Scaduti.
- [ ] **Step 5: Aggiorna memoria** — aggiorna `MEMORY.md` + file progetto con lo stato LIVE e i commit.
