# Serenamente Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Restyling brand SerenaMente (verde salvia accento + navy testo + font Sora + logo) su tutto il CRM lato Serenamente, senza toccare Fenice.

**Architecture:** Theming per-azienda via override dei token CSS Tailwind v4 sotto `[data-company="serenamente"]`, attributo impostato server-side sulla root della dashboard. Logo condizionale per `companyId`. Font Sora caricata come variabile e applicata solo nello scope.

**Spec:** `docs/superpowers/specs/2026-06-06-serenamente-restyle-design.md`

---

## Task 1: Carica il font Sora (no impatto Fenice)

**File:** `src/app/layout.tsx`

- [ ] **Step 1:** In cima, aggiungi `Sora` all'import next/font e crea l'istanza. Cambia:
```ts
import { Geist, Geist_Mono } from "next/font/google";
```
in:
```ts
import { Geist, Geist_Mono, Sora } from "next/font/google";
```
e dopo `geistMono`:
```ts
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
});
```

- [ ] **Step 2:** Aggiungi `sora.variable` alla className del body:
```tsx
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} antialiased`}
      >
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

- [ ] **Step 4:** Commit:
```bash
git add src/app/layout.tsx
git commit -m "feat(serenamente): carica font Sora come --font-sora"
```

---

## Task 2: Theme override + wiring scope

**Files:** `src/app/globals.css`, `src/app/(dashboard)/layout.tsx`

- [ ] **Step 1:** In `src/app/globals.css`, in fondo al file, aggiungi il blocco scope:
```css
/* === Tema SerenaMente — attivo solo quando l'azienda selezionata è 'serenamente'.
   Sovrascrive i token brand (verde salvia accento + navy testo) e il font (Sora).
   Tutte le utility brand-* cascano automaticamente su questi valori. Fenice intatto. === */
[data-company="serenamente"] {
  --color-brand-orange-50:  #F1F7F3;
  --color-brand-orange-100: #DDEBE2;
  --color-brand-orange-200: #BFD9C9;
  --color-brand-orange-300: #9CC6AC;
  --color-brand-orange-400: #78B48C;
  --color-brand-orange-500: #5E9E74;
  --color-brand-orange-600: #4A8460;
  --color-brand-orange-700: #3B6A4D;
  --color-brand-orange-800: #2F543E;
  --color-brand-orange-900: #243F2F;
  --color-brand-orange:        #78B48C;
  --color-brand-orange-hover:  #5E9E74;
  --color-brand-charcoal:      #191970;

  --font-display: var(--font-sora), var(--font-geist-sans), sans-serif;
  --font-sans:    var(--font-sora), var(--font-geist-sans), sans-serif;
  font-family: var(--font-sans);
}

/* Sfumature verdi soft della brand sull'area principale (molto tenui, no impatto leggibilità) */
[data-company="serenamente"] main {
  background-image:
    radial-gradient(60rem 60rem at 100% 0%, rgba(120,180,140,0.07), transparent 70%),
    radial-gradient(50rem 50rem at 0% 100%, rgba(120,180,140,0.06), transparent 70%);
}
```

