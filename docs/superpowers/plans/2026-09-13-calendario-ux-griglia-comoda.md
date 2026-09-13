# Calendario venditori — griglia comoda (pass UX/grafico) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere la compilazione settimanale del calendario (`/mio-calendario`) veloce e leggibile: pennellata col mouse, scorciatoie per riga/colonna, gerarchia visiva che mette in primo piano la scelta del venditore, barra "Salva" sempre raggiungibile, nessuna modifica persa per sbaglio, griglia usabile sul telefono.

**Architecture:** Nessuna modifica a server action, tabelle o regole. Tutto il lavoro è nei componenti client: `SlotGrid` (presentazionale, riusato in sola lettura da `/calendari-venditori`), `MioCalendarioClient` (che viene spezzato in tre file), `TemplateEditor`. La logica pura di selezione (toggle di gruppo, direzione della pennellata) va in `src/lib/venditore/calendarSelection.ts` con test node; il gesto di trascinamento in un hook `useDragPaint` condiviso dalle due griglie.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4.2 (variant `pointer-coarse:`; `hover:` è già limitato ai dispositivi con hover), lucide-react, `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-calendario-disponibilita-venditori-design.md` (regole di dominio invariate; questo piano tocca solo §4.4 "griglia" e §6 "UI"). Motivazione: ricerca UX 2026-09-13 — le griglie di disponibilità più usate (When2meet, Morgen, Doodle) usano la pennellata "premi e trascina", scorciatoie per intera riga/colonna e celle ≥44px; la nostra griglia richiedeva fino a 78 click singoli, la scelta del venditore era il segnale visivo più debole (fondi pallidi sotto 78 badge scuri e 78 "⋯"), il bottone Salva stava sotto la piega, e sul telefono la colonna delle ore spariva scorrendo.

## Global Constraints

- I bottoni non sono MAI figli di `<span>`/`<p>` (regola CLAUDE.md, WSOD). Niente `window.confirm/alert/prompt`.
- Fuso Europe/Rome via gli helper di `calendarSlots.ts`; mai `getHours()/getDay()`.
- `SlotGrid` resta presentazionale: nessun import di server action, nessuna regola di dominio (multe, preavviso). I consumer in sola lettura (`CalendariVenditoriClient`, vista "Copertura squadra") devono continuare a funzionare SENZA modifiche: ogni prop nuova è opzionale.
- La pennellata vale per `pointerType` `mouse` e `pen`. Su touch resta il tap singolo (+ scorciatoie riga/colonna): con `touch-action: none` la griglia non scorrerebbe più col dito.
- Il click singolo resta il percorso "normale": una pennellata non deve produrre un doppio toggle sulla cella d'origine.
- Celle occupate (`occupato`), bloccate (`bloccato`) e ore già iniziate (`cellDisabled`) non si pennellano e non entrano nelle scorciatoie riga/colonna.
- Il salvataggio resta esplicito: nessuna azione di griglia scrive a DB (tranne Imprevisto/sblocco dal menu, già così).
- `git add` SOLO dei file elencati nel task: nel working tree ci sono file di altre sessioni (`scripts/*.ts`, `src/lib/cdr/attribuzione.ts`, `.claude/agents/*`) e due file TEMPORANEI da non committare MAI: `src/app/debug/calendar-preview/` e la modifica a `src/middleware.ts`.
- Test: nuovi file `.test.ts` vanno aggiunti alla lista esplicita dello script `test` in `package.json`.
- Copy in italiano, tono del resto dell'app (tu, niente esclamativi).

---

### Task 1: Logica pura di selezione (`calendarSelection.ts`) + test

**Files:**
- Create: `src/lib/venditore/calendarSelection.ts`
- Create: `src/lib/venditore/calendarSelection.test.ts`
- Modify: `package.json` (script `test`: aggiungi `src/lib/venditore/calendarSelection.test.ts` dopo `calendarBooking.test.ts`)

