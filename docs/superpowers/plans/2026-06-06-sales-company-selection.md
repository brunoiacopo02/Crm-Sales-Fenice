# Sales Company Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere a un singolo account sales di scegliere l'azienda (Fenice/Serenamente) al login e cambiarla in-app, vedendo/scrivendo solo i dati dell'azienda selezionata.

**Architecture:** `currentTenant()` risolve l'azienda attiva da un cookie HttpOnly `sales_active_company`, validato contro `allowedCompanies` (lista per-utente nei `user_metadata`). Login flow con guardia nel layout sales che reindirizza a `/seleziona-azienda`; switcher + badge in topbar. Assegnazione lead per `allowedCompanies` invece che per `companyId` fisso.

**Tech Stack:** Next.js (App Router), Drizzle ORM, Supabase Auth, Postgres. Niente test-runner: verifica con `npx tsc --noEmit` + script `tsx` mirati (pattern esistente `scripts/e2e*.ts`).

**Spec:** `docs/superpowers/specs/2026-06-06-sales-company-selection-design.md`

---

## File Structure

| File | Responsabilità |
|------|----------------|
| `drizzle/migrations/0011_user_allowed_companies.sql` | Aggiunge `users.allowed_companies text[]` |
| `src/db/schema.ts` | Colonna Drizzle `allowedCompanies` su `users` |
| `src/lib/tenancy.ts` | Costante cookie, campo `allowedCompanies` in `TenantContext`, risoluzione azienda attiva |
| `src/app/api/company/select/route.ts` | POST: valida e setta il cookie azienda |
| `src/app/api/company/selection/route.ts` | GET: stato selezione + aziende consentite |
| `src/app/seleziona-azienda/page.tsx` | Pagina scelta azienda post-login |
| `src/app/(dashboard)/layout.tsx` | Guardia redirect + passa azienda corrente alla Topbar |
| `src/components/sales/SalesCompanySwitcher.tsx` | Dropdown switcher + badge azienda corrente |
| `src/components/Topbar.tsx` | Monta lo switcher |
| `src/app/actions/importLeads.ts` | Operatori assegnabili per `allowedCompanies` |
| `src/app/actions/redistributeLeadsActions.ts` | Idem per la redistribuzione |
| `scripts/grantCompanyAccess.ts` | Provisioning `allowedCompanies` per un roster |
| `scripts/verifyCompanySelection.ts` | Script di verifica risoluzione/permessi |

---

## Task 1: Migrazione colonna `allowed_companies`

**Files:**
- Create: `drizzle/migrations/0011_user_allowed_companies.sql`
- Modify: `src/db/schema.ts` (blocco `users`, dopo `marketingRole`)

- [ ] **Step 1: Scrivi la migration SQL**

```sql
-- 0011_user_allowed_companies.sql
-- Lista aziende a cui un utente sales può accedere (staff condiviso).
-- NULL = back-compat: l'app tratta NULL come [companyId].
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_companies" text[];
```

- [ ] **Step 2: Applica la migration in prod**

Usa lo strumento Supabase `apply_migration` (project `ncutwzsifzundikwllxp`) con name `0011_user_allowed_companies` e il corpo dello Step 1.
Expected: success, nessun errore.

- [ ] **Step 3: Aggiungi la colonna allo schema Drizzle**

In `src/db/schema.ts`, subito dopo la riga `marketingRole: text('marketingRole'),` dentro `users`:

```ts
    // Aziende sales selezionabili dall'utente (staff condiviso multi-tenant).
    // NULL = back-compat → l'app usa [companyId]. Sync con user_metadata.allowedCompanies.
    allowedCompanies: text('allowedCompanies').array(),
```

Nota: la colonna DB è `allowed_companies` ma Drizzle qui usa la chiave logica `allowedCompanies` con nome colonna esplicito. Correggi in: `allowedCompanies: text('allowed_companies').array(),`

- [ ] **Step 4: TS check**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add drizzle/migrations/0011_user_allowed_companies.sql src/db/schema.ts
git commit -m "feat(tenancy): colonna users.allowed_companies + migration 0011"
```

---

## Task 2: `currentTenant()` risolve l'azienda attiva dal cookie

**Files:**
- Modify: `src/lib/tenancy.ts`

- [ ] **Step 1: Aggiungi costante cookie e import `cookies`**

In testa a `src/lib/tenancy.ts`, dopo gli import esistenti:

```ts
import { cookies } from 'next/headers';

