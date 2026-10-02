# Lancio Web Dev — tre strade e tetto Conferme: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dopo il pulsante del webinar il bot porta il lead su tre strade (chiamata subito con 2 domande, mattina del 6 col venditore con prequalifica, Conferme con domande leggere e tetto 25 per ora riempiendo un giorno dopo l'altro), e tutte le risposte arrivano al sales nel CRM.

**Architecture:** il CRM resta l'unica fonte delle ore: nuove regole (`classifyAt` lun-sab 9-20 senza fine, kind `conferme`), conteggio sotto advisory lock per ora in `bookLancio`, `slots {from}` che cerca il primo giorno con posto. Il bot tiene in `conversations.lancio_info` il percorso in corso (`percorso`, `oraScelta`, `domande`) e passa al modello un prompt per percorso; il codice forza la prenotazione quando le domande sono finite. CRM per primo e retrocompatibile, bot dopo.

**Tech Stack:** CRM Next.js 14 + Drizzle + `node --test` (tsx); bot Next 16 + Supabase JS + Vitest (`bun run test`), entrambi TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-02-lancio-tre-strade-tetto-conferme-design.md` (estende `2026-09-14-lancio-webdev-ottobre-design.md`).

## Global Constraints

- Tetto Conferme: **25** appuntamenti del bot del lancio per ora (`LANCIO_CONFERME_CAP_ORA = 25`); contano solo `lancioScelta in ('app_pomeriggio','app_dopodomani','app_conferme')` del bucket lancio.
- Giorni Conferme: **lun-sab, ore tonde 9-20**, domenica mai, nessuna data di fine; il 6/10 9-14 è solo dei venditori (`mattina`), il 6/10 15-20 è `pomeriggio`.
- Anticipo minimo 1 ora (`MIN_LEAD_TIME_MS`, invariato).
- Testi verso il lead: **mai** "se ti convince", "se ti interessa", "eventualmente"; mai prezzi; la domanda sul pacchetto nomina solo Advance, Gold, Exclusive.
- Testo chiamata subito (verbatim): `Perfetto, ti faccio chiamare subito da ${nome}. È una chiamata breve per valutare insieme le ultime cose e fare l'iscrizione, così blocchi il tuo posto: sono limitati.`
- Testo Conferme (verbatim): `Fissato per ${giorno} alle ${ora}. Ti chiamerà Noemi per confermare e mandarti il link della videocall: rispondile!`
- Il lancio non passa MAI la chat a una persona; dopo le 03:00 del 6 il post-pitch va a Mario (regola PO 25/09, invariata).
- Nessun interruttore del lancio (`lancio_pulsante_attivo`, `lancio_attivo`, env `LANCIO_*`) viene toccato da codice, script o sessione.
- **Push/deploy solo con l'ok esplicito di Bruno** (push su `main` = produzione in entrambi i repo).
- Lavoro in worktree: CRM `C:\Users\bruno\Desktop\CRM-GDO-tre-strade` (branch `feat/lancio-tre-strade` da `main`); bot `C:\Users\bruno\Desktop\Software-Messaggistica-tre-strade` (branch `feat/lancio-tre-strade` da **`origin/main`**: il `main` locale del bot è 134 commit indietro).

## Review Focus

1. **Corsa sull'ultimo posto** (due lead chiedono la stessa ora con 24 occupati): passa uno solo, l'altro riceve `ora_esaurita` con ore nuove → test di concorrenza in Task 3.
2. **Lead che cambia idea a metà domande** ("anzi, alle 11"): l'ora nuova sostituisce `oraScelta`, le risposte restano, il percorso si ricalcola dal kind → test in Task 8.
3. **Mattina esaurita DOPO la prequalifica**: il bot non rifà le domande, propone le ore rimaste (anche Conferme) e prenota appena il lead sceglie → test in Task 8.
4. **Notte fra 00:00 e 03:00 del 6**: "domani" non deve indicare il 7; le etichette relative si calcolano dal giorno di Roma di `now` → test in Task 6.
5. **Il lead non risponde alle domande ma scrive "ok chiamami"**: dopo il massimo di turni nel percorso il codice prenota/chiama comunque, non resta in loop → test in Task 8.

---

## PARTE A — CRM (`C:\Users\bruno\Desktop\CRM-GDO-tre-strade`)

Setup (una volta, prima del Task 1):
```bash
cd "C:/Users/bruno/Desktop/CRM GDO" && git worktree add ../CRM-GDO-tre-strade -b feat/lancio-tre-strade main
cd ../CRM-GDO-tre-strade && npm ci
```
Test di un file: `node --import tsx --test src/lib/lancio/rules.test.ts`. Tutta la suite: `npm test`. Tipi: `npx tsc --noEmit`.

### Task 1: regole dell'ora e config

**Files:**
- Modify: `src/lib/lancio/config.ts` (tipo `LancioScelta`, nuove costanti)
- Modify: `src/lib/lancio/rules.ts` (`AtKind`, `classifyAt`, helper giorni)
- Modify: `src/db/schema.ts:171` (solo il commento di `lancioScelta`)
- Test: `src/lib/lancio/rules.test.ts`

**Interfaces:**
- Produces: `type AtKind = 'mattina' | 'pomeriggio' | 'dopodomani' | 'conferme'`; `LANCIO_CONFERME_CAP_ORA = 25`; `ORE_CONFERME = [9..20]`; `isDomenica(dateStr): boolean`; `giornoDopo(dateStr): string`; `oreConfermeDel(dateStr, cfg): number[]` (6/10 → 15-20, altri lun-sab → 9-20, domenica → []); `LancioScelta` include `'app_conferme'`.

- [ ] **Step 1: test che falliscono** — in `rules.test.ts` sostituire il test `'9-14 del 7/10 sono dopodomani, il pomeriggio del 7 no'` e la riga `'2026-10-08T10:00:00+02:00'` del test "fuori regole" con:

```ts
import { classifyAt, giornoDopo, hourKey, isDomenica, oreConfermeDel, sameInstant, slotDateKind } from './rules'

test('dal 7/10 in poi, lun-sab 9-20, va alle Conferme', () => {
    for (const iso of ['2026-10-07T09:00:00+02:00', '2026-10-07T15:00:00+02:00', '2026-10-08T20:00:00+02:00', '2026-10-10T10:00:00+02:00', '2026-10-19T11:00:00+02:00']) {
        const r = classifyAt(new Date(iso), SERA)
        assert.equal(r.ok && r.kind, 'conferme', iso)
    }
})

test('domenica, prima delle 9 e dopo le 20 sono fuori regole anche dopo il 7', () => {
    for (const iso of ['2026-10-11T10:00:00+02:00', '2026-10-08T08:00:00+02:00', '2026-10-08T21:00:00+02:00']) {
        assert.deepEqual(classifyAt(new Date(iso), SERA), { ok: false, motivo: 'fuori_regole' }, iso)
    }
})

test('il giorno della live non si prenota', () => {
    assert.deepEqual(classifyAt(new Date('2026-10-05T23:00:00+02:00'), new Date('2026-10-05T21:30:00+02:00')), { ok: false, motivo: 'fuori_regole' })
})

test('helper dei giorni', () => {
    assert.equal(isDomenica('2026-10-11'), true)
    assert.equal(isDomenica('2026-10-10'), false)
    assert.equal(giornoDopo('2026-10-31'), '2026-11-01')
    assert.deepEqual(oreConfermeDel('2026-10-06'), [15, 16, 17, 18, 19, 20])
    assert.deepEqual(oreConfermeDel('2026-10-07'), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    assert.deepEqual(oreConfermeDel('2026-10-11'), [])
    assert.deepEqual(oreConfermeDel('2026-10-05'), [])
})
```
Nel test "fuori regole" togliere `'2026-10-08T10:00:00+02:00'` dall'elenco (ora è valido).

- [ ] **Step 2:** `node --import tsx --test src/lib/lancio/rules.test.ts` → FAIL (`giornoDopo` non esportato, kind `dopodomani` invece di `conferme`).

- [ ] **Step 3: implementazione.** In `config.ts`:

