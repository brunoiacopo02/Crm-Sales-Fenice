# Tema Rosa di Andrea (Conferme) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'utente `andrea@fenice.local` un re-skin estetico completo della dashboard in toni di rosa soft moderno, visibile solo quando lui è loggato.

**Architecture:** Riuso del pattern di theming SerenaMente (`[data-company]` + override token Tailwind v4 in `globals.css`), ma con un selettore **per-utente** `[data-theme="rosa"]` applicato dal layout dashboard tramite un email-gate. La palette nasce da un design system creato con Stitch (MCP) e tradotto in custom properties CSS. Nessun componente Conferme viene modificato: solo token + un attributo + un font.

**Tech Stack:** Next.js 14 (App Router, server component layout), Tailwind CSS v4 (token via CSS custom properties), `next/font/google` (Plus Jakarta Sans), Supabase Auth (identificazione utente via email), Stitch MCP (design exploration), Playwright MCP (verifica visiva).

## Global Constraints

- Il tema si attiva **esclusivamente** per `andrea@fenice.local`. Qualsiasi altro utente, azienda (Fenice, SerenaMente) o pagina resta **byte-per-byte invariato**.
- Andrea resta azienda `fenice` (`data-company="fenice"`): il blocco rosa NON deve dipendere da, né interferire con, il blocco `[data-company="serenamente"]`.
- Mood: rosa moderno soft — accento magenta `#EC5A92`, hover `#D63D78`, testo prugna `#5A1A3A`, blush `#FBE9F1`. (Valori di partenza, affinabili dal design system Stitch.)
- Font del tema: **Plus Jakarta Sans**, caricato via `next/font/google` come Sora, con fallback `var(--font-geist-sans)`.
- Solo layer estetico: vietato toccare logica componenti Conferme (presence, realtime, drawer lifecycle, timer, board), schema DB, server actions, middleware.
- I colori della gamification restano invariati (come per SerenaMente).
- Nessuna query SQL raw; nessuna nuova dipendenza npm (Plus Jakarta Sans arriva da `next/font/google`, già disponibile).

---

### Task 1: Design system rosa con Stitch (MCP) — palette di riferimento

Esplorazione creativa per fissare i valori finali della palette prima di scrivere il CSS. Questo task NON produce codice dell'app: produce i valori hex e un mockup di validazione che alimentano Task 3.

**Files:**
- Modify: `docs/superpowers/specs/2026-06-17-tema-rosa-andrea-design.md` (sezione "Palette" → sostituire i valori "di partenza" con quelli finali confermati da Stitch)

**Interfaces:**
- Consumes: niente.
- Produces: una scala rosa finale 50→900 + accento/hover/charcoal/blush in formato hex, scritta nella sezione Palette della spec. Task 3 copia questi valori nel CSS.

- [ ] **Step 1: Creare il design system rosa in Stitch**

Chiamare `mcp__stitch__create_design_system` con (in oggetto `designSystem.theme`):
- `displayName`: `"Andrea Rosa Moderno Soft"`
- `colorMode`: `LIGHT`
- `colorVariant`: `EXPRESSIVE`
- `headlineFont`: `PLUS_JAKARTA_SANS`
- `bodyFont`: `PLUS_JAKARTA_SANS`
- `roundness`: `ROUND_TWELVE`
- `customColor`: `"#EC5A92"`
- `overridePrimaryColor`: `"#EC5A92"`
- `designMd`: breve markdown che descrive il mood "rosa soft, blush background `#FBE9F1`, testo prugna `#5A1A3A`, accenti magenta, pulito/premium/wellness".

Salvare l'asset id restituito.

- [ ] **Step 2: Applicare il design system**

Chiamare `mcp__stitch__update_design_system` con l'asset id (come indicato dalla doc del tool create), così il design system è utilizzabile per generare screen.

- [ ] **Step 3: Generare un mockup di validazione**

Chiamare `mcp__stitch__generate_screen_from_text` con:
- `projectId`: un progetto Stitch (creare con `mcp__stitch__create_project` titolo `"Andrea Rosa - Conferme"` se serve, altrimenti riusare un progetto esistente)
- `designSystem`: l'asset id del design system rosa
- `deviceType`: `DESKTOP`
- `prompt`: descrivere una dashboard CRM "Conferme" — kanban a due colonne (Pomeriggio/Mattina) con card lead, sidebar a sinistra, topbar, widget streak/obiettivi, palette rosa soft moderna.