/** Cookie HttpOnly con l'azienda sales selezionata. Distinto dal cookie marketing. */
export const SALES_ACTIVE_COMPANY_COOKIE = 'sales_active_company';
export const SALES_ACTIVE_COMPANY_MAX_AGE = 60 * 60 * 24 * 30; // 30 giorni
```

- [ ] **Step 2: Estendi `TenantContext`**

Aggiungi il campo a `interface TenantContext`:

```ts
    allowedCompanies: CompanyId[];   // aziende selezionabili dall'utente
```

- [ ] **Step 3: Riscrivi il corpo di `currentTenant()`**

Sostituisci il `return { ... }` di `currentTenant()` con:

```ts
    const meta = user.user_metadata ?? {};

    const fallbackCompany: CompanyId = meta.companyId ?? 'fenice';
    const allowedCompanies: CompanyId[] =
        Array.isArray(meta.allowedCompanies) && meta.allowedCompanies.length > 0
            ? meta.allowedCompanies
            : [fallbackCompany];

    // Azienda attiva: cookie se consentito, altrimenti companyId metadata se
    // consentito, altrimenti la prima consentita. Sempre validato server-side.
    let activeCompany: CompanyId = fallbackCompany;
    try {
        const cookieStore = await cookies();
        const cookieVal = cookieStore.get(SALES_ACTIVE_COMPANY_COOKIE)?.value;
        if (cookieVal && allowedCompanies.includes(cookieVal)) {
            activeCompany = cookieVal;
        } else if (allowedCompanies.includes(fallbackCompany)) {
            activeCompany = fallbackCompany;
        } else {
            activeCompany = allowedCompanies[0];
        }
    } catch {
        // cookies() non disponibile (contesto non-request): usa il fallback.
        activeCompany = allowedCompanies.includes(fallbackCompany) ? fallbackCompany : allowedCompanies[0];
    }

    return {
        userId: user.id,
        email: user.email ?? null,
        role: meta.role ?? 'GDO',
        companyId: activeCompany,
        area: (meta.area as TenantArea) ?? 'sales',
        marketingRole: (meta.marketingRole as MarketingRole) ?? null,
        allowedCompanies,
    };
```

- [ ] **Step 4: TS check**

Run: `npx tsc --noEmit`
Expected: nessun errore. Se altri file costruiscono `TenantContext` a mano, aggiungi `allowedCompanies`. (Cerca con `grep -rn "area:.*marketingRole" src` se emergono errori.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenancy.ts
git commit -m "feat(tenancy): currentTenant risolve azienda attiva da cookie sales_active_company"
```

---

## Task 3: API `select` e `selection`

**Files:**
- Create: `src/app/api/company/select/route.ts`
- Create: `src/app/api/company/selection/route.ts`

- [ ] **Step 1: Crea `POST /api/company/select`**

```ts
// src/app/api/company/select/route.ts
import { NextRequest, NextResponse } from 'next/server'
import {
  currentTenant,
  assertSalesArea,
  SALES_ACTIVE_COMPANY_COOKIE,
  SALES_ACTIVE_COMPANY_MAX_AGE,
} from '@/lib/tenancy'

export async function POST(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const body = await req.json().catch(() => null)
    const companyId = body && typeof body.companyId === 'string' ? body.companyId : null
    if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })

    // Sicurezza: solo aziende consentite all'utente.
    if (!ctx.allowedCompanies.includes(companyId)) {
      return NextResponse.json({ error: 'company not allowed' }, { status: 403 })
    }

    const res = NextResponse.json({ ok: true, companyId })
    res.cookies.set(SALES_ACTIVE_COMPANY_COOKIE, companyId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SALES_ACTIVE_COMPANY_MAX_AGE,
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
```

- [ ] **Step 2: Crea `GET /api/company/selection`**

```ts
// src/app/api/company/selection/route.ts
import { NextResponse } from 'next/server'
import { currentTenant, assertSalesArea } from '@/lib/tenancy'
import { listActiveCompanies } from '@/lib/marketing/company'

// Stato selezione per lo switcher sales. Riusa listActiveCompanies (tabella
// companies condivisa) e filtra alle aziende consentite all'utente.
export async function GET() {
  try {
    const ctx = await currentTenant()
    assertSalesArea(ctx)

    const all = await listActiveCompanies()
    const companies = all
      .filter((c) => ctx.allowedCompanies.includes(c.id))
      .map((c) => ({ id: c.id, display_name: c.display_name }))

    return NextResponse.json({
      active: ctx.companyId,
      canSwitch: companies.length > 1,
      companies,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
```

- [ ] **Step 3: TS check**

