# Conferme Webinar Self-Booked — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated section in the Conferme dashboard listing 25 self-booked webinar leads for 2026-05-12 and allow one-click assignment to a venditore with Google Calendar sync.

**Architecture:** Single boolean column `isSelfBooked` on `leads`. 25 seeded rows. New `WebinarSelfBookedSection` client component + 2 server actions reusing the existing GCal/marketing-webhook/gamification flow from `setConfermeOutcome`.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, Supabase Postgres, Google Calendar API, Tailwind.

**Project conventions:** No TDD here (codebase pattern is direct impl + TS typecheck + manual smoke). Frequent commits. Telephone numbers saved nudi (no `39` or `+39` prefix).

---

### Task 1: Add `isSelfBooked` column to leads schema

**Files:**
- Modify: `src/db/schema.ts` (leads table, after `phoneSuspicious` line)
- Create: `drizzle/migrations/0002_lead_is_self_booked.sql`

- [ ] **Step 1.1:** Edit `src/db/schema.ts`. Inside the `leads = pgTable('leads', { ... })` definition, add right after the `phoneSuspicious` line (around schema.ts:75):

```ts
isSelfBooked: boolean('isSelfBooked').default(false).notNull(),
```

- [ ] **Step 1.2:** Create `drizzle/migrations/0002_lead_is_self_booked.sql`:

```sql
ALTER TABLE "leads" ADD COLUMN "isSelfBooked" boolean DEFAULT false NOT NULL;
```

- [ ] **Step 1.3:** Apply migration via Supabase MCP:

```
mcp__supabase__apply_migration with:
  name: "lead_is_self_booked"
  query: ALTER TABLE "leads" ADD COLUMN "isSelfBooked" boolean DEFAULT false NOT NULL;
```

Expected: migration applied without error.

---

### Task 2: Seed the 25 webinar leads for 2026-05-12

**Files:** none (one-shot SQL via Supabase MCP).

- [ ] **Step 2.1:** Build a single `INSERT INTO leads (...)` statement with the 24 unique records below (Andrea `3312420082 13:00` appears once). Each row uses `gen_random_uuid()::text` for `id`, `funnel='ORG'`, `status='APPOINTMENT'`, `isSelfBooked=true`, `appointmentNote='Webinar Video Editing — prenotazione autonoma'`.

Time mapping (Europe/Rome → UTC, May is UTC+2 / CEST so subtract 2):
- 09:00 Rome = 07:00 UTC
- 10:00 Rome = 08:00 UTC
- 11:00 Rome = 09:00 UTC
- 12:00 Rome = 10:00 UTC
- 13:00 Rome = 11:00 UTC
- 14:00 Rome = 12:00 UTC

- [ ] **Step 2.2:** Execute via `mcp__supabase__execute_sql`:

```sql
INSERT INTO leads (id, name, phone, funnel, status, "isSelfBooked", "appointmentDate", "appointmentNote", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'Massimiliano',                   '3382920075', 'ORG', 'APPOINTMENT', true, '2026-05-12 07:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Salvatore Giulintano',           '3280147180', 'ORG', 'APPOINTMENT', true, '2026-05-12 07:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Francesco Calarco',              '3891659382', 'ORG', 'APPOINTMENT', true, '2026-05-12 08:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Denisse',                        '3807822296', 'ORG', 'APPOINTMENT', true, '2026-05-12 08:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Luca',                           '3338872918', 'ORG', 'APPOINTMENT', true, '2026-05-12 08:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Linda D''Amico',                 '3279820421', 'ORG', 'APPOINTMENT', true, '2026-05-12 08:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Laura',                          '3664180650', 'ORG', 'APPOINTMENT', true, '2026-05-12 08:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'daniela',                        '3347331650', 'ORG', 'APPOINTMENT', true, '2026-05-12 09:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Achille',                        '3393390370', 'ORG', 'APPOINTMENT', true, '2026-05-12 09:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Grajdan Adriana',                '3342105627', 'ORG', 'APPOINTMENT', true, '2026-05-12 09:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Ciao mi chiamo Luca',            '3338796514', 'ORG', 'APPOINTMENT', true, '2026-05-12 09:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Milena',                         '3492563843', 'ORG', 'APPOINTMENT', true, '2026-05-12 10:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'silva',                          '3515676930', 'ORG', 'APPOINTMENT', true, '2026-05-12 10:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Leonardo',                       '3471381823', 'ORG', 'APPOINTMENT', true, '2026-05-12 10:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Massimiliano Bonomo Papotto',    '3755379630', 'ORG', 'APPOINTMENT', true, '2026-05-12 10:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Andrea',                         '3312420082', 'ORG', 'APPOINTMENT', true, '2026-05-12 11:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Marilina',                       '3292570700', 'ORG', 'APPOINTMENT', true, '2026-05-12 11:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Nicola Sampaolo',                '3898855183', 'ORG', 'APPOINTMENT', true, '2026-05-12 11:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Edward Medina',                  '3287715059', 'ORG', 'APPOINTMENT', true, '2026-05-12 11:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Dave Russell Sabarias',          '3474754948', 'ORG', 'APPOINTMENT', true, '2026-05-12 12:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Julia',                          '3713610141', 'ORG', 'APPOINTMENT', true, '2026-05-12 12:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Gaia',                           '3282588848', 'ORG', 'APPOINTMENT', true, '2026-05-12 12:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'Davide',                         '3770860619', 'ORG', 'APPOINTMENT', true, '2026-05-12 12:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now()),
  (gen_random_uuid()::text, 'manuel',                         '3927556571', 'ORG', 'APPOINTMENT', true, '2026-05-12 12:00:00+00', 'Webinar Video Editing — prenotazione autonoma', now(), now());
```