Nota dalla doc del tool: può richiedere minuti; in caso di timeout NON ritentare — usare `mcp__stitch__get_screen` ogni ~30s.

- [ ] **Step 4: Estrarre i valori e aggiornare la spec**

Dal design system (e dal mockup) ricavare la scala rosa coerente. Aggiornare la sezione "Palette" della spec con i valori finali (scala 50→900, `--color-brand-orange`, `-hover`, `--color-brand-charcoal`, e il colore del gradiente blush). Se Stitch produce valori sostanzialmente coerenti con quelli di partenza, confermarli; altrimenti sostituirli.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-17-tema-rosa-andrea-design.md
git commit -m "design(tema-rosa): palette finale da design system Stitch"
```

---

### Task 2: Helper `getUserTheme` + caricamento font Plus Jakarta Sans

Helper puro per centralizzare l'email-gate (testabile in isolamento) e registrazione del font a livello root.

**Files:**
- Create: `src/lib/userTheme.ts`
- Create: `src/lib/userTheme.test.ts`
- Modify: `src/app/layout.tsx:2` (import font) e `:15-20` (istanza font) e `:48` (className body)

**Interfaces:**
- Consumes: niente.
- Produces: `getUserTheme(email: string | null | undefined): 'rosa' | undefined` — ritorna `'rosa'` solo se `email === 'andrea@fenice.local'`, altrimenti `undefined`. Consumato da Task 4 (dashboard layout).

- [ ] **Step 1: Scrivere il test che fallisce**

Create `src/lib/userTheme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getUserTheme } from './userTheme'

describe('getUserTheme', () => {
  it("ritorna 'rosa' per l'email di Andrea", () => {
    expect(getUserTheme('andrea@fenice.local')).toBe('rosa')
  })
  it('ritorna undefined per un altro Conferme', () => {
    expect(getUserTheme('alberto@fenice.local')).toBeUndefined()
  })
  it('ritorna undefined per email vuota/nulla', () => {
    expect(getUserTheme(null)).toBeUndefined()
    expect(getUserTheme(undefined)).toBeUndefined()
    expect(getUserTheme('')).toBeUndefined()
  })
  it('è case-insensitive sul match email', () => {
    expect(getUserTheme('Andrea@Fenice.Local')).toBe('rosa')
  })
})
```

- [ ] **Step 2: Verificare che il test fallisca**

Run: `npx vitest run src/lib/userTheme.test.ts`
Expected: FAIL — modulo `./userTheme` non trovato.

> Se il progetto non ha vitest configurato, verificarlo con `npx vitest --version`. Se assente, saltare i Step di test unitari di questo task (1, 2, 4) e procedere col Step 3 + verifica via build nel Task 5; annotarlo nel commit. Non aggiungere vitest solo per questo.

- [ ] **Step 3: Implementare l'helper**

Create `src/lib/userTheme.ts`:

```ts
/**
 * Tema estetico per-utente (override token brand via [data-theme] in globals.css).
 * Scoped per email perché robusto al re-seed (gli UUID utente sono rigenerati,
 * l'email no) e coerente col pattern email-gate già usato (isConfermeTl).
 */
export type UserTheme = 'rosa'

const USER_THEME_BY_EMAIL: Record<string, UserTheme> = {
  'andrea@fenice.local': 'rosa',
}

export function getUserTheme(email: string | null | undefined): UserTheme | undefined {
  if (!email) return undefined
  return USER_THEME_BY_EMAIL[email.toLowerCase()]
}
```

- [ ] **Step 4: Verificare che il test passi**

Run: `npx vitest run src/lib/userTheme.test.ts`
Expected: PASS (4 test verdi).

- [ ] **Step 5: Caricare il font Plus Jakarta Sans nel root layout**

In `src/app/layout.tsx`, modificare l'import (riga 2):

```ts
import { Geist, Geist_Mono, Sora, Plus_Jakarta_Sans } from "next/font/google";
```

Aggiungere l'istanza font dopo il blocco `sora` (dopo riga 20):

```ts
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
```

Aggiungere la variabile alla `className` del `<body>` (riga 48):

```tsx
className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} ${jakarta.variable} antialiased`}
```