```ts
export type LancioScelta = 'chiamata_subito' | 'app_mattina' | 'app_pomeriggio' | 'app_dopodomani' | 'app_conferme' | 'followup'

/** Tetto degli appuntamenti che il bot del lancio fissa alle Conferme in UNA ora (PO 02/10). */
export const LANCIO_CONFERME_CAP_ORA = 25
/** Ore tonde prenotabili alle Conferme nei giorni dopo il 6 (lun-sab). */
export const ORE_CONFERME = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
/** Orizzonte della ricerca del primo giorno con posto: oltre, il bot lascia nota. */
export const ORIZZONTE_GIORNI = 30
```
Le scelte che occupano i posti Conferme, in `config.ts`:
```ts
/** `app_dopodomani` non si scrive più ma i lead già prenotati restano dentro il tetto. */
export const SCELTE_CONFERME: LancioScelta[] = ['app_pomeriggio', 'app_dopodomani', 'app_conferme']
```
In `rules.ts` (aggiornare anche il commento in testa: "6/10 9-20, poi lun-sab 9-20 senza fine"):

```ts
import { LANCIO_WEBDEV, MIN_LEAD_TIME_MS, ORE_CONFERME, type LancioConfig } from './config'

export type AtKind = 'mattina' | 'pomeriggio' | 'dopodomani' | 'conferme'

/** Domenica per una data 'YYYY-MM-DD' (ancora a mezzogiorno UTC: immune dalla DST). */
export function isDomenica(dateStr: string): boolean {
    return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 0
}

export function giornoDopo(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
}

/** Ore Conferme di una data: il 6 solo il pomeriggio, dal 7 lun-sab 9-20, prima del 6 e la domenica nessuna. */
export function oreConfermeDel(dateStr: string, cfg: LancioConfig = LANCIO_WEBDEV): number[] {
    if (dateStr < cfg.giornoDopo || isDomenica(dateStr)) return []
    if (dateStr === cfg.giornoDopo) return [...cfg.orePomeriggio]
    return [...ORE_CONFERME]
}

export function classifyAt(at: Date, now: Date, cfg: LancioConfig = LANCIO_WEBDEV): AtDecision {
    if (!(at instanceof Date) || isNaN(at.getTime())) return FUORI
    if (at.getTime() < now.getTime() + MIN_LEAD_TIME_MS) return FUORI
    const dateStr = toRomeDateStr(at)
    const hour = romeHour(at)
    if (romeInstant(dateStr, hour).getTime() !== at.getTime()) return FUORI
    if (dateStr === cfg.giornoDopo && cfg.oreVenditori.includes(hour)) return { ok: true, kind: 'mattina', dateStr, hour }
    if (!oreConfermeDel(dateStr, cfg).includes(hour)) return FUORI
    return { ok: true, kind: dateStr === cfg.giornoDopo ? 'pomeriggio' : 'conferme', dateStr, hour }
}
```
`slotDateKind` resta com'è (lo usa ancora `computeSlots` per il formato vecchio). In `schema.ts:171` aggiungere `'app_conferme'` al commento.

- [ ] **Step 4:** stesso comando → PASS. Poi `npx tsc --noEmit`: gli errori su `SCELTA_BY_KIND`/`KIND_BY_SCELTA` (`Record<AtKind,…>` incompleto) in `booking.ts` si sistemano nel Task 3; per ora aggiungere solo `conferme: 'app_conferme'` a `SCELTA_BY_KIND` e `app_conferme: 'conferme'` a `KIND_BY_SCELTA` e `'app_conferme'` al tipo `SceltaApp`, così il typecheck passa.

- [ ] **Step 5: commit** `git commit -am "feat(lancio): dal 7/10 si prenota alle Conferme lun-sab 9-20, senza data di fine"`

### Task 2: ore Conferme con il tetto e ricerca del primo giorno libero

**Files:**
- Modify: `src/lib/lancio/slots.ts` (funzione pura `confermeOre`)
- Modify: `src/lib/lancio/shiftQueries.ts` (query `confermeOccupati`)
- Modify: `src/lib/lancio/botGuard.ts` (`computeSlots` applica il tetto al pomeriggio; nuova `cercaProssimi`)
- Modify: `src/app/api/bot/lancio/slots/route.ts` (input `{from}`)
- Test: `src/lib/lancio/slots.test.ts`, `src/lib/lancio/botGuard.test.ts`

**Interfaces:**
- Consumes: `oreConfermeDel`, `giornoDopo`, `LANCIO_CONFERME_CAP_ORA`, `SCELTE_CONFERME`, `ORIZZONTE_GIORNI` (Task 1).
- Produces:
  - `confermeOre(input: { dateStr: string; hours: number[]; occupati: Map<number, number>; cap: number; now: Date }): Array<{ hour: number; liberi: number }>` — solo ore prenotabili per anticipo e con `liberi > 0`.
  - `confermeOccupati(tx: Db, dateStr: string, opts?: { excludeLeadId?: string; cfg?: LancioConfig }): Promise<Map<number, number>>` — ora di Roma → numero di appuntamenti.
  - `type ProssimiResponse = { mattina: { date: string; ore: Array<{ hour: number; liberi: number }> } | null; conferme: { date: string; ore: Array<{ hour: number; liberi: number }> } | null; saltati: string[] }`
  - `cercaProssimi(from: string, now: Date, cfg?: LancioConfig, tx?: Db): Promise<ProssimiResponse>`

- [ ] **Step 1: test puri che falliscono** in `slots.test.ts`:

```ts
import { confermeOre } from './slots'

test('confermeOre: 25 meno gli occupati, ore piene e passate escluse', () => {
    const now = new Date('2026-10-06T14:10:00+02:00')
    const occupati = new Map([[15, 25], [16, 24], [17, 3]])
    const ore = confermeOre({ dateStr: '2026-10-06', hours: [15, 16, 17, 18], occupati, cap: 25, now })
    // 15 piena; 16 con 1 posto; 17 con 22; 18 con 25. Le 15 sarebbero anche sotto l'ora di anticipo.
    assert.deepEqual(ore, [{ hour: 16, liberi: 1 }, { hour: 17, liberi: 22 }, { hour: 18, liberi: 25 }])
})

test('confermeOre: oltre il tetto (dati vecchi) non va mai sotto zero', () => {
    const ore = confermeOre({ dateStr: '2026-10-08', hours: [9], occupati: new Map([[9, 30]]), cap: 25, now: new Date('2026-10-05T22:00:00+02:00') })
    assert.deepEqual(ore, [])
})
```

- [ ] **Step 2:** `node --import tsx --test src/lib/lancio/slots.test.ts` → FAIL (`confermeOre` non esiste).

- [ ] **Step 3: implementazione pura** in `slots.ts`:

```ts
/**
 * Ore Conferme ancora prenotabili: preavviso (`orePrenotabili`, la stessa soglia di
 * `classifyAt`) e tetto per ora. Pura: gli occupati li legge `confermeOccupati`.
 */
export function confermeOre(input: {
    dateStr: string; hours: number[]; occupati: Map<number, number>; cap: number; now: Date
}): Array<{ hour: number; liberi: number }> {
    return orePrenotabili(input.dateStr, input.hours, input.now)
        .map(hour => ({ hour, liberi: Math.max(0, input.cap - (input.occupati.get(hour) ?? 0)) }))
        .filter(o => o.liberi > 0)
}
```

- [ ] **Step 4:** test → PASS.

- [ ] **Step 5: query** in `shiftQueries.ts` (stesso stile delle altre letture del modulo; `romeInstant` per i bordi del giorno, `romeHour` per raggruppare):