**Interfaces:**
- Produces:
  - `toggleGroup(selected: ReadonlySet<string>, keys: readonly string[], locked: (key: string) => boolean): Set<string>` — ritorna un NUOVO Set. Considera solo le chiavi non `locked`. Se sono tutte già selezionate → le toglie tutte; altrimenti → le aggiunge tutte. Se non c'è nessuna chiave libera ritorna una copia identica.
  - `paintDirection(selected: ReadonlySet<string>, originKey: string): boolean` — `true` = la pennellata rende disponibile (l'origine NON era selezionata), `false` = rende non disponibile.
  - `applyPaint(selected: ReadonlySet<string>, key: string, on: boolean): Set<string>` — nuovo Set con la chiave aggiunta o tolta; ritorna sempre un nuovo Set.

- [ ] **Step 1: Scrivi i test (falliscono: modulo assente)**

```ts
// src/lib/venditore/calendarSelection.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toggleGroup, paintDirection, applyPaint } from './calendarSelection'

const never = () => false

test('toggleGroup: nessuna selezionata → seleziona tutte', () => {
    const out = toggleGroup(new Set(), ['a', 'b', 'c'], never)
    assert.deepEqual([...out].sort(), ['a', 'b', 'c'])
})

test('toggleGroup: alcune selezionate → seleziona le mancanti (non le toglie)', () => {
    const out = toggleGroup(new Set(['a']), ['a', 'b', 'c'], never)
    assert.deepEqual([...out].sort(), ['a', 'b', 'c'])
})

test('toggleGroup: tutte selezionate → le toglie tutte', () => {
    const out = toggleGroup(new Set(['a', 'b', 'c', 'z']), ['a', 'b', 'c'], never)
    assert.deepEqual([...out], ['z'])
})

test('toggleGroup: le chiavi bloccate non contano e non cambiano', () => {
    // 'b' è bloccata e selezionata: resta com'è; a e c sono tutte e due selezionate → si tolgono
    const out = toggleGroup(new Set(['a', 'b', 'c']), ['a', 'b', 'c'], k => k === 'b')
    assert.deepEqual([...out], ['b'])
    // 'b' bloccata e NON selezionata: resta fuori anche quando si accende il gruppo
    const out2 = toggleGroup(new Set(), ['a', 'b'], k => k === 'b')
    assert.deepEqual([...out2], ['a'])
})

test('toggleGroup: solo chiavi bloccate → copia identica', () => {
    const src = new Set(['b'])
    const out = toggleGroup(src, ['b'], () => true)
    assert.notEqual(out, src)
    assert.deepEqual([...out], ['b'])
})

test('paintDirection: origine non selezionata → true (rende disponibile)', () => {
    assert.equal(paintDirection(new Set(), 'a'), true)
    assert.equal(paintDirection(new Set(['a']), 'a'), false)
})

test("applyPaint: aggiunge o toglie senza mutare l'originale", () => {
    const src = new Set(['a'])
    const on = applyPaint(src, 'b', true)
    const off = applyPaint(src, 'a', false)
    assert.deepEqual([...src], ['a'])
    assert.deepEqual([...on].sort(), ['a', 'b'])
    assert.deepEqual([...off], [])
})
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `node --import tsx --test src/lib/venditore/calendarSelection.test.ts`
Expected: FAIL (Cannot find module './calendarSelection')

- [ ] **Step 3: Implementa**

```ts
// src/lib/venditore/calendarSelection.ts
/**
 * Logica pura di selezione della griglia calendario: nessun DOM, nessuna
 * regola di dominio. Chi chiama decide cosa è "bloccato" (ora già iniziata,
 * appuntamento, blocco per imprevisto): qui si ragiona solo su chiavi.
 */

/**
 * Scorciatoia "tutta la riga / tutta la colonna": se ogni chiave libera è già
 * selezionata le toglie tutte, altrimenti le aggiunge tutte. Le chiavi
 * `locked` non vengono né lette né toccate.
 */
export function toggleGroup(
    selected: ReadonlySet<string>,
    keys: readonly string[],
    locked: (key: string) => boolean,
): Set<string> {
    const next = new Set(selected)
    const free = keys.filter(k => !locked(k))
    if (free.length === 0) return next
    const allOn = free.every(k => next.has(k))
    for (const k of free) {
        if (allOn) next.delete(k)
        else next.add(k)
    }
    return next
}

/** La pennellata prende il verso dalla cella d'origine: se non era selezionata, seleziona. */
export function paintDirection(selected: ReadonlySet<string>, originKey: string): boolean {
    return !selected.has(originKey)
}

export function applyPaint(selected: ReadonlySet<string>, key: string, on: boolean): Set<string> {
    const next = new Set(selected)
    if (on) next.add(key)
    else next.delete(key)
    return next
}
```

- [ ] **Step 4: Aggiungi il file allo script `test` di `package.json`** (dopo `src/lib/venditore/calendarBooking.test.ts`), poi `npm test` → tutti verdi (402 + 7).

- [ ] **Step 5: Commit**

```bash
git add src/lib/venditore/calendarSelection.ts src/lib/venditore/calendarSelection.test.ts package.json
git commit -m "feat(calendario): logica pura di selezione per scorciatoie e pennellata"
```

---

### Task 2: `SlotGrid` — pennellata, scorciatoie, gerarchia visiva, colonna ore fissa

**Files:**
- Create: `src/components/calendar/useDragPaint.ts`
- Modify: `src/components/calendar/SlotGrid.tsx`

**Interfaces:**
- Consumes: niente dal Task 1 (la griglia non conosce la selezione: inoltra gesti).
- Produces (tutte opzionali, i consumer read-only restano invariati):
  - `SlotCellView.icon?: 'check' | 'minus'` — glifo centrale (lucide `Check` / `Minus`, `h-3.5 w-3.5`), per non affidare lo stato al solo colore.
  - `SlotGridProps.onCellPaint?: (slotKey: string, on: boolean) => void` — chiamata per OGNI cella attraversata da una pennellata (origine compresa) con il verso deciso dalla griglia: `on = (stato origine !== 'disponibile')`.
  - `SlotGridProps.onHourToggle?: (hour: number) => void` e `onDayToggle?: (dayIndex: number) => void` (dayIndex 0=lun … 5=sab). Se presenti e la griglia non è `readOnly`, le intestazioni diventano bottoni.
  - Hook `useDragPaint({ enabled, isPaintable, isOn, onPaint })` in `useDragPaint.ts`, riusato dal Task 4:

```ts
// src/components/calendar/useDragPaint.ts
"use client"
import { useRef, useCallback, type PointerEvent as ReactPointerEvent } from "react"

/**
 * Pennellata "premi e trascina" su una griglia di celle marcate con
 * `data-paint-key`. Solo mouse/penna: su touch `touch-action: none`
 * impedirebbe di scorrere la pagina col dito, quindi lì resta il tap.
 *
 * Il click singolo NON passa di qui: la pennellata inizia solo quando il
 * puntatore entra in una SECONDA cella. A quel punto l'origine viene
 * dipinta e il `click` che il browser emette al rilascio va ignorato
 * (`shouldIgnoreClick`), altrimenti l'origine cambierebbe due volte.
 */
export interface DragPaintOptions {
    enabled: boolean
    /** La cella accetta la pennellata (non occupata/bloccata/passata). */
    isPaintable: (key: string) => boolean
    /** Stato attuale della cella: decide il verso della pennellata dall'origine. */
    isOn: (key: string) => boolean
    onPaint: (key: string, on: boolean) => void
}

export function useDragPaint({ enabled, isPaintable, isOn, onPaint }: DragPaintOptions) {
    const stroke = useRef<{ origin: string; on: boolean; painted: Set<string>; started: boolean } | null>(null)
    const ignoreNextClick = useRef(false)

    const keyAt = (x: number, y: number): string | null => {
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-paint-key]')
        return el?.dataset.paintKey ?? null
    }

    const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        if (!enabled) return
        if (e.pointerType === 'touch' || e.button !== 0) return
        const key = (e.target as HTMLElement).closest<HTMLElement>('[data-paint-key]')?.dataset.paintKey
        if (!key || !isPaintable(key)) return
        stroke.current = { origin: key, on: !isOn(key), painted: new Set(), started: false }
        e.currentTarget.setPointerCapture(e.pointerId)
    }, [enabled, isPaintable, isOn])

    const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        const s = stroke.current
        if (!s) return
        const key = keyAt(e.clientX, e.clientY)
        if (!key) return
        if (!s.started) {
            if (key === s.origin) return
            s.started = true
            ignoreNextClick.current = true
            s.painted.add(s.origin)
            onPaint(s.origin, s.on)
        }
        if (s.painted.has(key) || !isPaintable(key)) return
        s.painted.add(key)
        onPaint(key, s.on)
    }, [isPaintable, onPaint])

    const endStroke = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        if (!stroke.current) return
        stroke.current = null
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* già rilasciato */ }
        // Il click arriva DOPO pointerup: il flag si azzera al primo click
        // successivo, o al prossimo giro di event loop se il click non arriva
        // (rilascio fuori dalla griglia).
        setTimeout(() => { ignoreNextClick.current = false }, 0)
    }, [])

    /** Da chiamare all'inizio dell'handler di click della cella: `true` = era la fine di una pennellata. */
    const shouldIgnoreClick = useCallback((): boolean => {
        if (!ignoreNextClick.current) return false
        ignoreNextClick.current = false
        return true
    }, [])

    return {
        containerProps: {
            onPointerDown,
            onPointerMove,
            onPointerUp: endStroke,
            onPointerCancel: endStroke,
        },
        shouldIgnoreClick,
    }
}
```

- [ ] **Step 1: Crea `useDragPaint.ts`** con il codice sopra.

- [ ] **Step 2: Modifica `SlotGrid.tsx`** — requisiti, tutti da rispettare:

  1. **Tipi**: aggiungi `icon?: 'check' | 'minus'` a `SlotCellView`; aggiungi `onCellPaint`, `onHourToggle`, `onDayToggle` a `SlotGridProps` (opzionali). Importa `Check, Minus` da `lucide-react`.
  2. **Pennellata**: `const paintable = (key) => { const v = cells.get(key); return !!v && !v.cellDisabled && (v.state === 'disponibile' || v.state === 'nondisponibile' || v.state === 'libero') }`; `const { containerProps, shouldIgnoreClick } = useDragPaint({ enabled: !readOnly && !!onCellPaint, isPaintable: paintable, isOn: key => cells.get(key)?.state === 'disponibile', onPaint: (k, on) => onCellPaint?.(k, on) })`. Spalma `{...containerProps}` sul `div.grid` e aggiungi `select-none` alla sua className. Ogni bottone-cella pennellabile porta `data-paint-key={key}` (solo se `paintable(key)` e non readOnly, così le celle occupate/bloccate non entrano nel gesto). L'`onClick` della cella diventa `() => { if (shouldIgnoreClick()) return; onCellClick?.(key) }`.
  3. **Scorciatoie**: se `!readOnly && onHourToggle` l'etichetta dell'ora è un `<button type="button">` (stesse classi della cella-etichetta attuale + `cursor-pointer hover:bg-ash-100 transition-colors`, `aria-label="Seleziona o deseleziona le HH:00 su tutti i giorni"`, `title="Tutta la riga"`); altrimenti resta un `div`. Idem per l'intestazione del giorno con `onDayToggle(d)` (`aria-label="Seleziona o deseleziona tutte le ore di <Lun 14/09>"`, `title="Tutto il giorno"`). Le intestazioni NON hanno `data-paint-key`.
  4. **Colonna ore fissa**: la cella "Ora" e le etichette delle ore ricevono `sticky left-0 z-10` (il loro `bg-ash-50` è già opaco). Serve perché il contenitore è `overflow-x-auto` con `min-w-[720px]`: sul telefono, scorrendo verso sabato, le ore sparivano.
  5. **Altezza**: `min-h-14` → `min-h-11` (44px = minimo touch; 13 righe ≈ 600px, la settimana intera sta in uno schermo da laptop).
  6. **Gerarchia visiva** — `STATE_STYLES`:
     - `libero: 'bg-white border-ash-200 text-ash-400'` (invariato)
     - `disponibile: 'bg-emerald-100 border-emerald-300 text-emerald-900'`
     - `nondisponibile: 'bg-rose-100/70 border-rose-200 text-rose-800'`
     - `occupato: 'bg-sky-100 border-sky-300 text-sky-900'`
     - `bloccato: 'bg-ash-100 border-ash-300 text-ash-500 line-through'` (invariato)
     Il glifo `icon` si renderizza al centro (prima di `subtitle`): `check` → `<Check className="h-3.5 w-3.5" aria-hidden />`, `minus` → `<Minus className="h-3.5 w-3.5 opacity-60" aria-hidden />`. Il glifo è figlio diretto del `<button>`, non dentro uno `<span>`.
  7. **Badge discreto**: il badge non è più una pastiglia scura in alto a destra. Diventa testo piccolo in alto a SINISTRA: `absolute left-1 top-1 text-[9px] font-semibold leading-none text-ash-500` con il contenuto `+{badge}` se `badge` è numerico (`/^\d+$/`), altrimenti `badge` così com'è. Il `pointer-events-none` resta. (Semantica invariata: "altri colleghi disponibili in quest'ora"; l'aggiornamento della legenda è nel Task 3.)
  8. **"⋯" solo quando serve**: al `div` esterno di ogni cella aggiungi `group`; al bottone "⋯" aggiungi `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity` e alza il padding a `px-1.5 py-0.5` (target più facile). Quando `openKey === key` il bottone deve restare visibile (`opacity-100`). Su touch (`pointer-coarse`) resta sempre visibile: lì non c'è hover.
  9. **Ore già iniziate leggibili**: per `view.cellDisabled` (griglia NON readOnly) NON usare l'attributo `disabled` — Chrome non mostra il `title` sui bottoni disabilitati e la cella sembrava rotta. Usa `aria-disabled="true"`, `cursor-not-allowed`, uno sfondo a righe diagonali sottili (classe `bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(0,0,0,0.05)_6px_8px)]`) e nel click `if (view.cellDisabled) return`. Le griglie `readOnly` continuano a usare `disabled` (lì non c'è niente da spiegare). `onContextMenu`/menu: invariati (una cella passata bloccata si sblocca sempre).
  10. **Tone bar** (3px in alto): invariata.
  11. Aggiorna il commento di testa del file: una riga su pennellata + scorciatoie + "presentazionale: i verso/toggle li decide il genitore".

- [ ] **Step 3: Verifica** — `npx tsc --noEmit` pulito; `npm run build` ok; `npm test` verde. Apri a mano (server dev su `http://localhost:3010/debug/calendar-preview?s=dichiarata`, già avviato dal controller) e controlla: trascinando col mouse su 4 celle libere si colorano tutte e 4 e l'origine non "rimbalza"; click singolo funziona; click su "15:00" e su "Mar 15/09" invocano i toggle (nel fixture il genitore non è ancora cablato: basta che non esplodano); la colonna ore resta ferma scorrendo in orizzontale a finestra stretta.

