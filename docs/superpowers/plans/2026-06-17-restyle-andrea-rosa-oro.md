# Restyle "Rosa Antico & Oro" — Dashboard di Andrea — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Tasks 1-2 are mechanical (subagent-friendly). Tasks 3-5 are visual and MUST be driven with live Playwright iteration in the loop (the controller verifies each change on screen).**

**Goal:** Restyle completo, elemento per elemento, della dashboard Conferme del solo utente `andrea@fenice.local` in estetica rosa antico + oro su avorio, mantenendo struttura e logica del CRM.

**Architecture:** Tema scoped a `[data-theme="andrea"]` (rinominato dal precedente `"rosa"`), inline in fondo a `globals.css`, che rimappa TUTTE le scale-palette su rosa/oro/avorio; più tokenizzazione dei componenti gamification che hardcodano scuro/`text-white`/navy (così diventano avorio per Andrea, invariati per gli altri); più titoli serif Playfair Display. I colori di stato (esiti) restano semantici.

**Tech Stack:** Next.js 14 App Router, Tailwind v4 (token = CSS custom properties), next/font/google (Playfair Display + Plus Jakarta Sans già presente), Supabase Auth (email-gate), Playwright MCP (verifica visiva live).

## Global Constraints

- Attiva SOLO per `andrea@fenice.local` (gate `getUserTheme`). Ogni regola scoped a `[data-theme="andrea"]`; nessun effetto su altri utenti/aziende/pagine.
- Vince su `data-company="serenamente"` (source order: blocco andrea dopo serenamente in `globals.css`).
- Rosa antico **chiaro ed elegante**, oro misurato; sfondo avorio. NIENTE magenta acceso.
- Struttura/layout/IA e logica (presence, drawer, board, timer, quest, server actions, DB, middleware) INVARIATI.
- Colori di STATO mantenuti per significato: `emerald`=confermato/chiuso, `rose`/`red`=scartato/sparito/danger, `blue`=GDO/richiami/info; ammorbiditi ma NON rimappati alla scala rosa.
- Titoli/nomi/numeri-chiave in **Playfair Display** (`--font-display`); corpo in Plus Jakarta Sans (`--font-jakarta`).
- La tokenizzazione dei componenti condivisi deve essere **no-op visivo** per i non-Andrea (i token tengono i valori scuri originali).
- Nessuna query SQL raw, nessuna nuova dipendenza oltre il font Google.
- Palette valori esatti: vedi spec `docs/superpowers/specs/2026-06-17-restyle-andrea-rosa-oro-design.md`.

---

### Task 1: Fondazione — font Playfair, rinomina tema, remap completo palette (sostituisce il magenta)

**Files:**
- Modify: `src/lib/userTheme.ts` (return `'andrea'`)
- Modify: `src/app/layout.tsx` (carica Playfair Display → `--font-playfair`)
- Modify: `src/app/globals.css` (RIMUOVE il vecchio blocco `[data-theme="rosa"]` e relativi override fire/gaming/orange-amber-yellow/sidebar; AGGIUNGE il blocco `[data-theme="andrea"]` completo)

**Interfaces:**
- Consumes: niente.
- Produces: `getUserTheme(email) → 'andrea' | undefined`; attributo `data-theme="andrea"` (già emesso dal layout via `data-theme={userTheme}`); CSS var `--font-playfair`; selettore `[data-theme="andrea"]` con tutte le scale rimappate. Task 2-4 vi si agganciano.

- [ ] **Step 1: Aggiornare il gate `getUserTheme`**

In `src/lib/userTheme.ts`, sostituire il tipo e la mappa:

```ts
export type UserTheme = 'andrea'

const USER_THEME_BY_EMAIL: Record<string, UserTheme> = {
  'andrea@fenice.local': 'andrea',
}

export function getUserTheme(email: string | null | undefined): UserTheme | undefined {
  if (!email) return undefined
  return USER_THEME_BY_EMAIL[email.toLowerCase()]
}
```

(Il layout `src/app/(dashboard)/layout.tsx` usa già `data-theme={userTheme}` → emetterà `"andrea"`. Nessuna modifica al layout necessaria.)

- [ ] **Step 2: Caricare Playfair Display nel root layout**

In `src/app/layout.tsx`, aggiungere all'import font (riga 2):

```ts
import { Geist, Geist_Mono, Sora, Plus_Jakarta_Sans, Playfair_Display } from "next/font/google";
```

