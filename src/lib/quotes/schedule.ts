// Generatore del calendario della citazione del giorno e del consiglio di
// vendita (PO 25/10/2026). Modulo puro e deterministico: stesso input e stesso
// seme danno lo stesso calendario, così lo si può rigenerare uguale.
//
// Regole:
// - un giorno lavorativo (lun-sab, feste italiane e chiusure escluse) = una citazione;
// - mai lo stesso tema in due giorni lavorativi consecutivi;
// - lo stesso autore non prima di N giorni lavorativi (citazioni 7, vendita 2 = mai di fila);
// - mai frasi troppo simili entro 10 giorni lavorativi;
// - ogni citazione al massimo una volta finché il pool non è esaurito, poi si ricomincia;
// - occasioni (Natale, Pasqua, rientro…): le citazioni a tema stanno nei loro giorni,
//   distribuite sui periodi con una densità che si adatta a quante ne restano;
//   lunedì, sabato e stagioni sono solo una preferenza;
// - vendita: niente occasioni, e i ruoli si alternano perché nessuno resti senza consiglio.
// Se i vincoli non lasciano candidati il giorno si riempie lo stesso, allentandoli
// dal meno grave al più grave, e il giorno lo dichiara in `relaxed`.

import { type DayStr, type OccasionSlot, workingDaysInRange, occasionCalendar, isStrongOccasion, KNOWN_OCCASIONS } from './calendar'
import { lemmas, tooSimilar, SIMILARITY_THRESHOLD } from './similarity'

export type QuoteKind = 'citazione' | 'vendita'

export interface ScheduleQuote {
    id: string
    author: string
    theme: string | null
    /** Testo confrontato per la similarità (per la vendita: la frase, anche vuota). */
    text: string
    /** Solo vendita: la tecnica, confrontata anch'essa. */
    technique?: string | null
    occasions?: readonly string[]
    roles?: readonly string[]
}

export interface ScheduleRules {
    /** Distanza minima in giorni lavorativi tra due usi dello stesso autore. */
    minAuthorDistance: number
    /** Distanza minima tra due usi dello stesso tema (2 = mai in giorni consecutivi). */
    minThemeDistance: number
    /** Giorni lavorativi entro cui due frasi troppo simili non possono stare. */
    similarityWindow: number
    similarityThreshold: number
    useOccasions: boolean
    balanceRoles: boolean
}

export const CITAZIONE_RULES: ScheduleRules = {
    minAuthorDistance: 7, minThemeDistance: 2, similarityWindow: 10,
    similarityThreshold: SIMILARITY_THRESHOLD, useOccasions: true, balanceRoles: false,
}

export const VENDITA_RULES: ScheduleRules = {
    minAuthorDistance: 2, minThemeDistance: 2, similarityWindow: 10,
    similarityThreshold: SIMILARITY_THRESHOLD, useOccasions: false, balanceRoles: true,
}

export interface ScheduleInput {
    quotes: readonly ScheduleQuote[]
    from: DayStr
    to: DayStr
    seed: string
    rules: ScheduleRules
    closedDays?: Iterable<DayStr>
    /** Giorni già approvati (o comunque da non toccare): la citazione resta quella. */
    locked?: Readonly<Record<DayStr, string>>
    /** Giorni prima di `from`: contano per i vincoli a cavallo e per il giro del pool. */
    history?: ReadonlyArray<{ day: DayStr; quoteId: string }>
}

export interface ScheduledDay {
    day: DayStr
    quoteId: string | null
    locked: boolean
    /** Occasione onorata quel giorno, se la citazione scelta la porta. */
    occasion: string | null
    /** Vincoli allentati per riempire il giorno (vuoto di norma). */
    relaxed: string[]
    /** Giro del pool: 0 finché le citazioni non si esauriscono, poi 1, 2… */
    cycle: number
}

const keyOf = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

interface Prepared {
    author: string
    theme: string | null
    tags: string[]
    /** Porta almeno un'occasione forte: fuori dai suoi periodi non si usa. */
    strong: boolean
    roles: string[]
    textLemmas: Set<string>
    techniqueLemmas: Set<string> | null
}