- [ ] **Step 4: Commit**

```bash
git add src/components/calendar/useDragPaint.ts src/components/calendar/SlotGrid.tsx
git commit -m "feat(calendario): griglia con pennellata, scorciatoie riga/colonna e colonna ore fissa"
```

---

### Task 3: `MioCalendarioClient` — cablaggio gesti, barra Salva fissa, nessuna modifica persa, file spezzato

**Files:**
- Create: `src/components/calendar/calendarFormat.ts` (helper di formattazione condivisi)
- Create: `src/app/(dashboard)/mio-calendario/StatusStrip.tsx`
- Modify: `src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx`
- Modify: `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx` (solo: usa `formatWeekRange` da `calendarFormat.ts`, elimina la copia locale)
- Modify: `src/components/calendar/CoverageLegend.tsx` (variante `personale`: aggiungi la voce "+N = altri colleghi disponibili in quell'ora")

**Interfaces:**
- Consumes: Task 1 (`toggleGroup`, `applyPaint`), Task 2 (`onCellPaint`, `onHourToggle`, `onDayToggle`, `icon`).
- Produces: `calendarFormat.ts` esporta `formatWeekRange(weekStartIso)`, `formatCountdown(ms)`, `capitalize(s)` e i formatter `weekdayFmt`, `dateSlashFmt`, `timeFmt`, `dayOnlyFmt`, `monthOnlyFmt` (tutti `timeZone: 'Europe/Rome'`), spostati pari pari da `MioCalendarioClient.tsx`. `StatusStrip.tsx` esporta `StatusStrip` con le stesse props di oggi (`data`, `now`, `onOpenTemplate`), spostato pari pari (inclusi i commenti).