Aggiungere l'istanza dopo `jakarta`:

```ts
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});
```

Aggiungere `${playfair.variable}` alla className del `<body>`:

```tsx
className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} ${jakarta.variable} ${playfair.variable} antialiased`}
```

- [ ] **Step 3: Rimuovere il vecchio tema magenta da `globals.css`**

In `src/app/globals.css`, eliminare integralmente i blocchi del vecchio tema rosa: il commento "Tema Rosa", il blocco `[data-theme="rosa"] { ... }` (token brand + fire/gaming + orange/amber/yellow + gold/amber), il blocco `[data-theme="rosa"] main { ... }`, e tutte le regole `[data-theme="rosa"] .sidebar-item-active`, `.sidebar-item-hover`, `.sidebar-gamification-separator*`, `.text-gaming-fire`, `.text-gaming-gold`. (Sono i blocchi attualmente subito dopo il blocco `[data-company="serenamente"] main` — NON toccare i blocchi serenamente.)

- [ ] **Step 4: Aggiungere il blocco tema Andrea completo**

In `src/app/globals.css`, dopo il blocco `[data-company="serenamente"] main { ... }` (dove prima c'era il tema rosa), incollare:

```css
/* =========================================================================
   TEMA "ROSA ANTICO & ORO" — solo utente andrea@fenice.local
   (attributo data-theme="andrea" emesso dal layout dashboard).
   Rimappa TUTTE le scale-palette su rosa/oro/avorio. Scoped: nessun effetto
   per altri utenti. Vince su data-company=serenamente (source order).
   ========================================================================= */