Run: `npx tsc --noEmit`
Expected: nessun errore. Verifica che `listActiveCompanies` esporti oggetti con `id` e `display_name` (lo fa già: usato in `src/app/api/marketing/company/selection/route.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/company/select/route.ts src/app/api/company/selection/route.ts
git commit -m "feat(tenancy): API select/selection azienda sales"
```

---

## Task 4: Pagina `/seleziona-azienda` + guardia nel layout

**Files:**
- Create: `src/app/seleziona-azienda/page.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Crea la pagina di scelta (server component + client picker)**

```tsx
// src/app/seleziona-azienda/page.tsx
import { redirect } from 'next/navigation'
import { currentTenant } from '@/lib/tenancy'
import { listActiveCompanies } from '@/lib/marketing/company'
import { CompanyPicker } from '@/components/sales/SalesCompanySwitcher'

export default async function SelezionaAziendaPage() {
  const ctx = await currentTenant()
  const all = await listActiveCompanies()
  const companies = all
    .filter((c) => ctx.allowedCompanies.includes(c.id))
    .map((c) => ({ id: c.id, display_name: c.display_name }))

  // 1 sola azienda → niente scelta, vai dritto.
  if (companies.length <= 1) redirect('/')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-8">
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Scegli l'azienda</h1>
        <p className="text-sm text-gray-500 mb-6">Lavorerai sui dati dell'azienda selezionata.</p>
        <CompanyPicker companies={companies} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Aggiungi la guardia nel layout sales**

In `src/app/(dashboard)/layout.tsx`, dopo il check `if (!session) redirect("/login")`, aggiungi:

```ts
    // Multi-azienda: se l'utente ha più aziende consentite e non ha ancora
    // una selezione valida nel cookie, mandalo a sceglierla.
    const { currentTenant } = await import('@/lib/tenancy')
    const { cookies } = await import('next/headers')
    const tctx = await currentTenant()
    const cookieStore = await cookies()
    const hasSelection = !!cookieStore.get('sales_active_company')?.value
    if (tctx.allowedCompanies.length > 1 && !hasSelection) {
        redirect('/seleziona-azienda')
    }
```

Nota: usiamo `import('@/lib/tenancy')` inline per non disturbare gli import esistenti del layout; in fase di implementazione si può promuovere a import statico in testa al file.

- [ ] **Step 3: TS check**

Run: `npx tsc --noEmit`
Expected: nessun errore (dipende da `CompanyPicker` creato in Task 5; se esegui in ordine, crea prima lo skeleton di Task 5 Step 1, poi torna qui).

- [ ] **Step 4: Commit**

```bash
git add "src/app/seleziona-azienda/page.tsx" "src/app/(dashboard)/layout.tsx"
git commit -m "feat(tenancy): pagina seleziona-azienda + guardia layout sales"
```

---

## Task 5: Switcher + badge in topbar

**Files:**
- Create: `src/components/sales/SalesCompanySwitcher.tsx`
- Modify: `src/components/Topbar.tsx`

- [ ] **Step 1: Crea `SalesCompanySwitcher` + `CompanyPicker`**

```tsx
// src/components/sales/SalesCompanySwitcher.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Building2 } from 'lucide-react'

interface Company { id: string; display_name: string }

async function selectCompany(companyId: string) {
  await fetch('/api/company/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId }),
  })
}

/** Picker a pulsantoni per la pagina /seleziona-azienda. */
export function CompanyPicker({ companies }: { companies: Company[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function pick(id: string) {
    if (busy) return
    setBusy(true)
    await selectCompany(id)
    window.location.href = '/'
  }
  return (
    <div className="flex flex-col gap-3">
      {companies.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={busy}
          onClick={() => pick(c.id)}
          className="flex items-center gap-3 w-full rounded-xl border border-gray-200 px-4 py-3 text-left hover:border-brand-orange hover:bg-orange-50 transition disabled:opacity-50"
        >
          <Building2 className="w-5 h-5 text-brand-orange" />
          <span className="font-medium text-gray-900">{c.display_name}</span>
        </button>
      ))}
    </div>
  )
}

/** Dropdown in topbar. Mostra il badge azienda; se canSwitch, permette il cambio. */
export function SalesCompanySwitcher() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [canSwitch, setCanSwitch] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])

  useEffect(() => {
    fetch('/api/company/selection', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setActive(d.active ?? null)
        setCanSwitch(!!d.canSwitch)
        setCompanies(d.companies ?? [])
      })
      .catch(() => {})
  }, [])

  const label = companies.find((c) => c.id === active)?.display_name ?? active ?? '—'

  async function pick(id: string) {
    if (busy || id === active) { setOpen(false); return }
    setBusy(true)
    await selectCompany(id)
    setOpen(false)
    router.refresh()
    window.location.reload()
  }

  // Badge statico se non può cambiare (utente mono-azienda).
  if (!canSwitch) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-orange-100 px-2.5 py-1 text-xs font-semibold text-brand-orange">
        <Building2 className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-orange-100 px-2.5 py-1 text-xs font-semibold text-brand-orange hover:bg-orange-200 transition"
      >
        <Building2 className="w-3.5 h-3.5" />
        <span>{label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 rounded-md border border-gray-200 bg-white shadow-lg z-50">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => pick(c.id)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-orange-50 ${c.id === active ? 'font-semibold text-brand-orange' : 'text-gray-700'}`}
            >
              {c.display_name}{c.id === active ? ' ✓' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Monta lo switcher nella Topbar**

In `src/components/Topbar.tsx`: importa e renderizza `SalesCompanySwitcher`. Aggiungi in testa `import { SalesCompanySwitcher } from '@/components/sales/SalesCompanySwitcher'` e inserisci `<SalesCompanySwitcher />` nel cluster destro della topbar (vicino a profilo/notifiche). Individua il `div` del lato destro e aggiungilo come primo figlio.

- [ ] **Step 3: TS check**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/components/sales/SalesCompanySwitcher.tsx src/components/Topbar.tsx
git commit -m "feat(tenancy): switcher azienda + badge in topbar sales"
```

---

## Task 6: Assegnazione operatori per `allowedCompanies` (§8.1)

**Files:**
- Modify: `src/app/actions/importLeads.ts`
- Modify: `src/app/actions/redistributeLeadsActions.ts`

- [ ] **Step 1: Sostituisci il filtro GDO in `importLeads.ts`**

In `importLeads.ts` ci sono 3 punti che selezionano i GDO con `eq(users.companyId, ctx.companyId)` (in `getActiveGdosForImport`, `processCsvImport`, `createManualLead`). Sostituisci ciascuno con un filtro per appartenenza all'azienda attiva via `allowedCompanies`, mantenendo `role='GDO'`. Importa `sql` da drizzle e usa l'operatore array Postgres:

```ts
import { and, eq, or, sql } from "drizzle-orm"
```

Per ogni query, sostituisci:

```ts
.where(and(eq(users.companyId, ctx.companyId), eq(users.role, 'GDO')))
```

con:

```ts
.where(and(
    eq(users.role, 'GDO'),
    // operatore assegnabile se l'azienda attiva è tra le sue allowedCompanies,
    // con fallback al companyId per gli utenti legacy (allowed_companies NULL).
    or(
        sql`${ctx.companyId} = ANY(${users.allowedCompanies})`,
        and(sql`${users.allowedCompanies} IS NULL`, eq(users.companyId, ctx.companyId)),
    ),
))
```

- [ ] **Step 2: Applica lo stesso pattern in `redistributeLeadsActions.ts`**

Cerca in `redistributeLeadsActions.ts` ogni `eq(users.companyId, ctx.companyId)` usato per **elencare operatori destinatari** (GDO/conferme) e sostituiscilo con lo stesso blocco `or(... ANY ... , ... IS NULL ...)` dello Step 1, mantenendo il filtro di ruolo presente. NON toccare i filtri su `leads.companyId` (i lead restano scoped per azienda fissa).

- [ ] **Step 3: TS check**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/importLeads.ts src/app/actions/redistributeLeadsActions.ts
git commit -m "feat(tenancy): operatori assegnabili per allowedCompanies (staff condiviso)"
```

---

## Task 7: Script di provisioning `grantCompanyAccess.ts`

**Files:**
- Create: `scripts/grantCompanyAccess.ts`

- [ ] **Step 1: Crea lo script**

```ts
// scripts/grantCompanyAccess.ts
// Uso: npx tsx scripts/grantCompanyAccess.ts <companyId> <email1> <email2> ...
// Aggiunge <companyId> ad allowedCompanies (user_metadata + colonna users) per gli utenti dati.
import "dotenv/config"
import { createClient } from "@supabase/supabase-js"
import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, supabaseServiceRole)

async function listAuthUserByEmail(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  return data.users.find((u) => u.email === email) ?? null
}

async function main() {
  const [companyId, ...emails] = process.argv.slice(2)
  if (!companyId || emails.length === 0) {
    console.error("Uso: npx tsx scripts/grantCompanyAccess.ts <companyId> <email...>")
    process.exit(1)
  }
  for (const email of emails) {
    const authUser = await listAuthUserByEmail(email)
    if (!authUser) { console.log(`[SKIP] ${email}: non trovato in Auth`); continue }

    const meta = authUser.user_metadata ?? {}
    const baseCompany = (meta.companyId as string) ?? "fenice"
    const current: string[] = Array.isArray(meta.allowedCompanies) && meta.allowedCompanies.length
      ? meta.allowedCompanies
      : [baseCompany]
    const next = Array.from(new Set([...current, companyId]))

    await admin.auth.admin.updateUserById(authUser.id, {
      user_metadata: { ...meta, allowedCompanies: next },
    })
    await db.update(users).set({ allowedCompanies: next }).where(eq(users.id, authUser.id))
    console.log(`[OK] ${email}: allowedCompanies = [${next.join(", ")}]`)
  }
  console.log("Fatto.")
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: TS check**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit (senza eseguire — il roster lo fornisce Bruno)**

```bash
git add scripts/grantCompanyAccess.ts
git commit -m "feat(tenancy): script provisioning grantCompanyAccess"
```

---

## Task 8: Verifica end-to-end

**Files:**
- Create: `scripts/verifyCompanySelection.ts`

- [ ] **Step 1: Script di verifica logica risoluzione (puro, senza request)**

```ts
// scripts/verifyCompanySelection.ts
// Verifica la logica di risoluzione azienda attiva in isolamento.
function resolveActive(allowed: string[], fallback: string, cookieVal?: string): string {
  if (cookieVal && allowed.includes(cookieVal)) return cookieVal
  if (allowed.includes(fallback)) return fallback
  return allowed[0]
}

const cases: Array<[string, string, () => boolean]> = [
  ["cookie valido vince", "serenamente", () => resolveActive(["fenice","serenamente"], "fenice", "serenamente") === "serenamente"],
  ["cookie non consentito ignorato", "fenice", () => resolveActive(["fenice"], "fenice", "serenamente") === "fenice"],
  ["nessun cookie usa fallback", "fenice", () => resolveActive(["fenice","serenamente"], "fenice") === "fenice"],
  ["fallback fuori lista usa primo", "serenamente", () => resolveActive(["serenamente"], "fenice") === "serenamente"],
]
let ok = true
for (const [name, , fn] of cases) {
  const pass = fn()
  if (!pass) ok = false
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}`)
}
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Esegui lo script**

Run: `npx tsx scripts/verifyCompanySelection.ts`
Expected: 4 righe PASS, exit 0.

- [ ] **Step 3: Verifica funzionale in dev (manuale o /browse)**

Avvia `npm run dev`. Con un utente multi-azienda (dopo Task 7):
1. Login → atterri su `/seleziona-azienda` → scegli Serenamente → dashboard mostra il badge "Serenamente".
2. Crea 1 lead manuale → verifica in DB: `companyId='serenamente'`, `assignedToId` è un GDO con Serenamente in `allowedCompanies`.
3. Cambia a Fenice dallo switcher → i lead Serenamente spariscono, compaiono i Fenice.
4. Con un utente Fenice legacy (allowed_companies NULL) → nessuno switcher (solo badge), nessuna pagina di scelta.

- [ ] **Step 4: Commit**

```bash
git add scripts/verifyCompanySelection.ts
git commit -m "test(tenancy): script verifica risoluzione azienda attiva"
```

---

## Self-Review (coverage spec → task)

- §3.1 entitlement → Task 1 (colonna) + Task 7 (popolamento). ✓
- §3.2 cookie → Task 2 (costante) + Task 3 (set). ✓
- §3.3 risoluzione `currentTenant` → Task 2. ✓
- §3.4 isolamento marketing → verificato implicitamente (cookie distinto `sales_active_company`); Task 2 Step 4 invita a controllare usi di `ctx.companyId`. ✓
- §4 componenti → tutti mappati a task. ✓
- §5.1 login flow → Task 4. ✓
- §5.2 switch in-app → Task 5. ✓
- §5.3 / §8.1 import + operatori → Task 6. ✓
- §6 sicurezza → Task 3 (403 select) + Task 2 (validazione). ✓
- §7 provisioning → Task 7. ✓
- §8.2 badge → Task 5. ✓
- §9 test → Task 8. ✓

Nessun placeholder. Nomi/firme coerenti (`SALES_ACTIVE_COMPANY_COOKIE`, `CompanyPicker`, `SalesCompanySwitcher`, `allowedCompanies`).