- [ ] **Step 1: Spezza il file.** Sposta formatter + `formatCountdown` + `formatWeekRange` + `capitalize` in `calendarFormat.ts` (senza `"use client"`: sono funzioni pure); sposta `StatusStrip` in `StatusStrip.tsx` (`"use client"`). `MioCalendarioClient.tsx` importa da lì. In `CalendariVenditoriClient.tsx` sostituisci la `formatWeekRange` locale (riga ~48) con l'import — verifica prima che le due implementazioni coincidano; se differiscono, tieni quella di `MioCalendarioClient` e segnalalo nel report. `npx tsc --noEmit` pulito, comportamento identico.

- [ ] **Step 2: Cabla i gesti.** In `MioCalendarioClient`:
  - `myCells`: per `state === 'disponibile'` imposta `icon: 'check'`; per `nondisponibile` imposta `icon: 'minus'`. (Per `libero` nessun glifo.)
  - `const lockedKey = (key: string) => { const c = myCells.get(key); return !c || !!c.cellDisabled || c.state === 'occupato' || c.state === 'bloccato' }`.
  - `handleCellPaint = (key, on) => { if (!data.editable) return; if (lockedKey(key)) return; setSelected(prev => applyPaint(prev, key, on)) }`.
  - `handleHourToggle = (hour) => { if (!data.editable) return; const keys = slots.filter(s => romeHour(s) === hour).map(slotKey); setSelected(prev => toggleGroup(prev, keys, lockedKey)) }` (`romeHour` da `calendarSlots.ts`).
  - `handleDayToggle = (dayIndex) => { const keys = slots.slice(dayIndex * SLOT_HOURS.length, (dayIndex + 1) * SLOT_HOURS.length).map(slotKey); ... }` (stesso ordinamento usato da `SlotGrid`: `weekSlots` è giorno-maggiore, 13 ore per giorno — `SLOT_HOURS` da `calendarSlots.ts`).
  - Passa `onCellPaint`, `onHourToggle`, `onDayToggle` a `<SlotGrid>` della vista `mio` solo se `role === 'VENDITORE' && data.editable`.

- [ ] **Step 3: Barra Salva fissa.** Sostituisci il blocco `flex items-center justify-end` con il bottone Salva con una barra che compare solo quando `canSave` (e `role === 'VENDITORE'`):

```tsx
{role === 'VENDITORE' && canSave && (
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-2 shadow-lg backdrop-blur">
        <div className="text-sm text-amber-900">
            {dirty
                ? <><span className="font-semibold">Modifiche non salvate</span> — {selected.size} ore disponibili</>
                : <><span className="font-semibold">Conferma la settimana</span> — {selected.size} ore disponibili</>}
        </div>
        <div className="flex items-center gap-2">
            {dirty && (
                <button type="button" onClick={discardChanges} disabled={isPending}
                    className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-default disabled:opacity-50">
                    Scarta
                </button>
            )}
            <button type="button" onClick={handleSave} disabled={isPending}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-default disabled:opacity-50">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Salva
            </button>
        </div>
    </div>
)}
```
  con `const discardChanges = () => setSelected(new Set(data.mySlots))`. Il testo "N ore" vive nella barra, non più nel bottone. Gli `<span>` qui contengono solo testo, mai bottoni.

- [ ] **Step 4: Nessuna modifica persa.**
  - `beforeunload` quando `dirty && data.editable`: `useEffect(() => { if (!dirty || !data.editable) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault() }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h) }, [dirty, data.editable])`.
  - Cambio settimana con modifiche: `goWeek(delta)` diventa: se `dirty && data.editable` → `setPendingWeekDelta(delta)` e basta; altrimenti carica. Sotto il navigatore, quando `pendingWeekDelta !== null`, mostra un riquadro inline (NIENTE `window.confirm`):

```tsx
{pendingWeekDelta !== null && (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div>Hai modifiche non salvate su questa settimana.</div>
        <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { const d = pendingWeekDelta; setPendingWeekDelta(null); saveThen(() => goWeekNow(d)) }} className="cursor-pointer rounded-lg bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95">Salva e cambia</button>
            <button type="button" onClick={() => { const d = pendingWeekDelta; setPendingWeekDelta(null); discardChanges(); goWeekNow(d) }} className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100">Scarta e cambia</button>
            <button type="button" onClick={() => setPendingWeekDelta(null)} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100">Resta qui</button>
        </div>
    </div>
)}
```
  dove `goWeekNow` è l'attuale `goWeek` e `saveThen(after)` riusa la logica di `handleSave` chiamando `after()` solo se il salvataggio è riuscito (rifattorizza `handleSave` in `saveWeek(): Promise<boolean>` dentro la transition). Attenzione a `discardChanges(); goWeekNow(d)`: `loadWeek` cambia `data.weekStartIso` e l'effetto esistente resetta `selected` — è sufficiente, ma `discardChanges` prima non fa danni. Se la vista cambia a `modello`/`copertura` la selezione locale resta viva (`selected` vive nel genitore) — nessun prompt lì.

- [ ] **Step 5: Legenda.** In `CoverageLegend` variante `personale`, dopo "Bloccato", aggiungi una voce di testo `+N = altri colleghi disponibili in quell'ora` (`text-ash-500`). Aggiorna il commento di testa.