function prepare(q: ScheduleQuote): Prepared {
    const tags = [...new Set((q.occasions ?? []).filter(o => KNOWN_OCCASIONS.has(o)))]
    const technique = q.technique?.trim()
    return {
        author: keyOf(q.author),
        theme: q.theme?.trim() ? keyOf(q.theme) : null,
        tags,
        strong: tags.some(isStrongOccasion),
        roles: [...new Set(q.roles ?? [])].sort(),
        textLemmas: lemmas(q.text ?? ''),
        techniqueLemmas: technique ? lemmas(technique) : null,
    }
}

function similarPrepared(a: Prepared, b: Prepared, threshold: number): boolean {
    if (tooSimilar(a.textLemmas, b.textLemmas, threshold)) return true
    return !!a.techniqueLemmas && !!b.techniqueLemmas && tooSimilar(a.techniqueLemmas, b.techniqueLemmas, threshold)
}

/** FNV-1a + finalizzatore di murmur3: numero stabile in [0, 1) per (seme, giorno, citazione). */
function jitter(seed: string, day: DayStr, id: string): number {
    const s = `${seed}|${day}|${id}`
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
}

interface Level {
    relaxed: string[]
    unusedOnly: boolean
    offOccasion: boolean
    similarity: boolean
    author: boolean
    theme: boolean
    reuseGap: boolean
    reserved: boolean
}

// Dal più severo al più permissivo: si scende solo se il livello sopra non ha candidati.
const LEVELS: Level[] = [
    { relaxed: [], unusedOnly: true, offOccasion: false, similarity: true, author: true, theme: true, reuseGap: true, reserved: true },
    { relaxed: ['occasione'], unusedOnly: true, offOccasion: true, similarity: true, author: true, theme: true, reuseGap: true, reserved: true },
    { relaxed: ['occasione', 'simile'], unusedOnly: true, offOccasion: true, similarity: false, author: true, theme: true, reuseGap: true, reserved: true },
    { relaxed: ['occasione', 'simile', 'autore'], unusedOnly: true, offOccasion: true, similarity: false, author: false, theme: true, reuseGap: true, reserved: true },
    { relaxed: ['occasione', 'simile', 'autore', 'giro'], unusedOnly: false, offOccasion: true, similarity: false, author: false, theme: true, reuseGap: false, reserved: true },
    { relaxed: ['occasione', 'simile', 'autore', 'giro', 'tema'], unusedOnly: false, offOccasion: true, similarity: false, author: false, theme: false, reuseGap: false, reserved: false },
]

const STRONG_BONUS = 100
const WEAK_BONUS = 10
const OFF_OCCASION_PENALTY = 1000
const WEAK_OFF_DAY_PENALTY = 2
const ROLE_STARVE_BONUS = 2
const ROLE_STARVE_CAP = 5
/** Giorni di digiuno dopo cui, se i consigli di quel ruolo nel giro sono finiti, si apre un giro nuovo. */
const ROLE_RESET_STARVE = 2
const RECENCY_BONUS = 3