```ts
import { inArray, gte, lt, ne } from 'drizzle-orm'
import { romeHour, romeInstant } from '@/lib/venditore/calendarSlots'
import { giornoDopo } from './rules'
import { SCELTE_CONFERME } from './config'

/** Appuntamenti del bot del lancio alle Conferme in quel giorno di Roma, per ora. */
export async function confermeOccupati(tx: Db, dateStr: string, opts: { excludeLeadId?: string; cfg?: LancioConfig } = {}): Promise<Map<number, number>> {
    const cfg = opts.cfg ?? LANCIO_WEBDEV
    const rows = await tx.select({ at: leads.appointmentDate }).from(leads).where(and(
        eq(leads.companyId, FENICE_COMPANY), eq(leads.launchBucket, cfg.bucket), eq(leads.status, 'APPOINTMENT'),
        inArray(leads.lancioScelta, SCELTE_CONFERME),
        gte(leads.appointmentDate, romeInstant(dateStr, 0)),
        lt(leads.appointmentDate, romeInstant(giornoDopo(dateStr), 0)),
        ...(opts.excludeLeadId ? [ne(leads.id, opts.excludeLeadId)] : []),
    ))
    const out = new Map<number, number>()
    for (const r of rows) if (r.at) out.set(romeHour(r.at), (out.get(romeHour(r.at)) ?? 0) + 1)
    return out
}
```
(Usare la costante company già importata nel modulo; se non c'è, importare `LANCIO_COMPANY` da `./config`. Verificare che `romeInstant(dateStr, 0)` accetti l'ora 0; se il suo dominio è 9-21, usare `new Date(\`${dateStr}T00:00:00${offset}\`)` con l'helper di offset di `dateUtils`.)

- [ ] **Step 6: `computeSlots` e `cercaProssimi`** in `botGuard.ts`. In `computeSlots` (formato vecchio, bot di oggi) il pomeriggio passa dal tetto:

```ts
    const occupati = await confermeOccupati(db, dateStr, { cfg })
    const orePomeriggio = confermeOre({ dateStr, hours: cfg.orePomeriggio, occupati, cap: LANCIO_CONFERME_CAP_ORA, now }).map(o => o.hour)
```
e nel ramo `dopodomani` `oreAmmesse` diventa `confermeOre({ dateStr, hours: cfg.oreVenditori, occupati: await confermeOccupati(db, dateStr, { cfg }), cap: LANCIO_CONFERME_CAP_ORA, now }).map(o => o.hour)`.

Nuova funzione:

```ts
export interface ProssimiResponse {
    mattina: { date: string; ore: Array<{ hour: number; liberi: number }> } | null
    conferme: { date: string; ore: Array<{ hour: number; liberi: number }> } | null
    /** Giorni lun-sab saltati perché pieni: il bot dice "siamo pieni". */
    saltati: string[]
}

/**
 * Il primo giorno ≥ from con posto alle Conferme, più la mattina del 6 coi venditori se
 * `from` non la supera. La domenica si salta senza contarla fra i pieni.
 */
export async function cercaProssimi(from: string, now: Date, cfg: LancioConfig = LANCIO_WEBDEV, tx: Db = db): Promise<ProssimiResponse> {
    let mattina: ProssimiResponse['mattina'] = null
    if (from <= cfg.giornoDopo) {
        const members = await getShiftMembers(tx, 'GIORNO_DOPO', cfg)
        const facts = await dayFactsFor(tx, members, cfg.giornoDopo, { cfg })
        const m = mattinaSlots({ dateStr: cfg.giornoDopo, hours: cfg.oreVenditori, venditori: facts, now })
        const ore = m.mattina.filter(o => o.liberi > 0).map(o => ({ hour: o.hour, liberi: o.liberi }))
        if (ore.length > 0) mattina = { date: cfg.giornoDopo, ore }
    }
    const saltati: string[] = []
    let d = from < cfg.giornoDopo ? cfg.giornoDopo : from
    for (let i = 0; i < ORIZZONTE_GIORNI; i++, d = giornoDopo(d)) {
        const hours = oreConfermeDel(d, cfg)
        if (hours.length === 0) continue
        const ore = confermeOre({ dateStr: d, hours, occupati: await confermeOccupati(tx, d, { cfg }), cap: LANCIO_CONFERME_CAP_ORA, now })
        if (ore.length > 0) return { mattina, conferme: { date: d, ore }, saltati }
        // Un giorno passato per anticipo (oggi alle 20:30) non è "pieno": non si dice al lead.
        if (orePrenotabili(d, hours, now).length > 0) saltati.push(d)
    }
    return { mattina, conferme: null, saltati }
}
```

- [ ] **Step 7: route** `slots/route.ts`: se il body ha `from` (`YYYY-MM-DD`) risponde `{ ok: true, ...await cercaProssimi(from, new Date()) }`; altrimenti il comportamento di oggi con `date`. Aggiornare il commento JSDoc della route con i due formati.

- [ ] **Step 8: test della forma** in `botGuard.test.ts`, se il file testa già funzioni pure; `cercaProssimi` legge il DB e non ha test unitari: la si verifica nel Task 3 (smoke) e nella prova dal vivo. Eseguire `npm test` e `npx tsc --noEmit` → verdi.

- [ ] **Step 9: commit** `git commit -am "feat(lancio): ore Conferme col tetto di 25 e ricerca del primo giorno con posto"`

### Task 3: tetto in `book`, risposte fino a 12, 409 con le ore nuove

**Files:**
- Modify: `src/lib/lancio/booking.ts` (ramo non-mattina sotto lock con conteggio)
- Modify: `src/lib/lancio/payload.ts` (`MAX_RISPOSTE = 12`)
- Modify: `src/app/api/bot/lancio/book/route.ts` (409 `ora_esaurita` anche per Conferme, con `prossimi`)
- Test: `src/lib/lancio/booking.test.ts`, `src/lib/lancio/payload.test.ts`

**Interfaces:**
- Consumes: `confermeOccupati`, `cercaProssimi`, `LANCIO_CONFERME_CAP_ORA` (Task 1-2).
- Produces: `BookOutcome` ok-kind include `'conferme'`; nuova funzione pura `postoConferme(occupati: number, cap: number): boolean`; 409 `{ ok:false, motivo:'ora_esaurita', slots, prossimi }` dove `slots` è il formato vecchio (`computeSlots(dateStr)`, può essere `null` fuori dal 6/7) e `prossimi` è `ProssimiResponse` da `cercaProssimi(dateStr)`.

- [ ] **Step 1: test che falliscono**

`booking.test.ts`:
```ts
import { SCELTA_BY_KIND, decideBooking, postoConferme } from './booking'

test('SCELTA_BY_KIND: le Conferme dopo il 6 sono app_conferme', () => {
    assert.equal(SCELTA_BY_KIND.conferme, 'app_conferme')
})

test('postoConferme: 24 occupati lascia passare, 25 no', () => {
    assert.equal(postoConferme(24, 25), true)
    assert.equal(postoConferme(25, 25), false)
    assert.equal(postoConferme(30, 25), false)
})

test('decideBooking: chi ha già app_conferme riceve gia_prenotato col kind conferme', () => {
    const d = decideBooking({ lancioScelta: 'app_conferme', appointmentDate: new Date('2026-10-08T10:00:00+02:00') }, 'conferme', new Date('2026-10-08T11:00:00+02:00'))
    assert.equal(d.azione === 'gia_prenotato' && d.kind, 'conferme')
})
```
`payload.test.ts`:
```ts
test('accetta fino a 12 risposte', () => {
    const r = parseInfo({ risposte: Array.from({ length: 14 }, (_, i) => `r${i}`) })
    assert.equal(r.ok && r.info?.risposte?.length, 12)
})
```

- [ ] **Step 2:** `node --import tsx --test src/lib/lancio/booking.test.ts src/lib/lancio/payload.test.ts` → FAIL.

- [ ] **Step 3: implementazione.** `payload.ts`: `MAX_RISPOSTE = 12` (commento: "prequalifica: scelta + ora + 3 domande, con margine"). In `payload.ts` tenere le ULTIME 12 (`.slice(-MAX_RISPOSTE)`), non le prime: le domande della prequalifica arrivano in fondo.

`booking.ts`:
```ts
/** C'è ancora posto in quell'ora alle Conferme? */
export function postoConferme(occupati: number, cap: number): boolean {
    return occupati < cap
}
```
Tipo `BookOutcome`: `| { ok: true; kind: 'pomeriggio' | 'dopodomani' | 'conferme'; deduped?: true }`. Nel ramo `if (input.kind !== 'mattina')`, dentro la transazione e PRIMA dell'update:

```ts
            // Tetto 25/ora (PO 02/10): lock per ORA come la mattina, seed 3, chiave distinta
            // (`lancio:conferme:`) così mattina e Conferme della stessa ora non si bloccano a vicenda.
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'lancio:conferme:' + hourKey(input.dateStr, input.hour)}, 3))`)
            const occupati = (await confermeOccupati(tx, input.dateStr, { excludeLeadId: lead.id, cfg })).get(input.hour) ?? 0
            if (!postoConferme(occupati, LANCIO_CONFERME_CAP_ORA)) return { ok: false as const, motivo: 'ora_esaurita' as const }
```
Aggiornare il commento del ramo ("niente advisory lock" non è più vero) e il tipo di ritorno della transazione. Il resto (reset Conferme, eventi, notifica fuori transazione) invariato; la notifica parte solo se `esito.ok`.

`book/route.ts`, ramo finale `ora_esaurita`:
```ts
        const [slots, prossimi] = await Promise.all([computeSlots(decision.dateStr, now), cercaProssimi(decision.dateStr, now)])
        return NextResponse.json({ ok: false, motivo: 'ora_esaurita', slots, prossimi }, { status: 409 })