- [ ] **Step 6: Verifica.** `npx tsc --noEmit`, `npm run build`, `npm test`. A mano su `http://localhost:3010/debug/calendar-preview?s=dichiarata`: pennellata cambia la selezione e la barra "Modifiche non salvate" compare in basso e resta visibile scorrendo; "Scarta" ripristina; clic su un'ora seleziona/deseleziona la riga saltando le celle occupate/bloccate/passate; freccia settimana con modifiche → riquadro inline; `?s=proposta` → barra "Conferma la settimana" già visibile senza toccare nulla; `?s=altrui` e `?s=passata` → nessuna barra, nessun toggle sulle intestazioni.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/calendarFormat.ts "src/app/(dashboard)/mio-calendario/StatusStrip.tsx" "src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx" "src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx" src/components/calendar/CoverageLegend.tsx
git commit -m "feat(calendario): pennellata e scorciatoie cablate, barra Salva fissa, niente modifiche perse"
```

---

### Task 4: `TemplateEditor` — stessa lingua visiva della griglia

**Files:**
- Modify: `src/components/calendar/TemplateEditor.tsx`
- Modify: `src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx` (solo la riga di aiuto, Step 5)

**Interfaces:**
- Consumes: `useDragPaint` (Task 2), `toggleGroup`/`applyPaint` (Task 1).

- [ ] **Step 1:** Sostituisci il testo nelle celle ("Disponibile"/"Non disp.") con gli stessi glifi e colori della griglia: attiva → `bg-emerald-100 text-emerald-900` + `<Check className="h-3.5 w-3.5" aria-hidden />`; non attiva → `bg-rose-100/70 text-rose-800` + `<Minus className="h-3.5 w-3.5 opacity-60" aria-hidden />`. `min-h-12` → `min-h-11`. L'`aria-label` resta testuale (già c'è).
- [ ] **Step 2:** `toggleRow`/`toggleColumn` usano `toggleGroup(prev, keys, () => false)`; `toggleCell` usa `applyPaint(prev, key, !prev.has(key))`.
- [ ] **Step 3:** Pennellata: `useDragPaint({ enabled: !isPending, isPaintable: () => true, isOn: k => selected.has(k), onPaint: (k, on) => setSelected(prev => applyPaint(prev, k, on)) })`; `{...containerProps}` + `select-none` sul `div.grid`; `data-paint-key={key}` su ogni cella; `onClick` cella → `if (shouldIgnoreClick()) return; toggleCell(dow, hour)`.
- [ ] **Step 4:** Colonna ore fissa: `sticky left-0 z-10` sulla cella "Ora" e sui bottoni delle ore; `title="Tutta la riga"` / `title="Tutto il giorno"` sulle intestazioni (come nel Task 2).
- [ ] **Step 5:** Sopra la griglia, sotto il riquadro "Vale ogni settimana…", una riga di aiuto `text-xs text-ash-500`: "Clicca un'ora per tutta la riga, un giorno per tutta la colonna, oppure trascina col mouse."  La stessa riga va anche in `MioCalendarioClient` sopra la griglia personale, solo quando `role === 'VENDITORE' && data.editable`.
- [ ] **Step 6:** `npx tsc --noEmit`, `npm run build`, `npm test`. A mano: `?s=modello` → scheda "Settimana tipo", pennellata e scorciatoie funzionano, Salva si accende solo se cambia qualcosa.
- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/TemplateEditor.tsx "src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx"
git commit -m "feat(settimana-tipo): pennellata, glifi e colonna ore fissa come nella griglia"
```

---

### Task 5: Correzioni dall'audit backend (definite dal controller dopo il rapporto)

Riservato: il controller aggiunge qui i task derivati dal rapporto `audit-backend-calendario.md` prima di dispacciarli. Ogni correzione: test prima, fix minimo, commit separato.


---

### Task 5: Muro e copertura dicono la verità (esenti, doppio appuntamento, occupati)

Origine: audit backend 2026-09-13 (findings I-1, I-2, I-3, M-7, M-8). Nessuna migrazione.

**Files:**
- Modify: `src/lib/venditore/calendarBooking.ts`
- Modify: `src/lib/venditore/calendarBooking.test.ts`
- Modify: `src/lib/venditore/calendarCoverage.ts`
- Modify: `src/lib/venditore/calendarCoverage.test.ts`
- Modify: `src/app/actions/confermeActions.ts` (`checkBookingAllowed` e i suoi tre chiamanti alle righe ~424, ~699, ~1406; `getVenditoriAgenda` riga ~1856)
- Modify: `src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx` (solo il calcolo di `othersAvailable`)

**Interfaces:**
- Produces: `BookingRefusal` guadagna `'gia_occupato'`; `bookingCheck` accetta `occupied: boolean`; `checkBookingAllowed(salesUserId, appointmentAt, role, leadId)` (quarto parametro: il lead che si sta fissando, escluso dal conteggio dei conflitti). `CoverageCell.available` esclude chi ha già un appuntamento in quell'ora; `CoverageCell.busy` invariato.

- [ ] **Step 1: Test `calendarBooking.test.ts`** (aggiungi, nello stile dei test esistenti):

```ts
test('non si fissa dove il venditore ha già un appuntamento', () => {
    const slot = new Date('2026-09-15T14:00:00.000Z')
    const out = bookingCheck({ slot, declared: true, blocked: false, occupied: true })
    assert.deepEqual(out, { ok: false, reason: 'gia_occupato' })
})

test('il blocco vince sull occupato nel messaggio (ordine: griglia, dichiarato, bloccato, occupato)', () => {
    const slot = new Date('2026-09-15T14:00:00.000Z')
    assert.deepEqual(bookingCheck({ slot, declared: false, blocked: true, occupied: true }), { ok: false, reason: 'non_dichiarato' })
    assert.deepEqual(bookingCheck({ slot, declared: true, blocked: true, occupied: true }), { ok: false, reason: 'bloccato' })
})
```
  e nel test dei messaggi: `assert.match(bookingRefusalMessage('gia_occupato', at), /già un appuntamento/)`. Run: fallisce (tipo/reason sconosciuti).

- [ ] **Step 2: `calendarBooking.ts`**: `export type BookingRefusal = 'fuori_griglia' | 'non_dichiarato' | 'bloccato' | 'gia_occupato'`; `bookingCheck` accetta `occupied: boolean` (obbligatorio) e dopo il controllo `blocked` ritorna `{ ok: false, reason: 'gia_occupato' }` se `occupied`; `bookingRefusalMessage` → `case 'gia_occupato': return \`Il venditore ha già un appuntamento alle ${ora}.\``. Aggiorna il commento di testa: "un'ora dichiarata è un'ora offerta, e un appuntamento la consuma".

- [ ] **Step 3: Test `calendarCoverage.test.ts`** (aggiungi):

```ts
test('chi ha già un appuntamento non conta come disponibile, ma resta in busy', () => {
    const slots = weekSlots(romeInstant('2026-09-14', 0))
    const key = slotKey(slots[0])
    const cells = buildCoverage({
        slots,
        availability: [{ salesUserId: 'a', slotKey: key }, { salesUserId: 'b', slotKey: key }],
        blocks: [],
        appointments: [{ salesUserId: 'a', slotKey: key, leadId: 'l1', leadName: 'Mario' }],
        demand: [],
    })
    const cell = cells.find(c => c.slotKey === key)!
    assert.deepEqual(cell.available, ['b'])
    assert.equal(cell.busy.length, 1)
})
```
  (adatta import/nomi a quelli già usati nel file di test). Run: fallisce (`available` = ['a','b']).