export function generateSchedule(input: ScheduleInput): ScheduledDay[] {
    const { rules, seed } = input
    const closed = new Set(input.closedDays ?? [])
    const days = workingDaysInRange(input.from, input.to, closed)

    // Ordine per id: il risultato non dipende dall'ordine in cui arrivano le citazioni.
    const unique = new Map<string, ScheduleQuote>()
    for (const q of input.quotes) if (!unique.has(q.id)) unique.set(q.id, q)
    const quotes = [...unique.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const n = quotes.length
    const index = new Map(quotes.map((q, i) => [q.id, i]))
    const prep = quotes.map(prepare)

    const similar: Set<number>[] = quotes.map(() => new Set<number>())
    for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
            if (similarPrepared(prep[a], prep[b], rules.similarityThreshold)) {
                similar[a].add(b)
                similar[b].add(a)
            }
        }
    }

    // Occupazione dei giorni: indice del giorno → citazione. Lo storico ha indici negativi.
    const at = new Map<number, number>()
    const used = new Set<number>()
    const lastUse = new Map<number, number>()
    const roleLast = new Map<string, number>()
    let cycle = 0

    const markUse = (qi: number, idx: number) => {
        used.add(qi)
        lastUse.set(qi, idx)
        for (const r of prep[qi].roles) roleLast.set(r, idx)
    }

    const history = [...(input.history ?? [])]
        .filter(h => h.day < input.from)
        .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    history.forEach((h, k) => {
        const qi = index.get(h.quoteId)
        if (qi === undefined) return
        // Una citazione che ricompare quando il pool era quasi tutto usato = giro nuovo.
        if (used.has(qi) && used.size >= 0.8 * n) {
            used.clear()
            cycle++
        }
        const idx = k - history.length
        at.set(idx, qi)
        markUse(qi, idx)
    })

    const lockedIds = new Map<number, string>()
    const reserved = new Set<number>()
    for (const [day, id] of Object.entries(input.locked ?? {})) {
        const i = days.indexOf(day)
        if (i < 0) continue
        lockedIds.set(i, id)
        const qi = index.get(id)
        if (qi !== undefined) {
            at.set(i, qi)
            reserved.add(qi)
        }
    }

    // Occasioni: giorno per giorno, più i totali "da qui alla fine" per dosare la densità.
    const cal = rules.useOccasions ? occasionCalendar(days, closed) : new Map<DayStr, OccasionSlot[]>()
    const slotsByDay = days.map(d => cal.get(d) ?? [])
    const tagIndex = new Map<string, number[]>()
    prep.forEach((p, qi) => {
        for (const t of p.tags) tagIndex.set(t, [...(tagIndex.get(t) ?? []), qi])
    })
    const weightFrom = new Map<string, number[]>()   // somma dei pesi (giorni non obbligatori) da i alla fine
    const mustAfter = new Map<string, number[]>()    // giorni obbligatori dopo i
    for (const occasion of tagIndex.keys()) {
        const w = new Array<number>(days.length + 1).fill(0)
        const m = new Array<number>(days.length + 1).fill(0)
        for (let i = days.length - 1; i >= 0; i--) {
            const slot = slotsByDay[i].find(s => s.occasion === occasion)
            w[i] = w[i + 1] + (slot && !slot.must ? slot.weight : 0)
            m[i] = m[i + 1] + (slotsByDay[i + 1]?.some(s => s.occasion === occasion && s.must) ? 1 : 0)
        }
        weightFrom.set(occasion, w)
        mustAfter.set(occasion, m)
    }
    const accumulator = new Map<string, number>()

    const remainingTagged = (occasion: string) =>
        (tagIndex.get(occasion) ?? []).filter(qi => !used.has(qi) && !reserved.has(qi)).length

    /** Occasioni da onorare oggi: sempre nei giorni simbolo, altrimenti con densità adattiva. */
    const targetsFor = (i: number): Set<string> => {
        const targets = new Set<string>()
        for (const slot of slotsByDay[i]) {
            if (!tagIndex.has(slot.occasion)) continue
            const rem = remainingTagged(slot.occasion)
            if (rem === 0) continue
            if (slot.must) {
                targets.add(slot.occasion)
                continue
            }
            const forSampling = rem - mustAfter.get(slot.occasion)![i]
            const wRest = weightFrom.get(slot.occasion)![i]
            if (forSampling <= 0 || wRest <= 0) continue
            const p = Math.min(1, (forSampling * slot.weight) / wRest)
            const acc = (accumulator.get(slot.occasion) ?? 0) + p
            if (acc >= 1 - 1e-9) {
                targets.add(slot.occasion)
                accumulator.set(slot.occasion, acc - 1)
            } else {
                accumulator.set(slot.occasion, acc)
            }
        }
        return targets
    }

    const maxDist = Math.max(rules.minThemeDistance - 1, rules.minAuthorDistance - 1, rules.similarityWindow, 1)
    const minReuse = Math.max(1, Math.floor(n / 2))
    const generalCount = prep.filter(p => !p.strong).length
    const tail = Math.max(5, Math.ceil(generalCount * 0.1))

    const allRoles = [...new Set(prep.flatMap(p => p.roles))].sort()
    const starveOf = (r: string, i: number) => i - (roleLast.get(r) ?? -1) - 1
    /** Consigli ancora disponibili nel giro, in tutto e per ruolo. */
    const remainingByRole = () => {
        let all = 0
        const byRole = new Map<string, number>()
        prep.forEach((p, qi) => {
            if (used.has(qi) || reserved.has(qi)) return
            all++
            for (const r of p.roles) byRole.set(r, (byRole.get(r) ?? 0) + 1)
        })
        return { all, byRole }
    }
    /**
     * Spinta per ruolo: un ruolo "si può permettere" un consiglio ogni
     * (rimasti in tutto / rimasti per lui) giorni; oltre quell'attesa riceve una
     * spinta che cresce coi giorni di digiuno. Così un ruolo con pochi consigli
     * li riceve distribuiti sul giro, invece che tutti all'inizio e poi niente.
     */
    const rolePushFor = (i: number): Map<string, number> => {
        const push = new Map<string, number>()
        if (!rules.balanceRoles) return push
        const { all, byRole } = remainingByRole()
        for (const r of allRoles) {
            const rem = byRole.get(r) ?? 0
            if (rem === 0) continue
            const over = starveOf(r, i) + 1 - all / rem
            if (over > 0) push.set(r, Math.min(over, ROLE_STARVE_CAP) * ROLE_STARVE_BONUS)
        }
        return push
    }

    const blocked = (qi: number, i: number, lv: Level): boolean => {
        const p = prep[qi]
        for (let d = 1; d <= maxDist; d++) {
            for (const j of [i - d, i + d]) {
                const o = at.get(j)
                if (o === undefined) continue
                if (o === qi && d <= Math.max(rules.similarityWindow, 1)) return true
                if (lv.theme && d < rules.minThemeDistance && p.theme !== null && prep[o].theme === p.theme) return true
                if (lv.author && d < rules.minAuthorDistance && prep[o].author === p.author) return true
                if (lv.similarity && d <= rules.similarityWindow && similar[qi].has(o)) return true
            }
        }
        return false
    }

    const offOccasion = (qi: number, active: Set<string>) =>
        rules.useOccasions && prep[qi].tags.length > 0 && !prep[qi].tags.some(t => active.has(t))

    interface DayContext { targets: Set<string>; active: Set<string>; push: Map<string, number> }

    const score = (qi: number, i: number, day: DayStr, ctx: DayContext): number => {
        const p = prep[qi]
        let s = jitter(seed, day, quotes[qi].id)
        if (rules.useOccasions && p.tags.length > 0) {
            let bonus = 0
            for (const t of p.tags) if (ctx.targets.has(t)) bonus = Math.max(bonus, isStrongOccasion(t) ? STRONG_BONUS : WEAK_BONUS)
            s += bonus
            if (offOccasion(qi, ctx.active)) s -= p.strong ? OFF_OCCASION_PENALTY : WEAK_OFF_DAY_PENALTY
        }
        for (const r of p.roles) s += ctx.push.get(r) ?? 0
        const last = lastUse.get(qi)
        s += last === undefined ? RECENCY_BONUS : (Math.min(i - last, 500) / 500) * RECENCY_BONUS
        return s
    }

    const choose = (i: number, day: DayStr, lv: Level, ctx: DayContext): number => {
        let best = -1
        let bestScore = -Infinity
        for (let qi = 0; qi < n; qi++) {
            if (lv.reserved && reserved.has(qi)) continue
            if (lv.unusedOnly && used.has(qi)) continue
            if (lv.reuseGap) {
                const last = lastUse.get(qi)
                if (last !== undefined && i - last < minReuse) continue
            }
            if (!lv.offOccasion && offOccasion(qi, ctx.active) && prep[qi].strong) continue
            if (blocked(qi, i, lv)) continue
            const s = score(qi, i, day, ctx)
            if (s > bestScore) {
                bestScore = s
                best = qi
            }
        }
        return best
    }

    /** Ultima risorsa (pool minuscolo): la citazione usata meno di recente, non quella di ieri. */
    const leastRecent = (i: number): number => {
        let best = -1
        let bestLast = Infinity
        for (let qi = 0; qi < n; qi++) {
            if (n > 1 && at.get(i - 1) === qi) continue
            const last = lastUse.get(qi) ?? -Infinity
            if (last < bestLast) {
                bestLast = last
                best = qi
            }
        }
        return best
    }

    const out: ScheduledDay[] = []
    for (let i = 0; i < days.length; i++) {
        const day = days[i]
        const targets = rules.useOccasions ? targetsFor(i) : new Set<string>()
        const active = new Set(slotsByDay[i].map(s => s.occasion))
        const occasionOf = (qi: number) => {
            const tags = prep[qi].tags.filter(t => targets.has(t))
            return tags.find(isStrongOccasion) ?? tags[0] ?? null
        }

        const lockedId = lockedIds.get(i)
        if (lockedId !== undefined) {
            const qi = index.get(lockedId)
            if (qi !== undefined) {
                reserved.delete(qi)
                markUse(qi, i)
            }
            out.push({ day, quoteId: lockedId, locked: true, occasion: qi !== undefined ? occasionOf(qi) : null, relaxed: [], cycle })
            continue
        }
        if (n === 0) {
            out.push({ day, quoteId: null, locked: false, occasion: null, relaxed: [], cycle })
            continue
        }

        // Vendita: un ruolo a secco da giorni e senza più consigli nel giro apre un giro nuovo.
        if (rules.balanceRoles && used.size >= n / 2) {
            const { byRole } = remainingByRole()
            if (allRoles.some(r => (byRole.get(r) ?? 0) === 0 && starveOf(r, i) >= ROLE_RESET_STARVE)) {
                used.clear()
                cycle++
            }
        }
        const ctx: DayContext = { targets, active, push: rolePushFor(i) }

        let level = 0
        let pick = choose(i, day, LEVELS[0], ctx)
        if (pick < 0 && used.size > 0) {
            // Pool (quasi) esaurito: si apre un giro nuovo. Le poche rimaste fuori
            // restano "mai usate" e passano davanti alle altre nel giro nuovo.
            const unusedGeneral = prep.filter((p, qi) => !p.strong && !used.has(qi) && !reserved.has(qi)).length
            if (unusedGeneral <= tail) {
                used.clear()
                cycle++
                ctx.push = rolePushFor(i)
                pick = choose(i, day, LEVELS[0], ctx)
            }
        }
        while (pick < 0 && level < LEVELS.length - 1) {
            level++
            pick = choose(i, day, LEVELS[level], ctx)
        }
        const relaxed = [...LEVELS[level].relaxed]
        if (pick < 0) {
            pick = leastRecent(i)
            relaxed.push('ripetizione')
        }

        at.set(i, pick)
        markUse(pick, i)
        out.push({ day, quoteId: quotes[pick].id, locked: false, occasion: occasionOf(pick), relaxed, cycle })
    }
    return out
}