[data-theme="andrea"] {
  /* Neutri → avorio/taupe caldo (ash) */
  --color-ash-50:  #FBF7F4;
  --color-ash-100: #F4ECE6;
  --color-ash-200: #E7DAD0;
  --color-ash-300: #D9C8BC;
  --color-ash-400: #B5A398;
  --color-ash-500: #8A766B;
  --color-ash-600: #6B5560;
  --color-ash-700: #4A3A40;
  --color-ash-800: #3A2230;
  --color-ash-900: #2A1822;

  /* Rosa antico (brand) */
  --color-brand-orange-50:  #FBF1F5;
  --color-brand-orange-100: #F6E2EA;
  --color-brand-orange-200: #EFCDDB;
  --color-brand-orange-300: #E3AEC4;
  --color-brand-orange-400: #D89BB4;
  --color-brand-orange-500: #CE8BA6;
  --color-brand-orange-600: #B8748F;
  --color-brand-orange-700: #9A5C75;
  --color-brand-orange-800: #7A475C;
  --color-brand-orange-900: #3A2230;
  --color-brand-orange:        #CE8BA6;
  --color-brand-orange-hover:  #B8748F;
  --color-brand-charcoal:      #3A2230;

  /* Fire (accento gamification) → rosa */
  --color-fire-400: #D89BB4;
  --color-fire-500: #CE8BA6;
  --color-fire-600: #B8748F;
  --color-fire-glow: rgba(206, 139, 166, 0.40);

  /* Ember (alert/NR) → terracotta-rosa */
  --color-ember-50:  #FBEEE9;
  --color-ember-100: #F6DCD1;
  --color-ember-200: #EFC4B2;
  --color-ember-300: #E0A98F;
  --color-ember-400: #CE8A6A;
  --color-ember-500: #B86B4A;
  --color-ember-600: #9A5638;
  --color-ember-700: #7E4329;
  --color-ember-800: #5F3220;
  --color-ember-900: #432316;

  /* Oro raffinato (gold) */
  --color-gold-50:  #FBF6EA;
  --color-gold-100: #F5ECCF;
  --color-gold-200: #EDDDA6;
  --color-gold-300: #E3CC8F;
  --color-gold-400: #D4B468;
  --color-gold-500: #C9A24B;
  --color-gold-600: #A8842F;
  --color-gold-700: #846724;
  --color-gold-800: #5F4A1A;
  --color-gold-900: #3F3111;

  /* Gaming: superfici scure → avorio chiaro; testo → prugna; bordi → oro hairline */
  --color-gaming-bg-deep:      #F4ECE6;
  --color-gaming-bg:           #FBF7F4;
  --color-gaming-bg-card:      #FFFFFF;
  --color-gaming-bg-card-hover:#F9F1EC;
  --color-gaming-bg-surface:   #F6ECEF;
  --color-gaming-border:       rgba(201, 162, 75, 0.22);
  --color-gaming-border-hover: rgba(201, 162, 75, 0.40);
  --color-gaming-text:         #3A2230;
  --color-gaming-text-muted:   #8A766B;
  --color-gaming-gold:         #C9A24B;
  --color-gaming-gold-dim:     #A8842F;
  --color-gaming-amber:        #D4B468;

  /* Utility Tailwind orange/amber/yellow → rosa-oro (accenti non semantici) */
  --color-orange-50:#FBF1F5; --color-orange-100:#F6E2EA; --color-orange-200:#EFCDDB; --color-orange-300:#E3AEC4; --color-orange-400:#D89BB4; --color-orange-500:#CE8BA6; --color-orange-600:#B8748F; --color-orange-700:#9A5C75; --color-orange-800:#7A475C; --color-orange-900:#3A2230;
  --color-amber-50:#FBF6EA; --color-amber-100:#F5ECCF; --color-amber-200:#EDDDA6; --color-amber-300:#E3CC8F; --color-amber-400:#D4B468; --color-amber-500:#C9A24B; --color-amber-600:#A8842F; --color-amber-700:#846724; --color-amber-800:#5F4A1A; --color-amber-900:#3F3111;
  --color-yellow-50:#FBF6EA; --color-yellow-100:#F5ECCF; --color-yellow-200:#EDDDA6; --color-yellow-300:#E3CC8F; --color-yellow-400:#D4B468; --color-yellow-500:#C9A24B; --color-yellow-600:#A8842F; --color-yellow-700:#846724; --color-yellow-800:#5F4A1A; --color-yellow-900:#3F3111;

  /* Ombre/glow → rosa/oro soffuse */
  --color-fire-glow: rgba(206,139,166,0.4);
  --shadow-glow-orange: 0 0 16px -2px rgba(206,139,166,0.4);
  --shadow-glow-ember:  0 0 16px -2px rgba(184,107,74,0.3);
  --shadow-glow-gold:   0 0 16px -2px rgba(201,162,75,0.3);
  --shadow-gaming-glow-fire:  0 0 20px -4px rgba(206,139,166,0.3), 0 0 8px -2px rgba(206,139,166,0.18);
  --shadow-gaming-glow-gold:  0 0 20px -4px rgba(201,162,75,0.3), 0 0 8px -2px rgba(201,162,75,0.16);
  --shadow-gaming-glow-amber: 0 0 20px -4px rgba(212,180,104,0.3), 0 0 8px -2px rgba(212,180,104,0.16);

  /* Tipografia: titoli serif, corpo sans */
  --font-display: var(--font-playfair), Georgia, serif;
  --font-sans:    var(--font-jakarta), var(--font-geist-sans), sans-serif;
  font-family: var(--font-sans);
}

/* Sfondo avorio caldo dell'area principale, micro-sfumature rosa/oro */
[data-theme="andrea"] main {
  background-color: #FBF7F4;
  background-image:
    radial-gradient(60rem 60rem at 100% 0%, rgba(201,162,75,0.05), transparent 70%),
    radial-gradient(50rem 50rem at 0% 100%, rgba(206,139,166,0.06), transparent 70%);
}
```

- [ ] **Step 5: Build**

Run: `npx next build`
Expected: build OK, nessun errore CSS/TS.

- [ ] **Step 6: Verifica live (controller, Playwright)**

Avviare dev server, login Andrea (`andrea@fenice.local` / `1234`), `/conferme`. `browser_evaluate`:
```js
const r=document.querySelector('[data-company]'); const cs=getComputedStyle(r);
({theme:r.getAttribute('data-theme'), ash50:cs.getPropertyValue('--color-ash-50').trim(), brand:cs.getPropertyValue('--color-brand-orange').trim(), gamingBg:cs.getPropertyValue('--color-gaming-bg-card').trim(), gold:cs.getPropertyValue('--color-gaming-gold').trim()})
```
Expected: `theme="andrea"`, `ash50=#fbf7f4`, `brand=#ce8ba6`, `gamingBg=#ffffff`, `gold=#c9a24b`. Nessun `#ec5a92`/`#FFBE82` residuo. Screenshot.

- [ ] **Step 7: Commit**