```
e aggiornare il JSDoc in testa (`409 ora_esaurita (+slots, +prossimi)`).

- [ ] **Step 4:** test → PASS; `npm test` e `npx tsc --noEmit` verdi.

- [ ] **Step 5: prova di concorrenza contro il DB vero, in sola lettura del risultato.** Non si scrive su lead veri. Verifica manuale con la query: `select hashtextextended('lancio:conferme:2026-10-08@10', 3)` funziona (Supabase MCP `execute_sql`, progetto `ncutwzsifzundikwllxp`). La corsa vera la copre il lock + il conteggio dentro la stessa transazione: annotare nel report del task il ragionamento (stessa forma del lock mattina già in prod).

- [ ] **Step 6: commit** `git commit -am "feat(lancio): tetto di 25 per ora sulle prenotazioni alle Conferme"`

### Task 4: Conferme, restituzioni, monitor, drawer venditore, contratto

**Files:**
- Modify: `src/lib/lancio/conferme.ts` (`lancioPriority`, `lancioSceltaLabel`)
- Modify: `src/lib/bot-fissatore/lancioReturnRules.ts` (commento + `app_conferme` = scelta fatta, se la regola elenca le scelte)
- Modify: `src/lib/lancio/monitor.ts` (`prenotati.conferme`) e `src/app/(dashboard)/lancio/LancioClient.tsx` (mostrarlo)
- Create: `src/components/lancio/LancioBotInfoCard.tsx` (estratto da `ConfermeDrawer.tsx:992-1021`)
- Modify: `src/components/ConfermeDrawer.tsx` (usa la card), `src/components/VenditoreDrawer.tsx` (mostra la card sopra "Note Precedenti", riga ~410)
- Modify: `docs/bot-fissatore-contract.md` (Direzione 6 → v1.8)
- Test: `src/lib/lancio/conferme.test.ts`, `src/lib/bot-fissatore/lancioReturnRules.test.ts`

**Interfaces:**
- Consumes: `LancioScelta` con `'app_conferme'` (Task 1).
- Produces: `<LancioBotInfoCard lead={lead} />` dove `lead` ha `launchBucket, status, lancioScelta, lancioSceltaAt, lancioBotInfo, lancioCallNowAttempts, salespersonUserId, salespersonAssigned, confirmationsOutcome`.

- [ ] **Step 1: test che falliscono** in `conferme.test.ts`:
```ts
test('app_conferme va in cima e ha la sua etichetta', () => {
    assert.equal(lancioPriority(lead({ lancioScelta: 'app_conferme' })), 1)
    assert.match(lancioSceltaLabel('app_conferme'), /scelto in chat col bot/i)
})
```
e in `lancioReturnRules.test.ts`:
```ts
assert.deepEqual(checkLancioReturnToPool(base({ lancioScelta: 'app_conferme' })), { ok: false, reason: 'scelta_fatta' });
```

- [ ] **Step 2:** `node --import tsx --test src/lib/lancio/conferme.test.ts src/lib/bot-fissatore/lancioReturnRules.test.ts` → FAIL sul primo (il secondo può già passare se la regola guarda `lancioScelta is not null`: in quel caso lasciarlo come test di regressione).

- [ ] **Step 3: implementazione.** `conferme.ts`: in `lancioPriority` la condizione diventa `['app_pomeriggio', 'app_dopodomani', 'app_conferme'].includes(lead.lancioScelta ?? '')`; in `lancioSceltaLabel` aggiungere `case 'app_conferme': return 'Appuntamento alle Conferme, scelto in chat col bot'`. `lancioReturnRules.ts`: aggiornare il commento a riga 47 con `app_conferme`. `monitor.ts`: `conferme: sql<number>\`count(*) filter (where ${leads.lancioScelta} = 'app_conferme')::int\`` e `prenotati: { …, conferme: c?.conferme ?? 0 }` (aggiornare l'interfaccia); in `LancioClient.tsx` aggiungere la voce "Conferme (altri giorni)" accanto a mattina/pomeriggio/dopodomani, stesso markup delle voci vicine.

`LancioBotInfoCard.tsx` (`"use client"` non serve se non ha stato; importa `format` da date-fns, `Rocket` da lucide-react, le tre funzioni da `@/lib/lancio/conferme`): il JSX è esattamente il blocco di `ConfermeDrawer.tsx` righe 992-1021 (la IIFE diventa il corpo del componente, `return null` se `!isLeadLancio(lead)`). In `ConfermeDrawer.tsx` sostituire la IIFE con `<LancioBotInfoCard lead={lead} />`. In `VenditoreDrawer.tsx`, subito prima del blocco `{(lead?.appointmentNote) && (`, aggiungere:
```tsx
                    {lead && (
                        <div className="mt-4">
                            <LancioBotInfoCard lead={lead} />
                        </div>
                    )}
```
Verificare che i lead passati a `VenditoreDrawer` (da `VenditoreDashboardClient` e `OutcomeGate`) arrivino da una select che include `lancioBotInfo`, `lancioScelta`, `lancioSceltaAt`, `launchBucket`, `lancioCallNowAttempts`: se la select è esplicita, aggiungere le colonne mancanti nella server action che la alimenta.

Contratto `docs/bot-fissatore-contract.md`, Direzione 6: versione **v1.8**, con `slots {from}` → `ProssimiResponse`, kind `conferme`, `lancioScelta='app_conferme'`, `ora_esaurita` anche su pomeriggio/conferme con `prossimi`, `info.risposte` fino a 12 (si tengono le ultime).

- [ ] **Step 4:** test → PASS; `npm test`, `npx tsc --noEmit`, `npm run build` verdi.

- [ ] **Step 5: commit** `git commit -am "feat(lancio): app_conferme in board e monitor, risposte del bot nel drawer venditore, contratto v1.8"`

---

## PARTE B — bot (`C:\Users\bruno\Desktop\Software-Messaggistica-tre-strade`)

Setup (una volta, prima del Task 5):
```bash
cd "C:/Users/bruno/Desktop/Software Messaggistica" && git fetch origin && git worktree add ../Software-Messaggistica-tre-strade -b feat/lancio-tre-strade origin/main
cd ../Software-Messaggistica-tre-strade && bun install
```
Regola del repo (AGENTS.md): leggere `node_modules/next/dist/docs/` prima di toccare route Next. Test di un file: `bun run test lib/lancio-scelta.test.ts`. Tutto: `bun run test` e `bun run typecheck`.

### Task 5: client CRM — `slots {from}`, kind `conferme`, `prossimi` nel 409

**Files:**
- Modify: `lib/lancio-crm.ts`
- Test: `lib/lancio-crm.test.ts`

**Interfaces:**
- Produces:
  - `type LancioKind = 'mattina' | 'pomeriggio' | 'dopodomani' | 'conferme'`
  - `type LancioOreGiorno = { date: string; ore: { hour: number; liberi: number }[] }`
  - `type LancioProssimi = { mattina: LancioOreGiorno | null; conferme: LancioOreGiorno | null; saltati: string[] }`
  - `lancioProssimi(from: string): Promise<{ ok: true; prossimi: LancioProssimi } | LancioCrmErrore>` (POST `slots` con `{ from }`)
  - l'errore `ora_esaurita` diventa `{ ok: false; motivo: 'ora_esaurita'; slots: LancioSlots | null; prossimi: LancioProssimi | null }`
  - `type LancioInfo = { risposte: string[]; slotsMostratiAt?: string | null; percorso?: 'chiamata' | 'mattina' | 'conferme' | null; oraScelta?: string | null; domande?: number }` (i campi in più restano nel DB del bot; al CRM si manda solo `{ risposte }`, come oggi)

- [ ] **Step 1: test che falliscono** in `lancio-crm.test.ts`, nello stesso stile dei test esistenti sul `fetch` simulato (copiare il setup del test di `lancioSlots`):
```ts
it('lancioProssimi legge mattina, conferme e saltati', async () => {
  mockFetchJson(200, { ok: true, mattina: { date: '2026-10-06', ore: [{ hour: 9, liberi: 2 }] }, conferme: { date: '2026-10-07', ore: [{ hour: 10, liberi: 25 }] }, saltati: ['2026-10-06'] });
  const r = await lancioProssimi('2026-10-06');
  expect(r).toEqual({ ok: true, prossimi: { mattina: { date: '2026-10-06', ore: [{ hour: 9, liberi: 2 }] }, conferme: { date: '2026-10-07', ore: [{ hour: 10, liberi: 25 }] }, saltati: ['2026-10-06'] } });
  expect(lastFetchBody()).toEqual({ from: '2026-10-06' });
});
it('ora_esaurita porta anche prossimi', async () => {
  mockFetchJson(409, { ok: false, motivo: 'ora_esaurita', slots: null, prossimi: { mattina: null, conferme: { date: '2026-10-08', ore: [{ hour: 11, liberi: 3 }] }, saltati: [] } });
  const r = await lancioBook({ leadId: 'l1', at: '2026-10-07T10:00:00+02:00' });
  expect(r).toMatchObject({ ok: false, motivo: 'ora_esaurita', prossimi: { conferme: { date: '2026-10-08' } } });
});
it('book ok con kind conferme', async () => {
  mockFetchJson(200, { ok: true, kind: 'conferme' });
  expect(await lancioBook({ leadId: 'l1', at: '2026-10-08T10:00:00+02:00' })).toEqual({ ok: true, kind: 'conferme' });
});
```
(`mockFetchJson`/`lastFetchBody`: usare gli helper che il file ha già; se hanno nomi diversi, adeguare i nomi, non la sostanza.)

- [ ] **Step 2:** `bun run test lib/lancio-crm.test.ts` → FAIL.

- [ ] **Step 3: implementazione.** `leggiKind` accetta `'conferme'`. Nuovo parser:
```ts
function leggiOreGiorno(raw: unknown): LancioOreGiorno | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.date !== 'string' || !Array.isArray(o.ore)) return null;
  const ore = o.ore
    .filter((s): s is { hour: number; liberi?: unknown } => !!s && typeof s === 'object' && typeof (s as { hour?: unknown }).hour === 'number')
    .map((s) => ({ hour: s.hour, liberi: typeof s.liberi === 'number' ? s.liberi : 0 }))
    .filter((s) => s.liberi > 0);
  return ore.length > 0 ? { date: o.date, ore } : null;
}

function leggiProssimi(raw: unknown): LancioProssimi | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    mattina: leggiOreGiorno(o.mattina),
    conferme: leggiOreGiorno(o.conferme),
    saltati: Array.isArray(o.saltati) ? o.saltati.filter((d): d is string => typeof d === 'string') : [],
  };
}

export async function lancioProssimi(from: string): Promise<{ ok: true; prossimi: LancioProssimi } | LancioCrmErrore> {
  return chiamaLancio('slots', { from }, { from }, (g) => {
    const err = erroreDaStatus(g);
    if (err) return err;
    const prossimi = leggiProssimi(g.json);
    return prossimi ? { ok: true as const, prossimi } : httpErrore(g);
  });
}
```
Dove si costruisce `ora_esaurita` (in `erroreDaStatus` o nel parser di `book`) aggiungere `prossimi: leggiProssimi(g.json?.prossimi)`.

- [ ] **Step 4:** test → PASS; `bun run typecheck` (gli usi di `ora_esaurita` in `lancio-post-pitch.ts` compilano: il campo è in più).

- [ ] **Step 5: commit** `git commit -am "feat(lancio-crm): slots {from}, kind conferme e prossimi nel 409"`

### Task 6: regole, ore e testi fissi delle tre strade (puro)

**Files:**
- Modify: `lib/lancio-scelta.ts`
- Test: `lib/lancio-scelta.test.ts`

**Interfaces:**
- Consumes: `LancioProssimi`, `LancioInfo`, `LancioKind` (Task 5).
- Produces:
  - `validaAtLancio(at, now, eventoAt)`: il 6 9-14 `mattina`, il 6 15-20 `pomeriggio`, dal 7 lun-sab 9-20 `conferme`, domenica/giorno della live/altro → `giorno_non_ammesso`, fuori 9-20 → `fuori_fascia`.
  - `type OreTreStrade = { mattina: { date: string; ore: number[] } | null; conferme: { date: string; ore: number[] } | null; saltati: string[] }`
  - `oreDaProssimi(p: LancioProssimi | null, now: Date): OreTreStrade` (filtra di nuovo l'anticipo di 1 ora; `null` → tutto `null`)
  - `etichettaRelativa(date: string, now: Date): string` → `'oggi'` | `'domani'` | `'mercoledì 7 ottobre'`
  - `testoOreTreStrade(o: OreTreStrade, now: Date): string`
  - `bloccoOrePerPrompt(o: OreTreStrade, now: Date): string`
  - `DOMANDE_PER_PERCORSO = { chiamata: 2, mattina: 3, conferme: 3 } as const`
  - `testoConfermaChiamata(nome)` (testo nuovo, verbatim Global Constraints)
  - `testoConfermaPrenotazione(kind, at, nome?)`: `mattina` invariato; `pomeriggio`/`dopodomani`/`conferme` → testo Conferme verbatim (Global Constraints) con `giorno = etichettaRelativa(...)` e `ora = "H:00"`
  - `TESTO_INTRO_PREQUALIFICA = 'Visto che i posti sono limitati, prima della videocall ti faccio un paio di domande per capire se il percorso è in linea con te.'`
  - `FRASI_VIETATE = [/se ti convince/i, /se ti interessa/i, /eventualmente/i]`
  - `MAX_RISPOSTE = 12`

- [ ] **Step 1: test che falliscono** in `lancio-scelta.test.ts` (evento `2026-10-05T21:00:00+02:00`, `NOTTE = 2026-10-05T22:30+02:00`, `DOPO_MEZZANOTTE = 2026-10-06T01:00+02:00`):
```ts
describe('tre strade', () => {
  const EV = new Date('2026-10-05T21:00:00+02:00');
  const NOTTE = new Date('2026-10-05T22:30:00+02:00');
  const DOPO_MEZZANOTTE = new Date('2026-10-06T01:00:00+02:00');

  it('validaAtLancio: dal 7 lun-sab 9-20 alle Conferme, domenica no', () => {
    expect(validaAtLancio('2026-10-06T10:00:00+02:00', NOTTE, EV)).toMatchObject({ ok: true, kind: 'mattina' });
    expect(validaAtLancio('2026-10-06T16:00:00+02:00', NOTTE, EV)).toMatchObject({ ok: true, kind: 'pomeriggio' });
    expect(validaAtLancio('2026-10-07T17:00:00+02:00', NOTTE, EV)).toMatchObject({ ok: true, kind: 'conferme' });
    expect(validaAtLancio('2026-10-10T09:00:00+02:00', NOTTE, EV)).toMatchObject({ ok: true, kind: 'conferme' });
    expect(validaAtLancio('2026-10-11T10:00:00+02:00', NOTTE, EV)).toEqual({ ok: false, motivo: 'giorno_non_ammesso' });
    expect(validaAtLancio('2026-10-08T21:00:00+02:00', NOTTE, EV)).toEqual({ ok: false, motivo: 'fuori_fascia' });
  });

  it('etichettaRelativa dopo mezzanotte: il 6 è oggi, il 7 è domani', () => {
    expect(etichettaRelativa('2026-10-06', NOTTE)).toBe('domani');
    expect(etichettaRelativa('2026-10-06', DOPO_MEZZANOTTE)).toBe('oggi');
    expect(etichettaRelativa('2026-10-07', DOPO_MEZZANOTTE)).toBe('domani');
    expect(etichettaRelativa('2026-10-08', NOTTE)).toBe('giovedì 8 ottobre');
  });

  it('testoOreTreStrade: mattina venditori + giorno Conferme, e dice pieno sui saltati', () => {
    const o = { mattina: { date: '2026-10-06', ore: [9, 10] }, conferme: { date: '2026-10-07', ore: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] }, saltati: ['2026-10-06'] };
    const t = testoOreTreStrade(o, NOTTE);
    expect(t).toContain('domattina alle 9 o alle 10');
    expect(t).toMatch(/domani pomeriggio siamo pieni/i);
    expect(t).toContain('mercoledì 7 ottobre dalle 9 alle 20');
    expect(t).toMatch(/a che ora ci saresti\?$/);
  });

  it('nessun testo fisso contiene frasi vietate', () => {
    const testi = [
      testoConfermaChiamata('Marco'), TESTO_INTRO_PREQUALIFICA,
      testoConfermaPrenotazione('conferme', '2026-10-07T10:00:00+02:00'),
      testoConfermaPrenotazione('mattina', '2026-10-06T10:00:00+02:00', 'Marco'),
    ];
    for (const t of testi) for (const re of FRASI_VIETATE) expect(t).not.toMatch(re);
  });

  it('testi verbatim', () => {
    expect(testoConfermaChiamata('Marco')).toBe("Perfetto, ti faccio chiamare subito da Marco. È una chiamata breve per valutare insieme le ultime cose e fare l'iscrizione, così blocchi il tuo posto: sono limitati.");
    expect(testoConfermaPrenotazione('conferme', '2026-10-08T10:00:00+02:00')).toBe('Fissato per giovedì 8 ottobre alle 10:00. Ti chiamerà Noemi per confermare e mandarti il link della videocall: rispondile!');
  });
});
```
Il test `testoConfermaPrenotazione('conferme', …)` usa `etichettaGiorno` (assoluta), non `etichettaRelativa`: "Fissato per giovedì 8 ottobre" è più chiaro di "domani" in un messaggio che il lead rilegge il giorno dopo.

- [ ] **Step 2:** `bun run test lib/lancio-scelta.test.ts` → FAIL.

- [ ] **Step 3: implementazione.**

`validaAtLancio` (sostituisce il controllo dei due giorni e delle due fasce):
```ts
const FASCIA_CONFERME = { da: 9, a: 20 };
const domenica = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;

export function validaAtLancio(at: string, now: Date, eventoAt: Date): ValidazioneAt {
  if (!isoWithOffset(at)) return { ok: false, motivo: 'formato' };
  const ms = Date.parse(at);
  const d = new Date(ms);
  const g = giorniLancio(eventoAt);
  const date = romeDayKey(d);
  // Dal giorno dopo la live in poi, lun-sab, senza data di fine (PO 02/10).
  if (date < g.giornoDopo || domenica(date)) return { ok: false, motivo: 'giorno_non_ammesso' };
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0) return { ok: false, motivo: 'ora_non_tonda' };
  const hour = romeHour(d);
  if (hour < FASCIA_CONFERME.da || hour > FASCIA_CONFERME.a) return { ok: false, motivo: 'fuori_fascia' };
  if (ms < now.getTime() + ANTICIPO_MINIMO_MS) return { ok: false, motivo: 'troppo_vicino' };
  const kind: LancioKind = date === g.giornoDopo ? (hour < PRIMA_ORA_POMERIGGIO ? 'mattina' : 'pomeriggio') : 'conferme';
  return { ok: true, kind, date, hour };
}
```
`FASCIA_GIORNO_DOPO`/`FASCIA_DOPODOMANI` restano solo se usate da `oreProponibili` (vecchio percorso: si rimuove nel Task 8 quando nessuno lo chiama più; qui non toccarlo).

Ore e testi:
```ts
export type OreTreStrade = { mattina: { date: string; ore: number[] } | null; conferme: { date: string; ore: number[] } | null; saltati: string[] };

export function oreDaProssimi(p: LancioProssimi | null, now: Date): OreTreStrade {
  if (!p) return { mattina: null, conferme: null, saltati: [] };
  const avanti = (date: string, h: number) => Date.parse(atIso(date, h)) >= now.getTime() + ANTICIPO_MINIMO_MS;
  const giorno = (x: LancioOreGiorno | null) => {
    if (!x) return null;
    const ore = [...new Set(x.ore.filter((o) => o.liberi > 0).map((o) => o.hour))].sort((a, b) => a - b).filter((h) => avanti(x.date, h));
    return ore.length > 0 ? { date: x.date, ore } : null;
  };
  return { mattina: giorno(p.mattina), conferme: giorno(p.conferme), saltati: p.saltati };
}

export function etichettaRelativa(date: string, now: Date): string {
  const oggi = romeDayKey(now);
  if (date === oggi) return 'oggi';
  if (date === aggiungiGiorni(oggi, 1)) return 'domani';
  return etichettaGiorno(date);
}

/** "alle 9, alle 10 o alle 11" per pochi orari, "dalle 9 alle 20" per una fascia continua. */
const oreLeggibili = (ore: number[]) =>
  ore.length > 3 && ore[ore.length - 1] - ore[0] === ore.length - 1 ? fasciaOre(ore) : elencoOre(ore);

export function testoOreTreStrade(o: OreTreStrade, now: Date): string {
  const parti: string[] = [];
  if (o.mattina) {
    const g = etichettaRelativa(o.mattina.date, now);
    parti.push(`${g === 'domani' ? 'domattina' : g === 'oggi' ? 'stamattina' : `${g} mattina`} ${oreLeggibili(o.mattina.ore)}`);
  }
  if (o.conferme) {
    const g = etichettaRelativa(o.conferme.date, now);
    const pom = o.conferme.ore.every((h) => h >= PRIMA_ORA_POMERIGGIO);
    parti.push(`${g}${pom && (g === 'domani' || g === 'oggi') ? ' pomeriggio' : ''} ${oreLeggibili(o.conferme.ore)}`);
  }
  if (parti.length === 0) return TESTO_NESSUNA_ORA;
  const pieni = o.saltati.length > 0
    ? `${maiuscola(o.saltati.map((d) => {
        const g = etichettaRelativa(d, now);
        return d === o.mattina?.date ? `${g} pomeriggio` : g;
      }).join(' e '))} siamo pieni. `
    : '';
  return `${pieni}Per la videocall ho ${parti.join(', oppure ')}: a che ora ci saresti?`;
}

export const TESTO_NESSUNA_ORA = 'In questi giorni siamo pieni: lascio nota e ti scriviamo appena si libera un posto.';
```

Blocco per il prompt:
```ts
export function bloccoOrePerPrompt(o: OreTreStrade, now: Date): string {
  const riga = (date: string, h: number, nota: string) => `- ${atIso(date, h)} → ${etichettaRelativa(date, now)} alle ${h}:00 (${nota})`;
  const righe = [
    ...(o.mattina?.ore ?? []).map((h) => riga(o.mattina!.date, h, 'videocall col venditore')),
    ...(o.conferme?.ore ?? []).map((h) => riga(o.conferme!.date, h, 'videocall, la conferma la fa Noemi')),
  ];
  return [
    'ORE PRENOTABILI (nel tag [LANCIO:PRENOTA|...] copia ESATTAMENTE una di queste stringhe ISO, nessun altro giorno o ora esiste):',
    ...(righe.length > 0 ? righe : ['- (nessuna ora libera: rispondi con [LANCIO:SLOTS] e basta)']),
  ].join('\n');
}
```
Testi fissi:
```ts
export const DOMANDE_PER_PERCORSO = { chiamata: 2, mattina: 3, conferme: 3 } as const;
export const FRASI_VIETATE = [/se ti convince/i, /se ti interessa/i, /eventualmente/i];
export const TESTO_INTRO_PREQUALIFICA =
  'Visto che i posti sono limitati, prima della videocall ti faccio un paio di domande per capire se il percorso è in linea con te.';

export function testoConfermaChiamata(nomeVenditore: string): string {
  return `Perfetto, ti faccio chiamare subito da ${nomeVenditore}. È una chiamata breve per valutare insieme le ultime cose e fare l'iscrizione, così blocchi il tuo posto: sono limitati.`;
}

export function testoConfermaPrenotazione(kind: LancioKind, at: string, nomeVenditore?: string | null): string {
  const d = new Date(Date.parse(at));
  if (kind !== 'mattina') {
    return `Fissato per ${etichettaGiorno(romeDayKey(d))} alle ${romeHour(d)}:00. Ti chiamerà Noemi per confermare e mandarti il link della videocall: rispondile!`;
  }
  const conChi = nomeVenditore ? ` con ${nomeVenditore}` : ' con un nostro consulente';
  return `Perfetto, ci vediamo in videocall ${oraLeggibile(at)}${conChi}: il link per collegarti ti arriva per email.`;
}
```
`MAX_RISPOSTE` da 6 a 12 (commento: "prequalifica: scelta, ora e fino a 3 domande").

- [ ] **Step 4:** `bun run test lib/lancio-scelta.test.ts` → PASS (aggiornare i test vecchi di `validaAtLancio`, `testoConfermaChiamata` e `testoConfermaPrenotazione` che asserivano le regole/testi di prima: la regola nuova li sostituisce, non vanno tenuti verdi a forza). `bun run typecheck`.

- [ ] **Step 5: commit** `git commit -am "feat(lancio-scelta): regole lun-sab senza fine, ore delle tre strade e testi della chiusura"`

### Task 7: prompt per percorso

**Files:**
- Modify: `lib/lancio-prompt.ts` (`promptPostPitch`, `LancioPromptInput`, `RISPOSTE_RISCALDAMENTO`)
- Modify: `lib/lancio-scelta.ts` (tag `CONFERMA` in `TAG_RE`, `LancioTag`, `parseLancioTag`)
- Test: `lib/lancio-prompt.test.ts`, `lib/lancio-scelta.test.ts`

**Interfaces:**
- Consumes: `DOMANDE_PER_PERCORSO`, `FRASI_VIETATE` (Task 6).
- Produces: `LancioPromptInput.percorso?: 'chiamata' | 'mattina' | 'conferme' | null`; `LancioPromptInput.domandeFatte?: number`; `LancioTag` include `{ tag: 'CONFERMA' }`; `RISPOSTE_RISCALDAMENTO = 0`.

- [ ] **Step 1: test che falliscono.** `lancio-scelta.test.ts`: `expect(parseLancioTag('ok [LANCIO:CONFERMA]')).toEqual({ tag: 'CONFERMA' })`. `lancio-prompt.test.ts`:
```ts
describe('percorsi', () => {
  const base = { fase: 'post_pitch', nome: 'Giulia', eventoAt: '2026-10-05T21:00:00+02:00', modo: 'notte' as const };
  it('chiamata: le due domande e il tutor sulle obiezioni', () => {
    const p = buildLancioSystem({ ...base, percorso: 'chiamata', domandeFatte: 0 });
    expect(p).toContain('cosa ti spinge');
    expect(p).toContain('perché proprio adesso');
    expect(p).toContain('ne parli direttamente col tutor');
    expect(p).toContain('[LANCIO:CHIAMA_ORA]');
  });
  it('mattina: pacchetti senza prezzi e impegno a decidere', () => {
    const p = buildLancioSystem({ ...base, percorso: 'mattina', domandeFatte: 1 });
    expect(p).toContain('Advance, Gold ed Exclusive');
    expect(p).toContain('le vedi col tutor in call');
    expect(p).toContain('un sì o un no');
    expect(p).toContain('[LANCIO:CONFERMA]');
  });
  it('conferme: domande leggere su situazione, pain point e budget, niente impegno', () => {
    const p = buildLancioSystem({ ...base, percorso: 'conferme', domandeFatte: 0 });
    expect(p).toMatch(/budget|investire/i);
    expect(p).not.toContain('un sì o un no');
  });
  it('nessun prompt suggerisce condizionali sulla chiusura', () => {
    for (const percorso of [null, 'chiamata', 'mattina', 'conferme'] as const) {
      const p = buildLancioSystem({ ...base, percorso, domandeFatte: 0 });
      // Le frasi vietate possono comparire SOLO dentro la regola che le vieta.
      const senzaRegola = p.replace(/MAI formule condizionali[^\n]*/g, '');
      for (const re of FRASI_VIETATE) expect(senzaRegola).not.toMatch(re);
    }
  });
});
```

- [ ] **Step 2:** `bun run test lib/lancio-prompt.test.ts lib/lancio-scelta.test.ts` → FAIL.

- [ ] **Step 3: implementazione.** `TAG_RE` diventa `/\[LANCIO:(CHIAMA_ORA|PRENOTA|SLOTS|NO|CONFERMA)(?:\|([^\]]*))?\]/gi` e `parseLancioTag` restituisce `{ tag: 'CONFERMA' }`. `RISPOSTE_RISCALDAMENTO = 0` (commento: "PO 02/10: niente riscaldamento prima della scelta, le domande vengono dopo, per percorso"). In `promptPostPitch` la sezione DOVE SIAMO dipende dal percorso:

```ts
const CHIUSURA_PRESUNTA = 'MAI formule condizionali sulla chiusura ("se ti convince", "se ti interessa", "eventualmente"): la call col tutor serve a chiudere le ultime cose e fare l\'iscrizione, e lo dai per scontato.';