// ── Controllo a posteriori ──

export interface ScheduleViolation {
    day: DayStr
    rule: 'tema' | 'autore' | 'simile' | 'ripetizione'
    /** Il giorno precedente con cui c'è il conflitto. */
    other: DayStr
}

/**
 * Rilegge un calendario (giorni lavorativi consecutivi, in ordine) e segnala i
 * vincoli violati. Serve allo script di import per il rapporto e ai test.
 */
export function auditSchedule(
    entries: ReadonlyArray<{ day: DayStr; quoteId: string | null }>,
    quotes: readonly ScheduleQuote[],
    rules: ScheduleRules,
): ScheduleViolation[] {
    const prepById = new Map(quotes.map(q => [q.id, prepare(q)]))
    const maxDist = Math.max(rules.minThemeDistance - 1, rules.minAuthorDistance - 1, rules.similarityWindow, 1)
    const out: ScheduleViolation[] = []
    entries.forEach((e, i) => {
        const cur = e.quoteId ? prepById.get(e.quoteId) : undefined
        if (!cur) return
        for (let d = 1; d <= maxDist && i - d >= 0; d++) {
            const prevEntry = entries[i - d]
            const prev = prevEntry.quoteId ? prepById.get(prevEntry.quoteId) : undefined
            if (!prev) continue
            if (prevEntry.quoteId === e.quoteId) {
                if (d <= Math.max(rules.similarityWindow, 1)) out.push({ day: e.day, rule: 'ripetizione', other: prevEntry.day })
                continue
            }
            if (d < rules.minThemeDistance && cur.theme !== null && prev.theme === cur.theme) out.push({ day: e.day, rule: 'tema', other: prevEntry.day })
            if (d < rules.minAuthorDistance && prev.author === cur.author) out.push({ day: e.day, rule: 'autore', other: prevEntry.day })
            if (d <= rules.similarityWindow && similarPrepared(cur, prev, rules.similarityThreshold)) out.push({ day: e.day, rule: 'simile', other: prevEntry.day })
        }
    })
    return out
}
