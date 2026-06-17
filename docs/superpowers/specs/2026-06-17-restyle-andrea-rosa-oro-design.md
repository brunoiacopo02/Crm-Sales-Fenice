# Restyle "Rosa Antico & Oro" — Dashboard di Andrea (Conferme) — Design

**Data:** 2026-06-17
**Autore:** Claude (CRM Fenice)
**Stato:** In review
**Sostituisce:** il tema rosa magenta `[data-theme="rosa"]` attualmente live (2026-06-17, commit `e3075ba`) — troppo acceso/poco elegante. Questo lavoro lo rimpiazza.

## Obiettivo

Restyling **completo, elemento per elemento** della dashboard Conferme del **solo utente `andrea@fenice.local`**, in estetica **rosa antico + oro su avorio** (boutique premium, sartoriale, elegante). La **struttura del CRM resta invariata** (layout, IA, posizioni): cambia solo l'aspetto di ogni superficie/elemento. Nessun altro utente, azienda o pagina è toccato.

Design validato con un design system **Stitch** ("Rosa Antico & Oro - Luxury", `assets/127208711045686064`); mockup di riferimento: `docs/superpowers/assets/tema-rosa-andrea/luxury-v1-board.png`.

## Decisioni (brainstorming)

| Tema | Scelta |
|------|--------|
| Direzione | Rosa antico + oro su avorio; rosa **chiaro ed elegante**, oro misurato e prezioso |
| Tipografia | **Playfair Display** (serif) su titoli/nomi/numeri chiave; Plus Jakarta Sans sul resto |
| Card gamification scure | Convertite a **chiare avorio** (token-driven) |
| Colori di stato (esiti) | **Mantenuti** (verde/rosso/blu) ma ammorbiditi/armonizzati — leggibilità degli esiti |
| Struttura CRM | Invariata |
| Gate | Solo `andrea@fenice.local` |

## Architettura

### Naming e attivazione

- Si rinomina il theme attribute da `data-theme="rosa"` → **`data-theme="andrea"`** (è il tema personale di Andrea). `src/lib/userTheme.ts` → `getUserTheme` ritorna `'andrea'` per lei. Il layout emette `data-theme="andrea"` (gate invariato, vedi tema precedente). Vince su `data-company` per source order.
- Il vecchio blocco magenta in `globals.css` (token brand + fire/gaming + orange/amber/yellow + regole sidebar) viene **rimosso** e sostituito.
- Il nuovo tema vive in un **file dedicato** `src/app/themes/andrea-rosa-oro.css`, importato da `globals.css` (un `@import` dopo i token base), per mantenibilità — un unico posto per tutto il tema di Andrea.

### Tre livelli di intervento

1. **Remap completo delle scale-palette** (CSS custom properties) sotto `[data-theme="andrea"]`. L'audit conferma che la dashboard è guidata da: `ash-*` (neutri dominanti), `brand-orange-*`, `fire-*`, `ember-*`, `gold-*`, `gaming-*`, più utility Tailwind `orange/amber/yellow`. Rimappando **tutte** queste scale si re-skinna la grande maggioranza degli elementi.
2. **Tokenizzazione dei componenti gamification** che hardcodano colori scuri/`text-white`/navy (StreakCounter, QuestPanel, LevelNudge, ConfermeDailyObjectives, StreakAnxietyBanner, HotStreak): sostituire i literal con i token gaming (`text-[var(--color-gaming-text)]`, `bg-[var(--color-gaming-bg-card)]`, ecc.). Per gli utenti non-Andrea i token tengono i valori scuri originali → **invariato**; per Andrea i token sono avorio → card chiare. Refactor a rischio ~zero e migliorativo.
3. **Tipografia serif** sui titoli: `--font-display` rimappato a Playfair Display (caricato via `next/font/google` in `src/app/layout.tsx`, come Sora/Jakarta), e applicato — sotto `[data-theme="andrea"]` — a titoli pagina/card, nomi lead, numeri-metrica chiave. Dove i titoli non sono heading semantici, si aggiunge un hook minimale (classe `font-display` o selettore mirato) nei componenti.

### Palette "Rosa Antico & Oro" (valori finali)

Neutri **avorio/taupe caldo** (remap `ash-*`):
```
ash-50 #FBF7F4  ash-100 #F4ECE6  ash-200 #E7DAD0  ash-300 #D9C8BC
ash-400 #B5A398 ash-500 #8A766B  ash-600 #6B5560  ash-700 #4A3A40
ash-800 #3A2230 ash-900 #2A1822
```
Rosa antico (remap `brand-orange-*` e `fire-*`):
```
50 #FBF1F5  100 #F6E2EA  200 #EFCDDB  300 #E3AEC4  400 #D89BB4
500 #CE8BA6  600 #B8748F  700 #9A5C75  800 #7A475C  900 #3A2230
brand-orange #CE8BA6 · hover #B8748F · charcoal #3A2230
fire-400 #D89BB4 · fire-500 #CE8BA6 · fire-600 #B8748F · fire-glow rgba(206,139,166,.4)
```
Oro raffinato (remap `gold-*`, `gaming-gold/amber`):
```
gold-50 #FBF6EA  gold-100 #F5ECCF  gold-300 #E3CC8F  gold-400 #D4B468
gold-500 #C9A24B gold-600 #A8842F
gaming-gold #C9A24B · gaming-gold-dim #A8842F · gaming-amber #D4B468
```
Ember → terracotta-rosa tenue (alert/NR, remap `ember-*`):
```
ember-50 #FBEEE9  ember-100 #F6DCD1  ember-300 #E0A98F  ember-400 #CE8A6A
ember-500 #B86B4A ember-600 #9A5638  ember-700 #7E4329
```
Gaming surfaces da scure → **avorio** (remap `gaming-bg*`/border/text):
```
gaming-bg-deep #F4ECE6  gaming-bg #FBF7F4  gaming-bg-card #FFFFFF
gaming-bg-card-hover #F9F1EC  gaming-bg-surface #F6ECEF
gaming-border rgba(201,162,75,.22)  gaming-border-hover rgba(201,162,75,.40)
gaming-text #3A2230  gaming-text-muted #8A766B
```
Utility Tailwind `orange-*`, `amber-*`, `yellow-*` → scala rosa (50→900 come sopra).
Ombre/glow (`--shadow-*` fire/gold/ember, glow gaming) → rgba rosa/oro soffuse.