function dovePercorso(percorso: LancioPromptInput['percorso'], fatte: number, domandaScelta: string): string {
  switch (percorso) {
    case 'chiamata':
      return `Il lead vuole essere chiamato subito. Prima gli fai due domande brevi, UNA alla volta (già fatte: ${fatte} su 2):
1) cosa ti spinge a voler fare un percorso come questo?
2) e perché proprio adesso hai deciso di muoverti?
Quando ha risposto alla seconda → [LANCIO:CHIAMA_ORA]. Se fa un'obiezione, non vuole rispondere o insiste per essere chiamato: rispondi in breve "ne parli direttamente col tutor" e metti [LANCIO:CHIAMA_ORA]. Le domande non sono un esame: non insistere mai.`;
    case 'mattina':
      return `Il lead ha scelto un'ora con un venditore. I posti sono limitati: prima di fissare fai tre domande, UNA alla volta (già fatte: ${fatte} su 3):
1) cosa non va oggi nel suo lavoro o nella sua situazione (il motivo vero per cui vuole cambiare);
2) "Durante la live abbiamo presentato Advance, Gold ed Exclusive: a quale pensavi?" Non dire MAI prezzi né cosa contengono i pacchetti: se chiede le differenze, "le vedi col tutor in call";
3) "In call col tutor chiudete le ultime cose e fai l'iscrizione: l'obiettivo è decidere lì, un sì o un no. Ti va bene?"
Dopo la terza risposta → [LANCIO:CONFERMA]. Se fa un'obiezione su una domanda: "ne parli direttamente col tutor" e passa alla successiva (o [LANCIO:CONFERMA] se era l'ultima). Se cambia ora scegliendone un'altra dal blocco ORE PRENOTABILI → [LANCIO:PRENOTA|<ISO>].`;
    case 'conferme':
      return `Il lead ha scelto un'ora per la videocall. Prima di fissare fai qualche domanda leggera, UNA alla volta, senza spingere (già fatte: ${fatte} su 3): la sua situazione oggi (studio, lavoro); cosa vorrebbe cambiare; quanto sarebbe disposto a investire su sé stesso per riuscirci, senza dire cifre tu. Dopo la terza risposta, o se preferisce non rispondere → [LANCIO:CONFERMA]. Se cambia ora scegliendone un'altra dal blocco ORE PRENOTABILI → [LANCIO:PRENOTA|<ISO>].`;
    default:
      return `Chiedi esattamente: "${domandaScelta}". Poi leggi la risposta e usa il tag giusto.`;
  }
}
```
`doveSiamo` = `dovePercorso(i.percorso ?? null, Math.max(0, i.domandeFatte ?? 0), domandaScelta)`. La riga "Risposte di riscaldamento già raccolte" si toglie. In COME SCRIVI aggiungere `- ${CHIUSURA_PRESUNTA}`. In TAG TECNICI, quando `percorso` è `mattina`/`conferme`, l'elenco dei tag sostituiti include `[LANCIO:CONFERMA]`; nei percorsi la riga "Tutto il resto → [LANCIO:DOMANDA]" resta (è il tag delle domande). La regola `regolaAdesso` di notte resta, ma la spinta "posti limitati" non deve contenere frasi vietate (verificare).

- [ ] **Step 4:** test → PASS (aggiornare i test esistenti che asserivano il riscaldamento "cosa fa oggi / cosa l'ha colpita" e "Risposte di riscaldamento già raccolte": sono la regola vecchia). `bun run typecheck`.

- [ ] **Step 5: commit** `git commit -am "feat(lancio-prompt): domande per percorso e chiusura presunta"`

### Task 8: il turno post-pitch con i tre percorsi

**Files:**
- Modify: `lib/lancio-post-pitch.ts` (`turnoPostPitch`)
- Modify: `lib/lancio-reply.ts` solo se `genera` deve inoltrare `percorso`/`domandeFatte` al builder del prompt (leggere com'è costruito l'input oggi)
- Test: `lib/lancio-post-pitch.test.ts`

**Interfaces:**
- Consumes: `lancioProssimi`, `LancioInfo` estesa (Task 5); `validaAtLancio`, `oreDaProssimi`, `testoOreTreStrade`, `bloccoOrePerPrompt`, `DOMANDE_PER_PERCORSO`, testi fissi, `TESTO_INTRO_PREQUALIFICA`, `TESTO_NESSUNA_ORA` (Task 6); tag `CONFERMA` e input `percorso`/`domandeFatte` (Task 7).

**Macchina a stati** (tutto in `lancio_info`, scritto con `salvaInfo`; `domande` conta gli inbound ricevuti DENTRO il percorso, cioè +numero di testi del lotto a ogni turno in cui il percorso era già attivo all'inizio del turno):

| Stato all'inizio del turno | Evento | Azione |
|---|---|---|
| `percorso` nullo | tap "Chiamami subito" o tag `CHIAMA_ORA`, di notte | `percorso='chiamata'`, `domande=0`; bolla del modello con la 1ª domanda (rigenerare con `percorso:'chiamata'`) |
| `percorso` nullo | tap "Fissiamo domani" / tag `SLOTS` | `lancioProssimi(giornoDopo)` → `testoOreTreStrade`, `slotsMostratiAt` |
| `percorso` nullo o `mattina`/`conferme` | tag `PRENOTA|at` valido | `oraScelta=at`, `percorso = kind==='mattina' ? 'mattina' : 'conferme'`; se `domande ≥ DOMANDE_PER_PERCORSO[percorso]` → prenota subito; altrimenti, se era nullo, bolla `TESTO_INTRO_PREQUALIFICA + ' ' + prima domanda` (generata dal modello col nuovo percorso), con `domande=0` |
| `chiamata` | `domande ≥ 2` (dopo aver contato il lotto) o tag `CHIAMA_ORA` | `lancioCallNow` → `testoConfermaChiamata(nome)` |
| `mattina`/`conferme` | `domande ≥ N` o tag `CONFERMA` | `lancioBook(oraScelta)` |
| qualunque percorso | tag `NO` | congedo come oggi |
| qualunque percorso | tag `DOMANDA` / nessun tag | bolla del modello (domanda successiva) |

Esiti di `book` nel percorso:
- ok → `testoConfermaPrenotazione(kind, at, venditore?)`, `sceltaFatta('prenota', …)`.
- `ora_esaurita` → `ore = oreDaProssimi(esito.prossimi, now)`; `oraScelta=null`, `percorso=null` ma `domande` RESTA (chi ha già risposto non rifà le domande: alla prossima `PRENOTA` con `domande ≥ N` si prenota subito); bolla `Le ${h} si sono appena riempite. ${testoOreTreStrade(ore, now)}`.
- `fuori_regole`/`gia_prenotato`/errori → come oggi.

`domande` vale per qualunque percorso di prenotazione: chi ha risposto a 3 domande "mattina" e finisce alle Conferme ha già fatto ≥3 → prenota subito (spec §2.2 punto 4).

`nessun_venditore` su call-now → `percorso=null` e si mostrano le ore (`testoOreTreStrade`) preceduto da `TESTO_NESSUN_VENDITORE`.

Tetto di sicurezza: se `domande ≥ N + 2` (il lead scrive ma il modello non chiude), il codice chiude come se fosse arrivato `CONFERMA`/`CHIAMA_ORA`.

- [ ] **Step 1: test che falliscono** in `lancio-post-pitch.test.ts`, usando gli helper del file (generatore finto `genera` che restituisce testo + `lancioTag`, client CRM simulato con `vi.mock('./lancio-crm')`). Casi:
  1. notte, tap "Chiamami subito" → nessuna chiamata a `lancioCallNow`; `lancio_info.percorso === 'chiamata'`; una bolla inviata.
  2. percorso `chiamata`, `domande: 1`, arriva un inbound → `lancioCallNow` chiamato con `info.risposte` che contiene le due risposte; bolla = `testoConfermaChiamata(nome)`.
  3. percorso `chiamata`, `domande: 0`, il modello restituisce `CHIAMA_ORA` (obiezione) → `lancioCallNow` chiamato subito.
  4. `PRENOTA` su `2026-10-06T10:00:00+02:00` con `percorso` nullo → nessun `lancioBook`; `percorso==='mattina'`, `oraScelta` salvata; la bolla comincia con `TESTO_INTRO_PREQUALIFICA`.
  5. percorso `mattina`, `domande: 2`, un inbound → `lancioBook` con `oraScelta`; bolla mattina con il nome del venditore.
  6. percorso `mattina`, `domande: 3`, `lancioBook` → `ora_esaurita` con `prossimi.conferme` sul 7 → `percorso` nullo, `domande` resta 3, bolla con "si sono appena riempite" e "mercoledì 7 ottobre"; turno dopo: `PRENOTA` sul 7 alle 10 → `lancioBook` chiamato SUBITO (niente domande).
  7. percorso `conferme`, `domande: 1`, `PRENOTA` su un'altra ora → `oraScelta` aggiornata, `domande` resta 1, nessun `lancioBook`.
  8. percorso `conferme`, `domande: 5` (oltre N+2 - 1) e nessun tag → `lancioBook` chiamato (tetto di sicurezza).
  9. `book` ok con `kind:'conferme'` → bolla = testo Conferme con Noemi.
  10. tap "Fissiamo domani" con `lancioProssimi` che dice `saltati:['2026-10-06']` → bolla contiene "pieni".

- [ ] **Step 2:** `bun run test lib/lancio-post-pitch.test.ts` → FAIL.

- [ ] **Step 3: implementazione** in `turnoPostPitch`:
  - `leggiOre` usa `lancioProssimi(giorni.giornoDopo)` e `oreDaProssimi`; in caso di errore CRM, evento `lancio_slots_non_letti` e `TESTO_NESSUNA_ORA` NON va mandato: si manda `TESTO_ERRORE_CRM` (senza CRM non si conoscono più le ore Conferme, e proporre ore a caso romperebbe il tetto). Nota: è un cambio di comportamento rispetto a oggi (prima si proponevano pomeriggio e dopodomani a scatola chiusa); motivarlo nel commento.
  - `mostraOre` usa `testoOreTreStrade`; se `mattina` e `conferme` sono entrambi `null` → bolla `TESTO_NESSUNA_ORA` + `sendCrmNota` con `NOTA_SENZA_ORE` (testo aggiornato: "non ci sono ore libere nei prossimi 30 giorni").
  - `bloccoSlot` per il prompt = `bloccoOrePerPrompt(await leggiOre(), now)` quando `faseScelta` e non c'è tap.
  - `genera(...)` riceve anche `percorso: info.percorso ?? null` e `domandeFatte: info.domande ?? 0`.
  - Conteggio: a inizio turno `const percorsoIniziale = info.percorso ?? null; if (percorsoIniziale) info.domande = (info.domande ?? 0) + testi.length;` (prima di chiamare il modello, dopo `raccogliRisposte`).
  - Rami secondo la tabella sopra; la rigenerazione della prima domanda dopo un cambio di percorso si fa con una seconda chiamata a `genera` con il percorso nuovo e `domandeFatte: 0` (una sola volta per turno), la bolla esce dal suo `visibleReply` ripulito dai tag; per `mattina`/`conferme` preceduta da `TESTO_INTRO_PREQUALIFICA`.
  - `lancioCallNow`/`lancioBook` ricevono `info: { risposte: info.risposte }` (solo le risposte: il resto di `lancio_info` è stato interno del bot).
  - Rimuovere da `lancio-scelta.ts` le funzioni non più usate (`oreProponibili`, `testoSlots`, `bloccoSlotPerPrompt`, `testoOraEsaurita`, `testoAtNonValido`, `nomiGiorni`, costanti `FASCIA_*` non usate) SOLO se nessun altro file le importa (`grep -rn` su tutto il repo, compresi i cron del follow-up); i loro test si tolgono insieme.
  - `testoAtNonValido` nuovo: `Quell'ora non riesco a fissarla. ${testoOreTreStrade(ore, now)}`.