```bash
git add src/lib/userTheme.ts src/app/layout.tsx src/app/globals.css
git commit -m "feat(restyle-andrea): fondazione tema Rosa Antico & Oro (font Playfair, remap palette, rename data-theme=andrea)"
```

---

### Task 2: Tokenizzazione componenti gamification (scuro → capace di diventare avorio)

Sostituisce i literal scuri/`text-white`/navy con i token gaming, così le card seguono il tema: avorio per Andrea, invariate (scure) per gli altri.

**Files:**
- Modify: `src/components/ConfermeDailyObjectives.tsx`
- Modify: `src/components/StreakCounter.tsx`
- Modify: `src/components/QuestPanel.tsx`
- Modify: `src/components/LevelNudge.tsx`
- Modify: `src/components/StreakAnxietyBanner.tsx`
- Modify: `src/components/HotStreak.tsx`

**Interfaces:**
- Consumes: token gaming rimappati (Task 1).
- Produces: componenti gaming token-driven (nessun nuovo export).

- [ ] **Step 1: ConfermeDailyObjectives — card navy → token**

In `src/components/ConfermeDailyObjectives.tsx` (riga ~45), sostituire `bg-gradient-to-r from-blue-900 to-indigo-900` con:
```
bg-gradient-to-br from-[var(--color-gaming-bg)] to-[var(--color-gaming-bg-surface)] border border-[var(--color-gaming-border)]
```
Sostituire i testi bianchi/azzurri del titolo e sottotesto con token: testo principale → `text-[var(--color-gaming-text)]`, sottotesto `text-blue-300` → `text-[var(--color-gaming-text-muted)]`. La barra `bg-white/10` → `bg-[color-mix(in_oklab,var(--color-gaming-text)_10%,transparent)]` (o lasciare `bg-white/10` se su card scura per non-Andrea resta ok; preferire token per coerenza). Le classi semaforo `bg-green-500`/`bg-amber-500`/`bg-red-400` della barra: `bg-amber-500` (stato 50%) → token oro/rosa già coperto dal remap utility; `green/red` restano (semantici).

- [ ] **Step 2: StreakCounter — text-white → token**

In `src/components/StreakCounter.tsx`: sostituire `text-white` (riga ~135 contenitore e count) con `text-[var(--color-gaming-text)]`. I gradienti di stato `via-emerald-900/20`/`via-red-900/20` restano (semafori safe/at-risk). Il gradiente default `from-[var(--color-gaming-bg)] via-[var(--color-gaming-bg-card)] to-[var(--color-gaming-bg-surface)]` è già token → diventa avorio automaticamente.

- [ ] **Step 3: QuestPanel — text-white → token**

In `src/components/QuestPanel.tsx`: `text-white` (contenitore riga ~186, titolo) → `text-[var(--color-gaming-text)]`. I blur decorativi `bg-fire-500/6`/`bg-brand-orange/6` restano (ora rosa via token). Container già usa `--color-gaming-bg*` → avorio.

- [ ] **Step 4: LevelNudge — già token**

In `src/components/LevelNudge.tsx`: usa già `var(--color-gaming-*)` e `var(--color-gaming-gold)`. Verificare che non ci sia `text-white` hardcoded; se presente → `text-[var(--color-gaming-text)]`. Altrimenti nessuna modifica (segue i token).

- [ ] **Step 5: StreakAnxietyBanner — testi su token**

In `src/components/StreakAnxietyBanner.tsx`: gradienti emerald/red di stato restano (semafori). Eventuali `text-white` → `text-[var(--color-gaming-text)]`. Countdown `font-mono` invariato.

- [ ] **Step 6: HotStreak — ombre inline su token**

In `src/components/HotStreak.tsx`: i gradienti fuoco `from-amber-500 via-orange-500`/`via-red-500` e le ombre inline `rgba(245,158,11,...)`/`rgba(239,68,68,...)` sono effetti "fiamma". Per Andrea diventano automaticamente rosa/oro grazie al remap di `amber/orange/red`? `red` resta semantico → mantenere l'intensità rossa solo per lo stato "intense". Per lo stato base, sostituire le ombre inline hardcoded con `var(--shadow-gaming-glow-fire)` (già rosa nel tema). Mantenere la struttura.

- [ ] **Step 7: Build**

Run: `npx next build` — Expected: OK.

- [ ] **Step 8: Verifica live + NON-REGRESSIONE (controller, Playwright)**