- [ ] **Step 4: `calendarCoverage.ts`**: in `buildCoverage`, `const busyUsers = new Set((busyBy.get(key) || []).map(b => b.salesUserId))` e `available = [...declared].filter(u => !blockedSet.has(u) && !busyUsers.has(u))`. Aggiorna il commento su `available` ("dichiarato, non bloccato e senza appuntamento in quell'ora"). `npm test` verde.

- [ ] **Step 5: `confermeActions.ts`**:
  - `checkBookingAllowed(salesUserId, appointmentAt, role, leadId: string)`: dopo l'interruttore e il ruolo, leggi `users.calendarExempt` del venditore (`db.select({ calendarExempt: users.calendarExempt }).from(users).where(eq(users.id, salesUserId))`): se esente → `{ ok: true }` (commento: "l'esenzione vale anche per il muro: un esente non compila il calendario, quindi non avrebbe mai uno slot dichiarato e ogni suo appuntamento finirebbe in Forzature — coerente con `absenceReportCheck`"). Poi, insieme a `declared`/`blocked`, leggi `occupied`: esiste un lead con `salespersonUserId = salesUserId`, `appointmentDate >= slot` e `< slot + 1h`, `id <> leadId`. SENZA filtro `companyId` (commento: "un venditore è una persona sola: un appuntamento su Serenamente occupa l'ora anche per Fenice; la lettura torna solo un booleano, nessun dato dell'altra azienda esce"). `return bookingCheck({ slot, declared: !!declared, blocked: !!blocked, occupied: !!occupied })`.
  - I tre chiamanti passano il `leadId` del lead in lavorazione (`leadId` / `oldLead.id`).
  - `scheduleConfermeRecall` (riga ~1405): applica al ramo `payload.newAppointmentDate` la stessa guardia "appuntamento invariato" di `updateLeadDataConferme` (righe ~406-419): confronto per slot con `slotStartFor` e fallback per istante; se invariato `gate = { ok: true }`. Estrai quel confronto in una funzione locale `sameAppointmentSlot(oldDate: Date | null, newDate: Date | null | undefined): boolean` usata da entrambi (il codice di `updateLeadDataConferme` diventa una chiamata).
  - `getVenditoriAgenda` riga ~1856: `lte(leads.appointmentDate, endDate)` → `lt(...)` (coerente con disponibilità/blocchi/segnalazioni).

- [ ] **Step 6: `MioCalendarioClient.tsx`**: `othersAvailable = cov ? cov.available.filter(id => id !== data.targetUserId).length : 0` e togli `amIAvailableServerSide`/`mySlotsSet` se non più usati altrove (aggiorna il commento: "la copertura arriva dal DB: `available` non contiene chi ha un appuntamento, quindi basta escludere me stesso per id").

- [ ] **Step 7:** `npx tsc --noEmit`, `npm run build`, `npm test`. Commit:

```bash
git add src/lib/venditore/calendarBooking.ts src/lib/venditore/calendarBooking.test.ts src/lib/venditore/calendarCoverage.ts src/lib/venditore/calendarCoverage.test.ts src/app/actions/confermeActions.ts "src/app/(dashboard)/mio-calendario/MioCalendarioClient.tsx"
git commit -m "fix(calendario): il muro rispetta gli esenti e blocca il doppio appuntamento; la copertura esclude chi è già occupato"
```

---

### Task 6: Igiene delle action e del cron del calendario

Origine: audit backend 2026-09-13 (I-4, I-5, I-6a, I-7, M-1, M-2, M-3, M-4, M-9, M-10). Nessuna migrazione.

**Files:**
- Modify: `src/app/actions/salesCalendarActions.ts`
- Modify: `src/app/actions/salesCalendarAdminActions.ts`
- Modify: `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx` (scheda Compilazione: evidenza "0 ore")
- Modify: `src/lib/venditore/calendarRunner.ts`
- Modify: `src/lib/venditore/calendarQueries.ts`
- Modify: `src/app/api/cron/sales-late-penalties/route.ts`
- Modify: `src/app/actions/venditoriMonitorActions.ts`
- Modify: `src/app/actions/confermeActions.ts` (`getVenditoriAgenda`: filtro `reportedRows`)
- Modify: `src/components/ConfermeBoard.tsx` (import morti)