- [ ] **Step 6: Verificare la build**

Run: `npx next build`
Expected: build completata senza errori; nessun warning su font.

- [ ] **Step 7: Commit**

```bash
git add src/lib/userTheme.ts src/lib/userTheme.test.ts src/app/layout.tsx
git commit -m "feat(tema-rosa): helper getUserTheme + font Plus Jakarta Sans"
```

---

### Task 3: Blocco CSS `[data-theme="rosa"]` in globals.css

Override dei token brand sui toni rosa, struttura identica al blocco SerenaMente.

**Files:**
- Modify: `src/app/globals.css` (aggiungere dopo la riga 2102, subito sotto il blocco SerenaMente)

**Interfaces:**
- Consumes: i valori palette finali della spec (Task 1) e la variabile font `--font-jakarta` (Task 2).
- Produces: il selettore CSS `[data-theme="rosa"]` su cui si aggancia l'attributo emesso da Task 4.

- [ ] **Step 1: Aggiungere il blocco tema rosa**

In `src/app/globals.css`, dopo la riga 2102 (fine del blocco `[data-company="serenamente"] main`), aggiungere:

```css
/* === Tema Rosa — attivo solo per l'utente andrea@fenice.local (attributo
   data-theme="rosa" emesso dal layout dashboard). Sovrascrive i token brand
   (rosa magenta soft + testo prugna) e il font (Plus Jakarta Sans). Tutte le
   utility brand-* cascano automaticamente. Indipendente da data-company. === */
[data-theme="rosa"] {
  --color-brand-orange-50:  #FDF2F7;
  --color-brand-orange-100: #FCE7F0;
  --color-brand-orange-200: #F9CFE0;
  --color-brand-orange-300: #F4A8C7;
  --color-brand-orange-400: #EF7DA9;
  --color-brand-orange-500: #EC5A92;
  --color-brand-orange-600: #D63D78;
  --color-brand-orange-700: #B82C61;
  --color-brand-orange-800: #97244F;
  --color-brand-orange-900: #5A1A3A;
  --color-brand-orange:        #EC5A92;
  --color-brand-orange-hover:  #D63D78;
  --color-brand-charcoal:      #5A1A3A;

  --font-display: var(--font-jakarta), var(--font-geist-sans), sans-serif;
  --font-sans:    var(--font-jakarta), var(--font-geist-sans), sans-serif;
  font-family: var(--font-sans);
}

/* Sfumature rosa soft sull'area principale (molto tenui), come SerenaMente */
[data-theme="rosa"] main {
  background-image:
    radial-gradient(60rem 60rem at 100% 0%, rgba(236,90,146,0.07), transparent 70%),
    radial-gradient(50rem 50rem at 0% 100%, rgba(236,90,146,0.06), transparent 70%);
}
```

> Se Task 1 ha prodotto valori palette diversi, usare quelli aggiornati nella spec al posto di questi.

- [ ] **Step 2: Verificare la build**

Run: `npx next build`
Expected: build OK, nessun errore CSS.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(tema-rosa): blocco token [data-theme=rosa] in globals.css"
```

---

### Task 4: Applicare l'attributo `data-theme` nel layout dashboard (email-gate)

Collega l'helper al DOM: il `<div>` root della dashboard riceve `data-theme="rosa"` solo per Andrea.

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx` (import al blocco righe 16-21; calcolo dopo riga 57; attributo su riga 67)

**Interfaces:**
- Consumes: `getUserTheme` (Task 2), `session.user.email` (già disponibile, riga 31).
- Produces: attributo `data-theme` sul container root che attiva il CSS di Task 3.

- [ ] **Step 1: Importare l'helper**

In `src/app/(dashboard)/layout.tsx`, aggiungere nel blocco import (dopo riga 21):

```ts
import { getUserTheme } from "@/lib/userTheme"
```

- [ ] **Step 2: Calcolare il tema utente**

Dopo la riga 57 (`const dataCompany = ...`), aggiungere:

```ts
// Tema estetico per-utente (es. rosa per Andrea): scoped via attributo data-theme.
const userTheme = getUserTheme(session.user.email)
```

- [ ] **Step 3: Emettere l'attributo sul container root**

Sostituire la riga 67:

```tsx
<div data-company={dataCompany} className={`flex h-screen overflow-hidden font-sans ${isTheme ? skinCss : 'bg-gray-50'}`}>
```