- [ ] **Step 2:** In `src/app/(dashboard)/layout.tsx`, aggiungi `data-company` alla root visibile (riga ~57) e passa `companyId` a `Sidebar` (riga ~58). Cambia:
```tsx
                <div className={`flex h-screen overflow-hidden font-sans ${isTheme ? skinCss : 'bg-gray-50'}`}>
                    <Sidebar />
```
in:
```tsx
                <div data-company={tctx.companyId} className={`flex h-screen overflow-hidden font-sans ${isTheme ? skinCss : 'bg-gray-50'}`}>
                    <Sidebar companyId={tctx.companyId} />
```
(`tctx` è già definito sopra dalla guardia multi-azienda.)

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0. (Sidebar accetterà la prop `companyId` dopo il Task 3; se esegui in ordine, fai prima lo skeleton del Task 3 Step 1 o ignora temporaneamente l'errore di prop e committa dopo il Task 3. Preferibile: esegui Task 3 prima di questo Step 3.)

- [ ] **Step 4:** Commit:
```bash
git add src/app/globals.css "src/app/(dashboard)/layout.tsx"
git commit -m "feat(serenamente): tema scoped (token verde/navy + Sora + sfondo) e wiring data-company"
```

---

## Task 3: Logo SerenaMente

**Files:** `src/components/SerenaMenteLogo.tsx` (new), `src/components/Sidebar.tsx`

- [ ] **Step 1:** Crea `src/components/SerenaMenteLogo.tsx`:
```tsx
import { Brain } from "lucide-react"

/** Logo SerenaMente per la sidebar (sfondo scuro): badge verde salvia con
 *  cervello navy + wordmark bianco + payoff. Font Sora. */
export function SerenaMenteLogo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-lg bg-[#78B48C] flex items-center justify-center shrink-0 shadow-sm">
        <Brain className="w-5 h-5 text-[#191970]" />
      </div>
      <div className="flex flex-col leading-tight">
        <span
          className="font-bold text-base text-white tracking-wide"
          style={{ fontFamily: "var(--font-sora), sans-serif" }}
        >
          SerenaMente
        </span>
        <span className="text-[10px] text-[#78B48C] tracking-wide -mt-0.5">crescita mentale</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** In `src/components/Sidebar.tsx`:
  - Cambia la firma per accettare la prop: `export function Sidebar({ companyId }: { companyId?: string }) {`
  - Aggiungi l'import: `import { SerenaMenteLogo } from "@/components/SerenaMenteLogo"`
  - READ le righe ~164-172 (blocco `{/* Logo */}`). Rendi il logo condizionale: quando `companyId === 'serenamente'` mostra `<SerenaMenteLogo />`, altrimenti il blocco Fenice esistente (il `<div className="w-9 h-9 ... from-brand-orange to-fire-500 ...">…</div>` + `<span>Fenice CRM</span>`). Mantieni intatto il wrapper/anchor esterno del logo. Esempio:
```tsx
{/* Logo */}
{companyId === 'serenamente' ? (
    <SerenaMenteLogo />
) : (
    <>
        {/* blocco logo Fenice ESISTENTE — non modificarlo */}
    </>
)}
```

- [ ] **Step 3:** `npx tsc --noEmit` → exit 0.

- [ ] **Step 4:** Commit:
```bash
git add src/components/SerenaMenteLogo.tsx src/components/Sidebar.tsx
git commit -m "feat(serenamente): logo SerenaMente condizionale in sidebar"
```

---

## Task 4: QA visiva (eseguita dal controller, non da subagent)

Non automatizzabile via test runner. Il controller:
1. `npx tsc --noEmit` finale pulito sul merge.
2. Avvia dev o usa prod; login come Serenamente (`admin@fenice.com`).
3. Screenshot via Playwright: GDO board, pipeline, dashboard manager/KPI, classifica, store, ContactDrawer.
4. Verifica: accenti verde salvia, testo/titoli navy, font Sora, logo SerenaMente, nessun arancione "brand" residuo evidente, contrasti AA.
5. Fix a vista degli arancioni brand hardcoded residui (convertendo `orange-*`/`amber-*` letterali **brand** a `brand-orange` dove sono accenti UI, NON dove sono gaming) + contrasti. Commit atomici.
6. Non-regressione Fenice: login come Fenice → arancione, Geist, logo Fenice invariati.

---

## Self-Review (coverage)
- Spec §4.1 token override → Task 2 Step 1. ✓
- Spec §4.2 font Sora → Task 1 + Task 2 (override --font-sans/display). ✓
- Spec §4.3 sfondo soft → Task 2 Step 1. ✓
- Spec §4.4 logo → Task 3. ✓
- Spec §4 wiring data-company → Task 2 Step 2. ✓
- Spec §8 QA → Task 4. ✓
- Gaming colors non toccati: nessun task li modifica. ✓
- Fenice intatto: override solo sotto scope; font caricato come var non applicata. ✓