Expected: 24 rows inserted.

- [ ] **Step 2.3:** Verify via `mcp__supabase__execute_sql`:

```sql
SELECT COUNT(*) FROM leads WHERE "isSelfBooked" = true;
```

Expected: count = 24.

---

### Task 3: Server actions

**Files:**
- Modify: `src/app/actions/confermeActions.ts` (append at end of file)

- [ ] **Step 3.1:** Append `getWebinarSelfBookedLeads` and `assignWebinarLeadToSalesperson` to `src/app/actions/confermeActions.ts`. Use the exact code below (copies the GCal + webhook + gamification logic from `setConfermeOutcome` lines 419–465):

```ts
// =====================================================================
// WEBINAR SELF-BOOKED (sezione dedicata Conferme)
// =====================================================================

export async function getWebinarSelfBookedLeads() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized");
    }

    const rows = await db
        .select({
            id: leads.id,
            name: leads.name,
            phone: leads.phone,
            appointmentDate: leads.appointmentDate,
            appointmentNote: leads.appointmentNote,
        })
        .from(leads)
        .where(and(eq(leads.isSelfBooked, true), isNull(leads.salespersonUserId)))
        .orderBy(asc(leads.appointmentDate));

    return rows;
}

export async function listVenditoriForAssignment() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        throw new Error("Unauthorized");
    }

    const rows = await db
        .select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(eq(users.role, 'VENDITORE'))
        .orderBy(asc(users.name));

    return rows;
}

export async function assignWebinarLeadToSalesperson(leadId: string, salespersonId: string) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role } } : null;
    if (!session || (session.user.role !== "CONFERME" && session.user.role !== "MANAGER" && session.user.role !== "ADMIN")) {
        return { success: false, error: "Unauthorized" };
    }

    const [oldLead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!oldLead) return { success: false, error: "Lead not found" };
    if (!oldLead.isSelfBooked) return { success: false, error: "Lead is not a self-booked webinar" };
    if (oldLead.salespersonUserId) return { success: false, error: "Lead already assigned" };
    if (!oldLead.appointmentDate) return { success: false, error: "Lead has no appointmentDate" };

    const [sp] = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, salespersonId), eq(users.role, 'VENDITORE'))).limit(1);
    if (!sp) return { success: false, error: "Salesperson not found" };

    const updated = await db.update(leads).set({
        salespersonUserId: sp.id,
        salespersonAssigned: sp.name,
        salespersonAssignedAt: new Date(),
        confirmationsOutcome: 'confermato',
        confirmationsUserId: session.user.id,
        confirmationsTimestamp: new Date(),
        version: oldLead.version + 1,
        updatedAt: new Date(),
    }).where(and(eq(leads.id, leadId), eq(leads.version, oldLead.version))).returning({ id: leads.id });

    if (updated.length === 0) return { success: false, error: "CONCURRENCY_ERROR" };

    // Marketing webhooks (same as setConfermeOutcome).
    await enqueueMarketingWebhook({
        eventType: 'appointment.outcome',
        leadId,
        actorUserId: session.user.id,
    }).catch((e: unknown) => console.error("Marketing webhook (appointment.outcome) err:", e));
    await enqueueMarketingWebhook({
        eventType: 'deal.assigned',
        leadId,
        actorUserId: session.user.id,
    }).catch((e: unknown) => console.error("Marketing webhook (deal.assigned) err:", e));

    // Google Calendar event for the venditore.
    const apptDate = new Date(oldLead.appointmentDate);
    const endTime = addHours(apptDate, 1);
    await createGoogleCalendarEvent(
        sp.id,
        {
            summary: `Appuntamento CRM: ${oldLead.name}`,
            description: `Lead: ${oldLead.name}\nTelefono: ${oldLead.phone}\nEmail: ${oldLead.email || 'N/A'}\nFunnel: ${oldLead.funnel || 'N/A'}\n\nLink CRM: ${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/venditore`,
            startTime: apptDate,
            endTime: endTime,
            attendees: oldLead.email ? [{ email: oldLead.email }] : [],
        },
        leadId,
        "appointment"
    ).catch(err => console.error("Could not create calendar event:", err.message));

    // Lead event log.
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId,
        eventType: "webinar_lead_assigned",
        userId: session.user.id,
        timestamp: new Date(),
        metadata: { salespersonAssigned: sp.name, salespersonId: sp.id, source: 'webinar_self_booked' },
    });

    // Gamification — counts as a CONFERMATO for the Conferme user.
    const rewardData = await awardXpAndCoins(session.user.id, "CONFERMATO", leadId).catch(e => { console.error("GameEngine CONFERMATO err:", e); return null; });
    incrementChestProgress(session.user.id, 'conferme', 1).catch(e => console.error("Chest conferme err:", e));
    attackBoss(session.user.id, 'conferma').catch(e => console.error("Adventure conferma err:", e));
    checkAndAdvanceStage(session.user.id).catch(e => console.error("Adventure stage check err:", e));
    maybeDropCreature(session.user.id).catch(e => console.error("Creature drop err:", e));

    return { success: true, rewardData };
}
```

- [ ] **Step 3.2:** TS typecheck via `npx tsc --noEmit`. Expected: 0 errors.

---

### Task 4: `WebinarSelfBookedSection` component

**Files:**
- Create: `src/components/WebinarSelfBookedSection.tsx`

- [ ] **Step 4.1:** Create the file with this exact content:

```tsx
"use client"

import { useEffect, useState, useTransition } from "react"
import { Sparkles, Phone, MessageCircle, Loader2, CheckCircle2 } from "lucide-react"
import { getWebinarSelfBookedLeads, listVenditoriForAssignment, assignWebinarLeadToSalesperson } from "@/app/actions/confermeActions"

type WebinarLead = {
    id: string
    name: string
    phone: string
    appointmentDate: Date | string | null
    appointmentNote: string | null
}

type Venditore = { id: string; name: string; displayName: string | null }

function formatHour(d: Date | string | null): string {
    if (!d) return "—"
    const dt = typeof d === "string" ? new Date(d) : d
    return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }).format(dt)
}

function formatDate(d: Date | string | null): string {
    if (!d) return "—"
    const dt = typeof d === "string" ? new Date(d) : d
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Rome" }).format(dt)
}

export function WebinarSelfBookedSection() {
    const [leads, setLeads] = useState<WebinarLead[]>([])
    const [venditori, setVenditori] = useState<Venditore[]>([])
    const [openDropdownFor, setOpenDropdownFor] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [assigningId, setAssigningId] = useState<string | null>(null)
    const [, startTransition] = useTransition()

    const refresh = () => {
        setLoading(true)
        Promise.all([getWebinarSelfBookedLeads(), listVenditoriForAssignment()])
            .then(([l, v]) => { setLeads(l as WebinarLead[]); setVenditori(v as Venditore[]) })
            .catch(e => console.error("WebinarSelfBookedSection load err:", e))
            .finally(() => setLoading(false))
    }

    useEffect(() => { refresh() }, [])

    const handleAssign = (leadId: string, salespersonId: string) => {
        setAssigningId(leadId)
        startTransition(async () => {
            const res = await assignWebinarLeadToSalesperson(leadId, salespersonId)
            if (res.success) {
                setLeads(prev => prev.filter(l => l.id !== leadId))
                setOpenDropdownFor(null)
            } else {
                alert(`Errore assegnazione: ${res.error}`)
            }
            setAssigningId(null)
        })
    }

    return (
        <div className="rounded-2xl border-2 border-purple-300 bg-gradient-to-br from-purple-50 via-white to-fuchsia-50 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                    <h2 className="text-lg font-bold text-purple-900">Appuntamenti Webinar (self-booked)</h2>
                </div>
                <span className="text-xs font-semibold uppercase tracking-wide text-purple-700 bg-purple-100 px-2 py-1 rounded-full">
                    {loading ? "…" : `${leads.length} da assegnare`}
                </span>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-sm text-purple-700"><Loader2 className="w-4 h-4 animate-spin" /> Caricamento…</div>
            ) : leads.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-purple-700/70">
                    <CheckCircle2 className="w-4 h-4" /> Nessun appuntamento webinar in attesa di assegnazione.
                </div>
            ) : (
                <ul className="divide-y divide-purple-100">
                    {leads.map(lead => {
                        const isOpen = openDropdownFor === lead.id
                        const isBusy = assigningId === lead.id
                        return (
                            <li key={lead.id} className="py-3 flex flex-wrap items-center gap-3">
                                <div className="flex-1 min-w-[200px]">
                                    <div className="font-semibold text-ash-800">{lead.name}</div>
                                    <div className="text-xs text-ash-500 flex items-center gap-2 mt-0.5">
                                        <a href={`tel:${lead.phone}`} className="hover:underline flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</a>
                                        <a href={`https://wa.me/39${lead.phone}`} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1 text-emerald-600"><MessageCircle className="w-3 h-3" />WhatsApp</a>
                                    </div>
                                </div>
                                <div className="text-sm font-medium text-purple-800 px-2 py-1 rounded-md bg-purple-100">
                                    {formatDate(lead.appointmentDate)} · {formatHour(lead.appointmentDate)}
                                </div>
                                <div className="relative">
                                    <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => setOpenDropdownFor(isOpen ? null : lead.id)}
                                        className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-semibold transition"
                                    >
                                        {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assegna a venditore"}
                                    </button>
                                    {isOpen && !isBusy && (
                                        <div className="absolute right-0 mt-2 w-56 bg-white border border-purple-200 rounded-lg shadow-lg z-10 max-h-72 overflow-y-auto">
                                            {venditori.length === 0 ? (
                                                <div className="p-3 text-sm text-ash-500">Nessun venditore disponibile</div>
                                            ) : venditori.map(v => (
                                                <button
                                                    key={v.id}
                                                    type="button"
                                                    onClick={() => handleAssign(lead.id, v.id)}
                                                    className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 transition"
                                                >
                                                    {v.displayName || v.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
```

- [ ] **Step 4.2:** TS typecheck via `npx tsc --noEmit`. Expected: 0 errors.

---

### Task 5: Wire into `/conferme` page

**Files:**
- Modify: `src/app/(dashboard)/conferme/page.tsx`

- [ ] **Step 5.1:** Edit `src/app/(dashboard)/conferme/page.tsx`. Add dynamic import after the `ConfermeBoard` dynamic import (around line 10):

```tsx
const WebinarSelfBookedSection = dynamic(() => import("@/components/WebinarSelfBookedSection").then(m => ({ default: m.WebinarSelfBookedSection })), { ssr: false })
```

- [ ] **Step 5.2:** Inside the JSX, immediately before the `<SafeWrapper><HotStreak><ConfermeBoard ... /></HotStreak></SafeWrapper>` block (around line 53), add:

```tsx
<SafeWrapper><WebinarSelfBookedSection /></SafeWrapper>
```

- [ ] **Step 5.3:** TS typecheck via `npx tsc --noEmit`. Expected: 0 errors.

---

### Task 6: Build verification

- [ ] **Step 6.1:** Run `npm run build`. Expected: build succeeds with no type errors and no fatal warnings.

---

### Task 7: Commit + push + deploy

- [ ] **Step 7.1:** Stage changes:

```bash
git add src/db/schema.ts drizzle/migrations/0002_lead_is_self_booked.sql src/app/actions/confermeActions.ts src/components/WebinarSelfBookedSection.tsx "src/app/(dashboard)/conferme/page.tsx"
```

- [ ] **Step 7.2:** Commit:

```bash
git commit -m "$(cat <<'EOF'
feat(conferme): webinar self-booked section + assign-to-salesperson

Adds isSelfBooked flag on leads, dedicated Conferme dashboard section
listing self-booked webinar appointments, and one-click assignment to
a venditore that mirrors the existing setConfermeOutcome flow
(GCal sync, marketing webhooks, gamification).
EOF
)"
```

- [ ] **Step 7.3:** Push to main:

```bash
git push origin main
```

Expected: push succeeds. Vercel auto-deploys.

---

## Self-review

- Spec coverage: all 5 sections of the spec are covered (schema in Task 1, seed in Task 2, server actions in Task 3, UI in Tasks 4–5, deploy in Tasks 6–7). ✅
- Placeholders: none. ✅
- Type consistency: `assignWebinarLeadToSalesperson(leadId, salespersonId)` matches the UI call site. `getWebinarSelfBookedLeads`/`listVenditoriForAssignment`/`assignWebinarLeadToSalesperson` names consistent across server and client. ✅