- Andrea `/conferme`: le card Obiettivo/Streak/Quest/Livello ora sono **avorio chiare**, testo prugna leggibile, accenti rosa/oro. Screenshot.
- Login un utente **GDO** gamification (o rimuovere via DOM `data-theme`): le stesse card devono restare **scure "gaming" identiche** all'originale. Confermare contrasto testo OK in entrambi.

- [ ] **Step 9: Commit**

```bash
git add src/components/ConfermeDailyObjectives.tsx src/components/StreakCounter.tsx src/components/QuestPanel.tsx src/components/LevelNudge.tsx src/components/StreakAnxietyBanner.tsx src/components/HotStreak.tsx
git commit -m "feat(restyle-andrea): tokenizza componenti gamification (card avorio per Andrea, invariate per gli altri)"
```

---

### Task 3: Titoli serif Playfair Display (scoped Andrea) — VISUAL, controller-driven

**Files:**
- Modify: `src/app/globals.css` (regole `[data-theme="andrea"]` per i titoli)
- Eventuale hook minimale (classe) nei componenti dove il titolo non è un heading: `src/app/(dashboard)/conferme/page.tsx`, `src/components/ConfermeBoardRow.tsx`, `src/components/ConfermeDrawer.tsx`, `src/components/StreakCounter.tsx`

**Interfaces:**
- Consumes: `--font-display` (Playfair, Task 1).
- Produces: titoli/nomi/numeri in serif sotto `[data-theme="andrea"]`.

- [ ] **Step 1: Regole serif scoped**

In `src/app/globals.css`, dopo il blocco `[data-theme="andrea"] main`, aggiungere (poi rifinire dal vivo):
```css
[data-theme="andrea"] h1,
[data-theme="andrea"] h2,
[data-theme="andrea"] .ttl-serif {
  font-family: var(--font-display);
  letter-spacing: -0.01em;
}
```

- [ ] **Step 2: Applicare l'hook ai titoli chiave**

Aggiungere la classe `ttl-serif` (innocua per gli altri utenti) a: titolo pagina "Dashboard Conferme" (`conferme/page.tsx` riga ~36), nome lead in `ConfermeBoardRow.tsx` (riga ~243), nome lead nel `ConfermeDrawer.tsx` header (riga ~440), numero streak in `StreakCounter.tsx` (count `text-2xl font-black`). La classe applica serif solo quando il tema è attivo (la regola CSS è scoped a `[data-theme="andrea"]`).

- [ ] **Step 3: Build + verifica live**