con:

```tsx
<div data-company={dataCompany} data-theme={userTheme} className={`flex h-screen overflow-hidden font-sans ${isTheme ? skinCss : 'bg-gray-50'}`}>
```

(Quando `userTheme` è `undefined`, React non emette l'attributo → nessun effetto per gli altri utenti.)

- [ ] **Step 4: Verificare la build**

Run: `npx next build`
Expected: build OK, nessun errore TypeScript.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/layout.tsx"
git commit -m "feat(tema-rosa): email-gate data-theme=rosa per Andrea nel layout"
```

---

### Task 5: Verifica visiva end-to-end (Playwright MCP)

Conferma che Andrea veda il rosa e che gli altri NON lo vedano (test di non-regressione del gate).

**Files:** nessuno (verifica runtime).

**Interfaces:**
- Consumes: l'app buildata con Task 2-4.
- Produces: screenshot di conferma + eventuali bug da risolvere prima del merge.

- [ ] **Step 1: Avviare l'app**

Run: `npx next build && npx next start` (oppure `npx next dev`) in background. Annotare l'URL locale (es. `http://localhost:3000`).

> Nota rischio (dalla spec): `seedConfermeTeam.ts` crea Andrea solo in `public.users`, non in Supabase Auth. Se il login di `andrea@fenice.local` fallisce, creare/confermare l'utente in Supabase Auth (via dashboard o admin API) prima di proseguire. NON è un blocco all'implementazione del tema, solo alla verifica del login.

- [ ] **Step 2: Login come Andrea e verifica rosa**

Con Playwright MCP: `browser_navigate` su `/login`, autenticarsi come `andrea@fenice.local` / `Conferme2026!`, navigare su `/conferme`, poi `browser_take_screenshot`.
Expected: sidebar/topbar/board/pulsanti in tonalità rosa, font Plus Jakarta Sans, gradiente blush sul `<main>`.

- [ ] **Step 3: Verifica DOM dell'attributo**

Con `browser_evaluate`: `document.querySelector('[data-company]')?.getAttribute('data-theme')`.
Expected: `"rosa"`.

- [ ] **Step 4: Non-regressione — login come altro Conferme**

Logout, login come `alberto@fenice.local` / `Conferme2026!`, navigare su `/conferme`, screenshot.
Expected: dashboard standard Fenice (arancione brand), **nessuna** traccia di rosa. `browser_evaluate` su `data-theme` → `null`.

- [ ] **Step 5: Non-regressione — SerenaMente invariato (se accessibile)**

Se disponibile un account multi-azienda con SerenaMente, verificare che il tema verde salvia sia invariato. Altrimenti annotare come verifica manuale post-deploy.

- [ ] **Step 6: Documentare l'esito**

Salvare gli screenshot e annotare l'esito (e l'eventuale azione su Supabase Auth) nel commit/PR. Se emergono bug, risolverli prima del merge.

---

## Self-Review

**1. Spec coverage:**
- Attivazione email-gate → Task 2 (helper) + Task 4 (attributo). ✓
- Override token CSS rosa → Task 3. ✓
- Font moderno Plus Jakarta Sans → Task 2 (Step 5). ✓
- Ruolo Stitch (design system + mockup) → Task 1. ✓
- "Cosa NON viene toccato" (componenti/gamification/altri utenti) → garantito dall'approccio token-only + gate; verificato in Task 5 Step 4-5. ✓
- Testing/verifica (build + Playwright + non-regressione) → Task 2/3/4 Step build + Task 5. ✓
- Rischio Auth vs DB → annotato in Task 5 Step 1. ✓

**2. Placeholder scan:** Nessun TBD/TODO. I valori palette "di partenza" hanno un percorso esplicito di finalizzazione (Task 1) e un fallback concreto già scritto in Task 3 — non sono placeholder. Il ramo "vitest assente" ha istruzioni esplicite, non vaghe.

**3. Type consistency:** `getUserTheme(email)` ritorna `'rosa' | undefined` in Task 2, consumato identicamente in Task 4. La variabile font `--font-jakarta` è definita in Task 2 (Step 5) e referenziata in Task 3. L'attributo `data-theme="rosa"` è prodotto in Task 4 e atteso dal selettore in Task 3 e dalla verifica in Task 5.