- [ ] **Step 4:** `bun run test` (tutta la suite) e `bun run typecheck` → verdi. Fare attenzione ai test di `lancio-turno`, del follow-up e del webhook che usano `LancioInfo` o i testi vecchi.

- [ ] **Step 5: commit** `git commit -am "feat(lancio-post-pitch): chiamata subito con due domande, prequalifica sulla mattina, Conferme col tetto"`

### Task 9: verifica finale, prova dal vivo, rilascio (con Bruno)

**Files:**
- Modify: `docs/lancio-webdev-runbook-b6.md` (bot): sezione "Tre strade (02/10)" con i passi di prova qui sotto.
- Modify: `docs/superpowers/specs/2026-10-02-lancio-tre-strade-tetto-conferme-design.md` (CRM): nota "le domande vengono dopo la scelta dell'ora" in §2.3 (il percorso si conosce solo quando il lead sceglie l'ora).

- [ ] **Step 1:** in entrambi i worktree: suite completa, typecheck, build (`npm run build` CRM, `bun run build` bot) verdi. Riportare il numero di test.
- [ ] **Step 2: review dell'intero branch** (superpowers:requesting-code-review) su CRM e bot, con particolare attenzione alla Review Focus.
- [ ] **Step 3: STOP — chiedere a Bruno l'ok per il push.** Ordine: merge CRM su `main` + `git push origin main` (deploy Vercel), verifica Ready e smoke `POST /api/bot/lancio/slots {from:'2026-10-06'}` firmato (script esistente del runbook); poi merge bot su `main` dal worktree (fast-forward su `origin/main`) + push, `git rev-list --count origin/main..main` = 0, deploy Ready.
- [ ] **Step 4: prova dal vivo col numero di test** (runbook B6, `LANCIO_FAKE_NOW` solo fuori prod / anteprima): chiamata subito con obiezione; mattina con prequalifica; Conferme con ora piena simulata. Nessun lead vero toccato.
- [ ] **Step 5:** memoria del progetto aggiornata (`project_lancio_webdev_esecuzione.md`) con commit e stato.