**Colori di stato MANTENUTI** (ammorbiditi ma riconoscibili): `emerald`=confermato/chiuso, `rose`/`red`=scartato/sparito/danger, `blue`=GDO/richiami/info, `amber`(semantico esiti) dove indica "presenziato/non chiuso". Questi NON vengono rimappati alla scala rosa (resterebbero leggibili come semafori). Eccezione: le utility `amber/yellow` usate come **accento gamification** (es. progress bar obiettivi, livello, XP) diventano rosa/oro; gli `amber` semantici degli **esiti** restano. In pratica: rimappiamo `orange/yellow` interamente; per `amber` valutiamo per-uso (badge esito = mantieni; barra obiettivo = già passa da `bg-amber-500` → tokenizzata a oro/rosa nel componente).

### Restyle per superficie (intento)

- **Sidebar**: sfondo da gradiente "gaming-sidebar" scuro → avorio/crema caldo; logo elegante; voce attiva con accento oro a sinistra + fondo rosa tenue; separatore gamification linea oro sottile; icone rosa/oro.
- **Topbar**: barra ricerca con bordo hairline oro; pillola livello/XP barra oro; coin pill oro su crema; avatar con anello oro tenue; campana e dropdown su superfici avorio.
- **Widget Obiettivo di Oggi**: da card navy → card avorio chiara, titolo serif, barra avanzamento sottile rosa→oro.
- **Streak / HotStreak / StreakAnxiety**: card avorio, fiamma stilizzata oro/rosa, bordi/glow tenui; stati (safe/at-risk) mantengono semantica (salvia/terracotta) ma raffinati.
- **Livello / LevelNudge**: cornice e barra XP oro su avorio.
- **QuestPanel**: card avorio, accenti oro, quest card con micro-dettagli dorati.
- **Board tabs** (Pomeriggio/Mattina/Richiami/Storico): tab attiva con sottolineatura/accento oro; chip orari raffinati con semaforo stato; filtri NR eleganti.
- **Card lead** (ConfermeBoardRow): bianco caldo, bordo hairline oro, angoli 12px, ombra rosa soffusa; nome in serif; pulsanti — "Chiama" rosa antico pieno, "Riprogramma/Esito/NR/snooze" outline oro/tenui; stato "In Lavorazione" cornice oro + micro-glow; badge esito = colori di stato mantenuti.
- **Drawer** (Dati/Note/Script/Esiti): header elegante, tab attiva accento oro, input `input-fenice` con focus oro/rosa, sezioni esito con bordi raffinati; radio esito mantengono semafori (emerald/rose) armonizzati.
- **Storico (tabella)**: intestazioni e righe su avorio, hover rosa tenue, badge stato mantenuti.

## Cosa NON cambia

- **Struttura/layout/IA**: posizioni, griglie, ordine elementi, comportamento.
- **Logica**: presence realtime, drawer lifecycle, board, timer, quest, server actions, DB, middleware.
- **Altri utenti/aziende/pagine**: tutto è scoped a `[data-theme="andrea"]`; la tokenizzazione dei componenti è no-op per chi non ha l'attributo (i token restano ai valori originali scuri).
- **Semantica dei colori di stato** (esiti): mantenuta.

## Testing / verifica

- Build di produzione pulita.
- Verifica visiva **live con Playwright** (login Andrea `1234`): `/conferme` interamente in rosa antico+oro elegante; ogni superficie (sidebar, topbar, 6 widget, board, card lead, drawer, storico) controllata a schermo; iterazione fino a risultato elegante.
- **Non-regressione**: login altro utente gamification (es. un GDO) → dashboard scura "gaming" invariata; rimozione attributo → tutto torna all'originale. Andrea su Serenamente → tema Andrea (vince sul verde).
- Confronto before/after screenshot.

## Rischi / note

- La tokenizzazione tocca componenti **condivisi** (StreakCounter, QuestPanel, ecc. usati anche dai GDO): ogni sostituzione `text-white`→`text-[var(--color-gaming-text)]` e navy→token va verificata visivamente per i non-Andrea (deve restare identica). `--color-gaming-text` (#F0EBE3) ≈ bianco caldo, quindi neutro.
- Playfair Display: peso del font extra; caricare solo i pesi necessari (es. 500/600/700) con `display: swap`.
- `data-theme` rinominato `rosa`→`andrea`: aggiornare gate, CSS e rimuovere il vecchio blocco per evitare doppioni.
- Overlay gamification rari con stili inline (forziere/duello): fuori dalla dashboard operativa; eventuale ritocco opzionale, non bloccante.
