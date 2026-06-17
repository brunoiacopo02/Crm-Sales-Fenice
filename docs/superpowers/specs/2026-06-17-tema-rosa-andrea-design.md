# Tema Rosa di Andrea (Conferme) — Design

**Data:** 2026-06-17
**Autore:** Claude (CRM Fenice)
**Stato:** In review

## Obiettivo

Dare all'account **Andrea delle Conferme** (`andrea@fenice.local`) un re-skin
estetico completo della dashboard in **toni di rosa soft moderno**, generato a
partire da un design system creato con **Stitch (MCP)**. Il tema deve essere
visibile **solo** quando Andrea è loggato; Fenice, SerenaMente e tutti gli altri
utenti restano invariati.

Non è un cambio funzionale: è un layer puramente estetico via override dei token
Tailwind, identico nel meccanismo al tema SerenaMente già in produzione — ma
**scoped all'utente** invece che all'azienda.

## Decisioni prese (brainstorming)

| Tema | Scelta |
|------|--------|
| Scope | **Tutta la dashboard** (sidebar, topbar, board, drawer, widget) |
| Mood | **Rosa moderno soft** (blush + accento magenta + testo prugna) |
| Font | **Colori + font moderno** → Plus Jakarta Sans (fallback Sora/Geist) |
| Identificazione utente | **Email-gate** su `andrea@fenice.local` |
| Strumento creativo | **Stitch MCP** per design system + mockup di validazione |

## Architettura

Riusa esattamente il pattern di theming già in produzione per SerenaMente
(`[data-company="serenamente"]` in `globals.css`), cambiando solo il **selettore**:
da attributo azienda → attributo tema utente.

### 1. Attivazione (gate utente)

In `src/app/(dashboard)/layout.tsx`, dove già si legge la sessione Supabase
(`supabaseUser.email`) e si calcola `dataCompany`, si aggiunge:

```tsx
const userTheme = session?.user?.email === 'andrea@fenice.local' ? 'rosa' : undefined
```

L'attributo viene applicato sullo **stesso `<div>` root** che già porta
`data-company`:

```tsx
<div data-company={dataCompany} data-theme={userTheme} className={...}>
```

- `userTheme` è `undefined` per chiunque non sia Andrea → l'attributo non viene
  emesso → nessun effetto su altri utenti.
- Andrea resta azienda `fenice` (`data-company="fenice"`). Poiché Fenice è il
  set di token di default (non li sovrascrive), il blocco `[data-theme="rosa"]`
  vince senza conflitti. Nessuna interazione con il blocco `serenamente`.

**Perché email e non userId:** è il pattern già usato nel progetto
(`isConfermeTl` gatea su email) ed è robusto al re-seed — `seedConfermeTeam.ts`
rigenera gli UUID utente con `crypto.randomUUID()`, ma l'email resta stabile.

L'email-gate viene centralizzato in un piccolo helper
(`src/lib/userTheme.ts` → `getUserTheme(email)`) così il confronto stringa non
resta sparso nel layout e l'eventuale aggiunta di altri utenti a tema è banale.

### 2. Override token (CSS)

In `src/app/globals.css`, subito **dopo** il blocco SerenaMente
(attualmente ~righe 2074-2102), si aggiunge un blocco analogo `[data-theme="rosa"]`
che sovrascrive i token `--color-brand-*`, `--color-brand-charcoal` e i font.
Tutte le utility `brand-*` (es. `bg-brand-orange`, `text-brand-charcoal`)
cascano automaticamente sui nuovi valori → **nessun componente Conferme viene
toccato**.

### 3. Font

Plus Jakarta Sans caricato via `next/font/google` in `src/app/layout.tsx`,
esattamente come Sora oggi:

```tsx
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], display: "swap" })
// ...nel <body>: className include `${jakarta.variable}`
```

e referenziato solo dentro il blocco rosa, così non cambia nulla per gli altri.

## Palette (valori di partenza — da rifinire con Stitch)

Scala rosa magenta soft, stessa struttura 50→900 di SerenaMente:

```css
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
  --color-brand-charcoal:      #5A1A3A;   /* testo prugna */

  --font-display: var(--font-jakarta), var(--font-geist-sans), sans-serif;
  --font-sans:    var(--font-jakarta), var(--font-geist-sans), sans-serif;
  font-family: var(--font-sans);
}

/* Gradienti rosa soft sull'area principale (molto tenui), come SerenaMente */
[data-theme="rosa"] main {
  background-image:
    radial-gradient(60rem 60rem at 100% 0%, rgba(236,90,146,0.07), transparent 70%),
    radial-gradient(50rem 50rem at 0% 100%, rgba(236,90,146,0.06), transparent 70%);
}
```

> I valori esatti (scala + accento + testo) saranno confermati/affinati dal
> design system Stitch prima di scrivere il CSS definitivo — vedi sotto.

## Ruolo di Stitch (MCP)

Stitch è lo strumento creativo che precede la scrittura dei token:

1. `mcp__stitch__create_design_system` — design system "Rosa Moderno Soft"
   (palette, tipografia, spacing) → fonte dei valori hex coerenti.
2. `mcp__stitch__generate_screen_from_text` — mockup di una board Conferme
   (kanban Pomeriggio/Mattina + drawer) nella palette rosa → validazione visiva
   del "bell'aspetto moderno".
3. Estrazione dei valori finali dal design system → traduzione nel blocco CSS
   `[data-theme="rosa"]`.

Output atteso: screenshot/mockup di riferimento + tabella hex finale.

## Cosa NON viene toccato

- Logica componenti Conferme (presence realtime, drawer lifecycle, board,
  timer, quest): nessuna modifica — solo token CSS.
- Colori della gamification (restano invariati, come per SerenaMente).
- Qualsiasi altro utente, azienda o pagina.
- Schema DB, server actions, middleware.

## Testing / verifica

- Build Next.js pulita (`next build`).
- Verifica visiva con Playwright/browse: login come `andrea@fenice.local`
  (`Conferme2026!`) → dashboard `/conferme` in rosa; screenshot di conferma.
- Login come altro Conferme (es. `alberto@fenice.local`) → dashboard standard
  Fenice, **nessuna** traccia di rosa (test di non-regressione del gate).
- Login Fenice e SerenaMente → invariati.

## Rischi / note

- **Auth vs DB:** memoria di progetto segnala che `seedConfermeTeam.ts` crea gli
  account solo in `public.users`, non in Supabase Auth. Per testare il login di
  Andrea potrebbe servire creare/confermare l'utente Auth. Da verificare in fase
  di QA; non blocca l'implementazione del tema.
- Tailwind v4: i token sono custom properties, l'override per selettore funziona
  già (provato con SerenaMente). Nessun rebuild config necessario.