Run `npx next build`. Poi Playwright (Andrea): confermare che i titoli/nomi/numeri sono in Playfair serif e il corpo resta sans. Verificare che per i non-Andrea la classe `ttl-serif` NON cambi nulla (la regola è scoped). Iterare su dimensioni/peso/spaziatura finché elegante. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css "src/app/(dashboard)/conferme/page.tsx" src/components/ConfermeBoardRow.tsx src/components/ConfermeDrawer.tsx src/components/StreakCounter.tsx
git commit -m "feat(restyle-andrea): titoli serif Playfair Display scoped al tema"
```

---

### Task 4: Dettagli luxury (bordi oro, ombre soffuse, pulsanti, tab, card lead) — VISUAL, controller-driven

Rifinitura estetica di ogni superficie tramite regole scoped `[data-theme="andrea"]`, iterate dal vivo.

**Files:**
- Modify: `src/app/globals.css` (regole di dettaglio scoped)

**Interfaces:**
- Consumes: token e font (Task 1), card avorio (Task 2).
- Produces: l'estetica luxury finale.

- [ ] **Step 1: Regole di dettaglio (punto di partenza, poi iterare dal vivo)**

In `src/app/globals.css` aggiungere regole scoped per:
- Card generiche (lead card, widget): bordo hairline oro + ombra rosa soffusa + raggio morbido.
  ```css
  [data-theme="andrea"] .shadow-soft,
  [data-theme="andrea"] .shadow-card { box-shadow: 0 6px 20px -8px rgba(206,139,166,0.25), 0 1px 0 0 rgba(201,162,75,0.10); }
  ```
- Sidebar: sfondo avorio invece del gradiente scuro gaming. Override di `.bg-gradient-gaming-sidebar` sotto il tema:
  ```css
  [data-theme="andrea"] .bg-gradient-gaming-sidebar { background: linear-gradient(180deg, #FFFDFB 0%, #FBF4F0 100%); }
  ```
  (il testo sidebar usa `text-white`/`text-ash-400`; con ash rimappato e sfondo chiaro va verificato il contrasto e, se serve, aggiunta regola colore testo sidebar scoped).
- Voce sidebar attiva: accento oro a sinistra (`.sidebar-item-active` border-left oro + fondo rosa tenue) — ridichiarare scoped in oro/rosa.
- Board: tab attiva con sottolineatura oro; chip orari raffinati; pulsante "Chiama" rosa antico pieno; "Riprogramma/Esito/NR/snooze" outline oro.
- Card "In Lavorazione" (locked): cornice oro + micro-glow invece di amber.

> Queste regole sono il PUNTO DI PARTENZA: il controller le rifinisce iterando con Playwright finché ogni superficie è elegante e coerente col mockup Stitch.

- [ ] **Step 2: Build + verifica live iterativa**

`npx next build`, poi ciclo Playwright su Andrea: sidebar, topbar, widget, board (tab/chip/card lead/azioni/In Lavorazione), drawer (tab/input/esiti), storico. Rifinire le regole fino al risultato. Verificare leggibilità e contrasti. Screenshot di ogni superficie.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(restyle-andrea): dettagli luxury (bordi oro, ombre rosa, pulsanti, tab, sidebar avorio)"
```

---

### Task 5: QA visiva finale end-to-end + non-regressione

**Files:** nessuno (verifica) — eventuali fix tornano nei file dei task precedenti.

**Interfaces:** consuma l'app buildata coi Task 1-4.

- [ ] **Step 1: Build + dev server.**

- [ ] **Step 2: Andrea — ogni superficie.** Login `andrea@fenice.local`/`1234`. Percorrere `/conferme`: sidebar, topbar, i 6 widget, board nei tab Pomeriggio/Mattina/Richiami/Storico, aprire una card → drawer (tutti i tab dati/note/script/esiti). Screenshot di ciascuno. Confermare estetica rosa antico+oro elegante, titoli serif, card avorio, semafori di stato leggibili.

- [ ] **Step 3: Serenamente.** Con Andrea su `data-company="serenamente"` → tema Andrea attivo (vince sul verde). Verificare `data-theme="andrea"` + token rosa via `browser_evaluate`.

- [ ] **Step 4: Non-regressione altri utenti.** Login un utente gamification non-Andrea (GDO) → dashboard scura "gaming" originale, nessuna traccia rosa/oro/serif. In alternativa, via DOM rimuovere `data-theme` e confermare ripristino totale.

- [ ] **Step 5: Documentare.** Salvare gli screenshot before/after in `docs/superpowers/assets/tema-rosa-andrea/`. Annotare esito. Risolvere eventuali bug prima del merge (nei file dei task relativi).

---

## Self-Review

**1. Spec coverage:**
- Rename tema + font Playfair + remap completo palette → Task 1. ✓
- Card gamification scure → avorio (tokenizzazione) → Task 2. ✓
- Titoli serif → Task 3. ✓
- Dettagli luxury per superficie (sidebar, topbar, board, card lead, drawer, storico) → Task 4. ✓
- Colori di stato mantenuti → vincolo globale + Task 2 (gradienti emerald/red preservati). ✓
- Solo Andrea / vince su serenamente / non-regressione → vincoli globali + Task 5. ✓
- Verifica live Playwright + before/after → Task 5 (e step di verifica in 1-4). ✓

**2. Placeholder scan:** Task 1-2 hanno codice/edit concreti. Task 3-4 sono dichiaratamente visual con CSS di partenza concreto + iterazione live (non placeholder: il codice c'è, la rifinitura è il lavoro). Nessun "TBD".

**3. Type consistency:** `getUserTheme → 'andrea' | undefined` (Task 1) usato dal layout esistente. `--font-playfair` definito (Task 1 layout) e referenziato in `--font-display` (Task 1 CSS) e Task 3. Selettore `[data-theme="andrea"]` coerente tra Task 1/3/4 e atteso da Task 5. Classe hook `ttl-serif` definita (Task 3 Step 1) e applicata (Task 3 Step 2).

**Nota esecuzione:** Task 1-2 = subagent (mechanical, codice completo). Task 3-4-5 = controller con Playwright in-the-loop (estetica = serve vedere il render). Build = unico gate automatico (no test runner: vitest assente).
