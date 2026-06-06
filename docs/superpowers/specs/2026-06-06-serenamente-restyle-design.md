# Serenamente Restyle — Design Spec

**Data:** 2026-06-06
**Stato:** Approvato (Bruno: "vai")

## 1. Obiettivo
Restyling grafico dell'intero CRM **lato Serenamente** (tutte le viste: GDO, manager, conferme, venditori, store, classifiche) secondo la brand guide SerenaMente. **Fenice resta identico al 100%**: il tema cambia solo quando l'azienda attiva (vedi [[project_sales_company_selection]]) è `serenamente`.

## 2. Brand SerenaMente (dalla guida di stile Canva)
- **Colori:** main **#191970** (navy/midnight blue, testo e titoli), **#78B48C** (verde salvia, accento), **#ffffff** (bianco, sfondo).
- **Font:** **Sora** (titoli bold, corpo regular, colore #191970).
- **Logo:** cervello verde salvia su coppa navy + wordmark "SerenaMente" navy (Sora) + payoff "crescita mentale".
- **Sfondo:** bianco con sfumature verdi soft (#78B48C blur) negli angoli.

## 3. Decisioni di mappatura (confermate con Bruno)
- **Verde salvia = accento primario** (stesso ruolo dell'arancio Fenice): bottoni, accenti, stati attivi.
- **Navy = colore testo/titoli** (stesso ruolo del charcoal Fenice).
- **Logo:** lo ricreo io come SVG (~85-90% fedele).
- **Scope:** tutto il CRM Serenamente.
- **Gamification colors NON cambiano:** medaglie classifica (oro/argento/bronzo), rarità creature (amber/legendary), Fenice Coin e simili sono **semantica di gioco**, non brand → restano identici in entrambe le aziende. Si ricolora solo la **superficie brand**.

## 4. Architettura: theming per-azienda senza toccare i componenti

Il progetto usa **Tailwind v4** con token CSS in `@theme` (`src/app/globals.css`). Le utility (`bg-brand-orange`, `text-brand-charcoal`, …) compilano a `var(--color-brand-*)`. Poiché le custom property CSS **cascano**, ridefinire quei token sotto un selettore di scope ri-colora automaticamente tutti i discendenti.

**Meccanismo:**
1. La root della dashboard riceve `data-company={aziendaAttiva}` (da `tctx.companyId`, già disponibile in `src/app/(dashboard)/layout.tsx`).
2. In `globals.css`, un blocco `[data-company="serenamente"] { … }` sovrascrive i token brand + font.
3. Risultato: gli 87 file che usano i token brand si ri-colorano **da soli**, zero modifiche ai componenti.

### 4.1 Override token (sotto `[data-company="serenamente"]`)
Rampa verde salvia (ancorata a #78B48C come "400", come l'arancio Fenice è il 400):
```
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
--color-brand-charcoal:      #191970;   /* testo/titoli navy */
--font-display: var(--font-sora), var(--font-geist-sans), sans-serif;
--font-sans:    var(--font-sora), var(--font-geist-sans), sans-serif;
font-family: var(--font-sans);
```
Override dei **token font** (non `font-family` diretto) così sia il corpo (`--font-sans`) sia i titoli (`--font-display`, usato a globals.css:609/617/625) passano a Sora senza regole extra.

### 4.2 Font Sora
Caricata in `src/app/layout.tsx` via `next/font/google` come variabile `--font-sora` (con `sora.variable` aggiunto alla `className` di `<html>`/`<body>`). Caricarla definisce solo la variabile: **non** cambia il font applicato di Fenice (Fenice continua su Geist; `--font-display` di Fenice resta "Sora", Geist → fallback come oggi). Sora viene **applicata** solo dentro lo scope serenamente.

### 4.3 Sfondo soft
Sotto lo scope, l'area principale della dashboard riceve un `background` con 1-2 `radial-gradient` verdi molto tenui (≤8% opacità) negli angoli, per richiamare la brand senza ridurre la leggibilità.

### 4.4 Logo
Nuovo componente `src/components/SerenaMenteLogo.tsx` (SVG inline): icona cervello verde salvia + wordmark "SerenaMente" navy in Sora + payoff "crescita mentale". `src/components/Sidebar.tsx` (riga ~167) renderizza il logo SerenaMente quando `companyId==='serenamente'`, altrimenti il blocco Fenice attuale. La Sidebar riceve `companyId` come prop dal layout.

## 5. Componenti / file toccati
| File | Tipo | Responsabilità |
|------|------|----------------|
| `src/app/layout.tsx` | mod | Carica Sora come `--font-sora` (no impatto Fenice) |
| `src/app/globals.css` | mod | Blocco `[data-company="serenamente"]` (token + font + sfondo) |
| `src/app/(dashboard)/layout.tsx` | mod | `data-company={tctx.companyId}` sulla root + passa `companyId` a Sidebar |
| `src/components/SerenaMenteLogo.tsx` | new | Logo SVG SerenaMente |
| `src/components/Sidebar.tsx` | mod | Logo condizionale per companyId |

## 6. Cosa NON si tocca
- Tutti i componenti che usano i token brand (auto-recolor).
- Le gamification colors hardcoded (medaglie, rarità, coin) — restano semantica di gioco.
- Fenice in ogni sua parte.
- I dati / la logica (questo è puramente visivo).

## 7. Rischi e mitigazioni
- **Contrasto navy-su-verde** ≈ 6.6:1 (AA ok). Verde scuro (700+) con testo bianco. Verifica in QA.
- **Arancioni "brand" hardcoded residui** (es. focus ring scritti come `orange-*` letterale invece di `brand-orange`): non si ricolorano. Si correggono **a vista nella QA** sui punti visibili, convertendoli a `brand-orange` (così seguono il tema). Non si insegue la totalità dei 314 (la maggior parte è gaming).
- **Flash di tema:** `data-company` è impostato server-side nel layout → nessun flash.

## 8. Strategia di QA (visiva)
Niente test runner; QA visiva con Playwright/browse + `tsc --noEmit`.
1. `tsc --noEmit` pulito.
2. Login come Serenamente (account `admin@fenice.com`, già abilitato) in dev o prod.
3. Screenshot di: GDO board, una pipeline, dashboard manager/KPI, classifica, store, ContactDrawer. Verifica: accenti verdi, testo/titoli navy, font Sora, logo SerenaMente in sidebar, nessun arancione "brand" residuo evidente, contrasti leggibili.
4. Fix a vista degli arancioni brand residui + eventuali contrasti, commit atomici.
5. Controllo di non-regressione su **Fenice**: login come Fenice → tutto arancione come prima, font Geist, logo Fenice.

## 9. Plan
Vedi `docs/superpowers/plans/2026-06-06-serenamente-restyle.md`.