- [ ] **Step 1 — I-4 (segnalazione assenza cross-azienda)**: in `reportSalesAbsence`, il pre-check `reported` perde `eq(salesLatePenalties.companyId, ctx.companyId)` (l'indice unico `sales_penalties_userkind_uq` è per persona, non per azienda: commento). Se `inserted.length === 0` → `return { success: false, error: 'Assenza già segnalata per questo slot.' }` invece di `success: true`. In `getVenditoriAgenda` (`confermeActions.ts` ~1887) togli lo stesso `eq(companyId)` da `reportedRows`, così il bottone "Non c'era" si spegne anche dall'altra azienda.
- [ ] **Step 2 — I-5 (multe alle Conferme)**: in `getCalendarSupervision`, se `role === 'CONFERME'` la query `penaltyRows` non viene eseguita e la risposta ha `penalties: []`, `totalEur: 0` (la pastiglia "Multa" della scheda Compilazione resta: è un dato separato). Aggiorna il commento di testa perché dica il vero.
- [ ] **Step 3 — I-6a (compilato a zero)**: in `getCalendarSupervision`, l'ordinamento della scheda Compilazione tratta `slotCount === 0 && submittedAtIso` come inadempiente ai fini dell'ordine (subito dopo i non compilati). In `CalendariVenditoriClient.tsx` la riga con `slotCount === 0` mostra una pastiglia ambra "0 ore: imprenotabile" accanto allo stato compilato. Nessuna multa automatica: è una decisione del PO, da portare in supervisione (il controller la segnala a Bruno).
- [ ] **Step 4 — I-7 (corsa col cron)**: in `saveCalendarWeek` l'insert su `salesAvailabilitySlots` diventa `.onConflictDoNothing()` con commento ("la DELETE ha già ripulito il futuro: una riga uguale può arrivare solo dal cron nel frattempo, e vale quanto la nostra").
- [ ] **Step 5 — M-1**: in `materializeTemplates`, `slotCount` = numero di righe effettivamente inserite (`.returning({ id })` sull'insert degli slot, poi `update salesWeekPlans set slotCount` nella stessa transazione — oppure inserisci prima gli slot con returning e poi il piano: NO, l'ordine piano→slot è una guardia documentata; quindi update dopo).
- [ ] **Step 6 — M-2**: `calendarRunner.ts` righe ~260 e ~316: interpola `CALENDAR_PENALTY_EUR` al posto di "50 €" scritto a mano.
- [ ] **Step 7 — M-3 + M-4 (errori leggibili)**: in tutte le action che tornano `{ success, error }` (`saveCalendarWeek`, `blockSlot`, `unblockSlot`, `saveMyTemplate`, `clearMyTemplate`, `reportSalesAbsence`, `voidCalendarPenalty`, `setCalendarExempt`) la chiamata a `requireSalesSession`/`requireCalendarSupervisor` e il parsing dell'input vanno DENTRO il `try`; il `catch` distingue `e.message === 'Unauthorized'` → `{ success: false, error: 'Sessione scaduta: ricarica la pagina.' }`. Validazione: chiavi slot con `/^\d{4}-\d{2}-\d{2}@\d{1,2}$/` (le altre si scartano, come oggi); `slotIso`/`weekStartIso` con `Number.isNaN(d.getTime())` → `{ success: false, error: 'Data non valida.' }`. Per `getCalendarWeek` (che torna una view, non un result) basta validare `weekStartIso` e ricadere sulla settimana corrente se non valida.
- [ ] **Step 8 — M-9**: `getVenditoriMonitor` (`venditoriMonitorActions.ts` ~194): aggiungi `eq(salesLatePenalties.monthKey, <monthKey del mese selezionato>)` al `where` di `penaltyRows` (il filtro in memoria alla riga ~362 resta come rete). Verifica prima che `penalisedKeys` (righe successive) non dipenda da mesi diversi da quello selezionato: se sì, tieni per quello una query separata limitata al range di date già usato dai filtri.
- [ ] **Step 9 — M-10**: (a) cron route: `if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 })` prima del confronto; (b) `runCalendarWeekly()` in `try/catch` con `console.error`, così un errore del calendario non salta il giro dei ritardi; (c) `calendarRunner.ts` ~254-264: una sola `insert(notifications).values([...])`; (d) `calendarQueries.ts` ~264-269: `addWeeks(weekStart, 1)` e `addWeeks(weekStart, -DEMAND_WEEKS)` al posto dell'aritmetica in millisecondi; (e) `ConfermeBoard.tsx`: togli `AlertCircle, PhoneOff, Phone` dall'import.
- [ ] **Step 10:** `npx tsc --noEmit`, `npm run build`, `npm test`. Commit unico:

```bash
git add src/app/actions/salesCalendarActions.ts src/app/actions/salesCalendarAdminActions.ts "src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx" src/lib/venditore/calendarRunner.ts src/lib/venditore/calendarQueries.ts src/app/api/cron/sales-late-penalties/route.ts src/app/actions/venditoriMonitorActions.ts src/app/actions/confermeActions.ts src/components/ConfermeBoard.tsx
git commit -m "fix(calendario): segnalazioni cross-azienda, multe invisibili alle Conferme, errori leggibili, cron più robusto"
```


---

### Task 7: Conferme — fissare sull'ora giusta deve essere più facile che forzare

Origine: audit UX 2026-09-13 (A1, A3, A4, A5, A6, A8, M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M12). Dipende dal Task 5 (`BookingDecision.freeHours`, `forceReasonProblem`).

**Files:**
- Modify: `src/components/VenditoriAgendaModal.tsx`
- Modify: `src/components/ForceBookingReason.tsx`
- Modify: `src/components/ConfermeDrawer.tsx`
- Modify: `src/components/ConfermeBoardRow.tsx`
- Modify: `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx` (solo M12: stringhe)
- Modify: `src/lib/venditore/calendarRules.ts` (+ test) (solo M12: stringhe)

**Interfaces:**
- Consumes: `getVenditoriAgenda(startIso, endIso)` (già esportata da `confermeActions.ts`; leggi la firma vera e la forma del risultato: per venditore `declaredSlots`, `blockedSlots`, `appointments`), `absenceRefusalMessage`, `CALENDAR_PENALTY_EUR`, `forceReasonProblem` (Task 5).

- [ ] **Step 1 — A1 + A8 (ore libere dentro il drawer)**: in `ConfermeDrawer`, tab "Dati Lead", sotto i due input data/ora (riga ~709-722): un `useEffect` che, quando cambiano il giorno scelto e il venditore assegnato (`salespersonUserId` del lead o la `<select>` del tab Esiti), chiama `getVenditoriAgenda` sull'intervallo di QUEL giorno (00:00→24:00 Rome, via `romeInstant`) e calcola per ogni venditore le ore libere = dichiarate − bloccate − occupate da un appuntamento (escludendo il lead corrente). Render: una riga di pastiglie cliccabili `HH:00` (stile `rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100`) che impostano l'input ora; se il venditore non ha ore quel giorno: testo `text-[11px] text-ash-500` "Nessuna ora dichiarata quel giorno: cambia giorno o venditore." Nel tab Esiti la `<select>` dei venditori (riga ~924-934) etichetta ogni opzione con ` · libero alle HH:00` oppure ` · non disponibile a quest'ora` in base all'ora dell'appuntamento del lead (se l'appuntamento non ha data, nessuna etichetta). La chiamata è debounced (300 ms) e ignora le risposte arrivate fuori ordine (contatore di richiesta). Nessun errore bloccante: se la chiamata fallisce le pastiglie semplicemente non compaiono.
- [ ] **Step 2 — M1 + M2 (`ForceBookingReason`)**: `autoFocus` sulla textarea; bottone "Fissa comunque" `disabled` finché `forceReasonProblem(reason)` (Task 5) ritorna un messaggio; sotto la textarea quel messaggio in `text-[10px] text-amber-700` quando il testo è non vuoto ma insufficiente.
- [ ] **Step 3 — M3**: in `ConfermeDrawer` riga ~215 sostituisci `alert("Dati salvati con successo")` con uno stato `saved` che mostra sotto il bottone `<div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">Dati salvati.</div>` per 3 secondi. I `window.confirm` esistenti (righe ~244, ~440, `ConfermeBoardRow` ~219) NON si toccano: sono flussi precedenti al calendario.
- [ ] **Step 4 — M4**: in `ConfermeBoardRow` rimuovi il blocco `<ForceBookingReason>` (righe ~487-493), lo stato `recallForceMessage` e il commento (righe ~38-42): `handleSaveRecall` passa sempre `newAppointmentDate: null`, quindi quel codice non può mai eseguire. Se tolto l'import resta inutilizzato, togli anche quello.
- [ ] **Step 5 — M5**: popover "Programma Richiamo" (`ConfermeBoardRow` ~442): aggiungi `max-h-[70vh] overflow-y-auto`.
- [ ] **Step 6 — `VenditoriAgendaModal`**:
  - A3: `bandStats` calcola anche `max`; la pastiglia mostra `count` se `count === max`, altrimenti `count–max` (en dash).
  - A4: sotto il numero, i primi due nomi `+N` in `text-[8px] font-medium leading-tight opacity-80 truncate` (i nomi sono già nel `title`: restano lì per il mouse, ma ora esistono anche in chiaro).
  - A5: in `AbsenceButton` la conferma vale solo se sono passati ≥700 ms dall'armamento (`armedAt` ref); un secondo click prima è ignorato.
  - A6: quando `decision.ok` è falso il bottone spento diventa un `<div>` non interattivo con `absenceRefusalMessage(decision.reason)` in `text-[9px] text-ash-500` (Chrome non mostra il `title` sui bottoni disabilitati); al successo mostra `Segnalata · {CALENDAR_PENALTY_EUR} €` in `bg-emerald-100 text-emerald-700` prima di chiamare `onSuccess()`.
  - M9: per le ragioni `finestra_scaduta` e `venditore_esente` (verifica i nomi veri in `calendarRules.ts`) non renderizzare nulla.
  - M6: `Escape` chiude la modale (listener `keydown` in un `useEffect`), e il click sul contenitore esterno (`e.target === e.currentTarget`) chiude.
  - M7: i bottoni ‹ › e "Oggi" hanno `disabled={loading}` + `disabled:opacity-50`.
  - M8: `weekCount` esclude gli appuntamenti con esito `scartato` (verifica il nome del campo/valore nel tipo restituito da `getVenditoriAgenda`); accanto, se ce ne sono, ` · N scart.` in `text-ash-400`.
  - M10: sopra la griglia, se `coverage.every(c => c.available.length === 0)`: `<div className="m-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Nessun venditore ha ancora dichiarato le ore di questa settimana. Ogni fissaggio qui chiederà un motivo.</div>`.
- [ ] **Step 7 — M12 (vocabolario)**: nelle sole stringhe visibili sostituisci "slot" con "ora": `VenditoriAgendaModal` (legenda: «Slot occupato (follow-up o imprevisto)» → «Ora occupata (follow-up o imprevisto)», «Slot vuoto» → «Ora libera, nessun appuntamento»), `CalendariVenditoriClient` («Assenza su slot» → «Assenza a un appuntamento», «Venditore × slot» → «Venditore × ore»), `calendarRules.ts` `absenceRefusalMessage` («Questo slot non era dichiarato disponibile» → «Quest'ora non era dichiarata disponibile», e simili). Aggiorna `calendarRules.test.ts` se asserisce quei testi. Identificatori, chiavi e commenti NON cambiano.
- [ ] **Step 8:** `npx tsc --noEmit`, `npm run build`, `npm test`, eslint sui file toccati. Commit:

```bash
git add src/components/VenditoriAgendaModal.tsx src/components/ForceBookingReason.tsx src/components/ConfermeDrawer.tsx src/components/ConfermeBoardRow.tsx "src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx" src/lib/venditore/calendarRules.ts src/lib/venditore/calendarRules.test.ts
git commit -m "feat(conferme): ore libere del venditore nel drawer, agenda più leggibile, segnalazione assenza senza doppio click"
```

---

### Task 8: Direzione — la risposta del lunedì in testa, regola visibile, nessun interruttore muto

Origine: audit UX 2026-09-13 (A7, M11, M13, M14, B1, B2, B3). Dopo il Task 6 (che tocca la scheda Compilazione).

**Files:**
- Modify: `src/app/(dashboard)/calendari-venditori/page.tsx` (passa `ruleState`)
- Modify: `src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx`

**Interfaces:**
- Consumes: `calendarRuleState(env)` da `calendarRules.ts` (server-side; guarda come lo usa `venditoriMonitorActions.ts:~173` e che forma ha il risultato).

- [ ] **Step 1 — A7**: `page.tsx` calcola `calendarRuleState(process.env)` (o la firma vera) e lo passa come prop `ruleState`; in `MulteTab`, sopra la tabella, se la regola non è attiva: striscia ambra `border-amber-300 bg-amber-50 text-amber-800 font-semibold` con «Regola sospesa dall'interruttore: nessuna multa viene registrata.» oppure «Regola non ancora attivata: finché manca la data di partenza non si registra nessuna multa.» (in base alla ragione esposta dal risultato); se attiva con data di partenza, una riga `text-xs text-ash-500` «Multe attive dal <data>».
- [ ] **Step 2 — M11**: sopra la tabella Compilazione un riepilogo: `n = compilation.filter(r => !r.submittedAtIso && !r.exempt).length` → `bg-rose-50 text-rose-800` «N venditori non hanno compilato questa settimana» (singolare/plurale) oppure `bg-emerald-50 text-emerald-800` «Hanno compilato tutti.»; se esistono righe con `slotCount === 0` (Task 6) aggiungi « · N a zero ore».
- [ ] **Step 3 — M13**: lo switch Esente riceve `aria-label` («Togli/Metti l'esenzione dal calendario a questo venditore») e `title` (stato attuale spiegato); attivare l'esenzione richiede un secondo passaggio inline (stesso pattern a due tempi di `VoidPenaltyControl`: «Esentare NOME? Non compila più e non prende multe.» [Conferma] [Annulla]); toglierla resta un click.
- [ ] **Step 4 — M14**: sopra la `<SlotGrid>` della scheda Copertura, se `coverage.every(c => c.available.length === 0)`: striscia ambra «Nessun venditore ha ancora dichiarato le ore di questa settimana.» con un bottone testuale `underline font-bold` «Vedi chi non ha compilato» → `setTab('compilazione')` (bottone figlio di un `<div>`, mai di `<span>`/`<p>`).
- [ ] **Step 5 — B1, B2, B3**: nel form di annullamento multa il bottone «Annulla» che annulla la multa diventa «Annulla multa» e quello che chiude «Chiudi»; «Conferma» è `disabled={pending || !reason.trim()}`; nella matrice Venditore × ore i quadratini passano a `h-2 w-2` con `gap-[1px]` e un `mr-1.5` ogni 13 celle (fine giornata).
- [ ] **Step 6:** `npx tsc --noEmit`, `npm run build`, `npm test`. Commit:

```bash
git add "src/app/(dashboard)/calendari-venditori/page.tsx" "src/app/(dashboard)/calendari-venditori/CalendariVenditoriClient.tsx"
git commit -m "feat(calendari-venditori): conteggio inadempienti in testa, stato della regola multe, esenzione con conferma"
```


## Addendum Task 5 (controller, dopo audit UX)

Vedi `.superpowers/sdd/.../task-5-brief.md` sezione "Aggiunta del controller": A2 (`freeHours` nel rifiuto del muro) e M1 (`forceReasonProblem`, motivo di forzatura ≥ 10 caratteri).
