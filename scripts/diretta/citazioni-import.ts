/**
 * Import delle citazioni del giorno e dei consigli di vendita verificati, e
 * generazione del calendario (PO 25/10/2026).
 *
 *   npx tsx --env-file=.env.local scripts/diretta/citazioni-import.ts <cartella>            # prova, non scrive
 *   npx tsx --env-file=.env.local scripts/diretta/citazioni-import.ts <cartella> --apply    # scrive
 *
 * Opzioni:
 *   --da=2026-10-26          primo giorno del calendario (default lunedì 26/10/2026)
 *   --mesi=18                durata del calendario
 *   --seme=fenice-2026       seme del generatore: stesso seme e stessi dati = stesso calendario
 *   --chiusi=2026-12-24,...  giorni di chiusura dell'ufficio (si aggiungono a quelli salvati)
 *   --solo-mancanti          non rigenera i giorni già in calendario, riempie solo i vuoti
 *   --out=calendario.json    scrive il calendario generato in un file, per controllarlo
 *
 * Cosa fa:
 * 1. legge tutti i .json della cartella (array, o oggetto con dentro l'array);
 *    entrano SOLO gli elementi con "verified": true e con le fonti
 *    (src/lib/quotes/importFormat.ts); i ruoli gdo/conferme/venditori diventano
 *    GDO/CONFERME/VENDITORE (più ADMIN); il consiglio va nella bozza
 *    (suggestedReflection) del tipo 'vendita';
 * 2. inserisce o aggiorna dailyQuotes (id stabile: rifarlo non duplica; non
 *    tocca isActive, così una citazione spenta dall'admin resta spenta);
 * 3. genera il calendario da --da per --mesi, giorni lavorativi lun-sab,
 *    feste e chiusure escluse (src/lib/quotes/schedule.ts), e lo scrive in
 *    dailyQuoteSchedule senza MAI sovrascrivere un giorno approvato, né i
 *    giorni passati, né quello di oggi se c'è già.
 *
 * Idempotente: rilanciato con gli stessi file e lo stesso seme non cambia nulla.
 * Le schermate vedono il nuovo calendario entro 15 minuti (cache del giorno).
 * Richiede la migrazione 0046 (technique, usage, originalText) per --apply.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { appSettings, dailyQuotes, dailyQuoteSchedule } from '../../src/db/schema'
import { toRomeDateStr } from '../../src/lib/dateUtils'
import { collectItems, parseImportItem, type QuoteImportRow } from '../../src/lib/quotes/importFormat'
import {
    addDays, addMonths, isValidDay, parseClosedDays, QUOTES_CLOSED_DAYS_KEY,
} from '../../src/lib/quotes/calendar'
import {
    auditSchedule, generateSchedule, CITAZIONE_RULES, VENDITA_RULES,
    type ScheduleQuote, type ScheduledDay, type QuoteKind,
} from '../../src/lib/quotes/schedule'

interface Args {
    folder: string
    apply: boolean
    from: string
    months: number
    seed: string
    closed: string[]
    onlyMissing: boolean
    out: string | null
}

function parseArgs(argv: string[]): Args {
    const args: Args = {
        folder: '', apply: false, from: '2026-10-26', months: 18, seed: 'fenice-2026',
        closed: [], onlyMissing: false, out: null,
    }
    for (const a of argv) {
        if (a === '--apply') args.apply = true
        else if (a === '--dry-run') args.apply = false
        else if (a === '--solo-mancanti') args.onlyMissing = true
        else if (a.startsWith('--da=')) args.from = a.slice(5)
        else if (a.startsWith('--mesi=')) args.months = Number(a.slice(7))
        else if (a.startsWith('--seme=')) args.seed = a.slice(7)
        else if (a.startsWith('--chiusi=')) args.closed = a.slice(9).split(',').map(s => s.trim()).filter(Boolean)
        else if (a.startsWith('--out=')) args.out = a.slice(6)
        else if (a.startsWith('--')) throw new Error(`Opzione sconosciuta: ${a}`)
        else args.folder = a
    }
    if (!args.folder) throw new Error('Manca la cartella dei JSON verificati.')
    if (!isValidDay(args.from)) throw new Error(`--da non valido: ${args.from}`)
    if (!Number.isInteger(args.months) || args.months < 1 || args.months > 36) throw new Error('--mesi tra 1 e 36')
    const badClosed = args.closed.filter(d => !isValidDay(d))
    if (badClosed.length) throw new Error(`--chiusi non validi: ${badClosed.join(', ')}`)
    return args
}

const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

type ExistingQuote = {
    id: string; kind: string; text: string; author: string; work: string | null; reference: string | null
    translationUrl: string | null; translator: string | null; theme: string | null; occasions: string[]
    roles: string[]; suggestedReflection: string | null; reflectionSource: string | null; verified: boolean
    isActive: boolean; technique?: string | null; usage?: string | null; originalText?: string | null
}

/** La migrazione 0046 c'è se la colonna technique si può leggere. */
async function hasMigration0046(): Promise<boolean> {
    try {
        await db.select({ t: dailyQuotes.technique }).from(dailyQuotes).limit(1)
        return true
    } catch {
        return false
    }
}

async function readExistingQuotes(withNewColumns: boolean): Promise<ExistingQuote[]> {
    const base = {
        id: dailyQuotes.id, kind: dailyQuotes.kind, text: dailyQuotes.text, author: dailyQuotes.author,
        work: dailyQuotes.work, reference: dailyQuotes.reference, translationUrl: dailyQuotes.translationUrl,
        translator: dailyQuotes.translator, theme: dailyQuotes.theme, occasions: dailyQuotes.occasions,
        roles: dailyQuotes.roles, suggestedReflection: dailyQuotes.suggestedReflection,
        reflectionSource: dailyQuotes.reflectionSource, verified: dailyQuotes.verified, isActive: dailyQuotes.isActive,
    }
    if (!withNewColumns) return db.select(base).from(dailyQuotes)
    return db.select({
        ...base, technique: dailyQuotes.technique, usage: dailyQuotes.usage, originalText: dailyQuotes.originalText,
    }).from(dailyQuotes)
}

const COMPARED: (keyof QuoteImportRow)[] = [
    'kind', 'text', 'author', 'work', 'reference', 'translationUrl', 'translator', 'theme', 'occasions', 'roles',
    'suggestedReflection', 'reflectionSource', 'technique', 'usage', 'originalText',
]

function sameQuote(row: QuoteImportRow, ex: ExistingQuote): boolean {
    return COMPARED.every(k => JSON.stringify(row[k] ?? null) === JSON.stringify((ex as Record<string, unknown>)[k] ?? null))
        && ex.verified === true
}

function toScheduleQuote(q: { id: string; author: string; theme: string | null; text: string; technique?: string | null; occasions: string[]; roles: string[] }): ScheduleQuote {
    return { id: q.id, author: q.author, theme: q.theme, text: q.text, technique: q.technique ?? null, occasions: q.occasions, roles: q.roles }
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const today = toRomeDateStr(new Date())

    // ── 1. lettura dei file ──
    const files = readdirSync(args.folder).filter(f => f.toLowerCase().endsWith('.json')).sort()
    if (files.length === 0) throw new Error(`Nessun .json in ${args.folder}`)
    const rows = new Map<string, QuoteImportRow>()
    const rejected = new Map<string, { count: number; examples: string[] }>()
    const warnings = new Map<string, number>()
    let total = 0
    let duplicates = 0
    for (const f of files) {
        const path = join(args.folder, f)
        if (!statSync(path).isFile()) continue
        const items = collectItems(JSON.parse(readFileSync(path, 'utf8')))
        for (const item of items) {
            total++
            const r = parseImportItem(item)
            if (!r.ok) {
                const entry = rejected.get(r.reason) ?? { count: 0, examples: [] }
                entry.count++
                const o = item as Record<string, unknown>
                if (entry.examples.length < 3) entry.examples.push(`${f}: ${short(String(o?.testo ?? o?.frase ?? o?.tecnica ?? '?'), 60)}`)
                rejected.set(r.reason, entry)
                continue
            }
            for (const w of r.warnings) warnings.set(w, (warnings.get(w) ?? 0) + 1)
            if (rows.has(r.row.id)) {
                duplicates++
                continue
            }
            rows.set(r.row.id, r.row)
        }
    }
    const input = [...rows.values()]
    const nCit = input.filter(r => r.kind === 'citazione').length
    const nVen = input.filter(r => r.kind === 'vendita').length
    console.log(`Lettura: ${files.length} file, ${total} elementi`)
    console.log(`  verificati e validi: ${nCit} citazioni, ${nVen} consigli di vendita${duplicates ? ` (${duplicates} doppioni ignorati)` : ''}`)
    if (rejected.size) {
        console.log(`  scartati: ${[...rejected.values()].reduce((s, e) => s + e.count, 0)}`)
        for (const [reason, e] of [...rejected].sort((a, b) => b[1].count - a[1].count)) {
            console.log(`    ${e.count} × ${reason}  (es. ${e.examples.join(' | ')})`)
        }
    }
    if (warnings.size) {
        console.log('  avvisi:')
        for (const [w, n] of [...warnings].sort((a, b) => b[1] - a[1])) console.log(`    ${n} × ${w}`)
    }

    // ── 2. confronto col database ──
    const migrated = await hasMigration0046()
    if (!migrated) {
        console.log('\nATTENZIONE: migrazione 0046 non applicata (colonne technique, usage, originalText).')
        if (args.apply) throw new Error('Applicare drizzle/migrations/0048_citazioni_tecnica.sql prima di --apply.')
    }
    const existing = await readExistingQuotes(migrated)
    const existingById = new Map(existing.map(q => [q.id, q]))
    const toInsert = input.filter(r => !existingById.has(r.id))
    const toUpdate = input.filter(r => existingById.has(r.id) && !sameQuote(r, existingById.get(r.id)!))
    console.log(`\nDatabase: ${existing.length} citazioni presenti; da inserire ${toInsert.length}, da aggiornare ${toUpdate.length}, uguali ${input.length - toInsert.length - toUpdate.length}`)

    // Pool del calendario = come sarà il database dopo l'import (attive e verificate).
    const pool = new Map<string, { id: string; kind: string; author: string; theme: string | null; text: string; technique?: string | null; occasions: string[]; roles: string[]; isActive: boolean; verified: boolean }>()
    for (const q of existing) pool.set(q.id, q)
    for (const r of input) pool.set(r.id, { ...r, isActive: existingById.get(r.id)?.isActive ?? true })

    // ── 3. calendario ──
    const [closedRow] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, QUOTES_CLOSED_DAYS_KEY)).limit(1)
    const savedClosed = parseClosedDays(closedRow?.value)
    const closed = [...new Set([...savedClosed, ...args.closed])].sort()
    const from = args.from > today ? args.from : today
    const to = addDays(addMonths(args.from, args.months), -1)
    if (from > to) throw new Error(`Il calendario (fino al ${to}) è già tutto nel passato.`)

    const schedule = await db.select().from(dailyQuoteSchedule)
    console.log(`\nCalendario dal ${from} al ${to}${closed.length ? `, chiusure: ${closed.join(', ')}` : ''}`)
    if (args.from < today) console.log(`  (i giorni prima di oggi, ${today}, non si toccano)`)

    const plan: { kind: QuoteKind; days: ScheduledDay[]; writes: ScheduledDay[]; stale: string[] }[] = []
    for (const kind of ['citazione', 'vendita'] as const) {
        const rules = kind === 'citazione' ? CITAZIONE_RULES : VENDITA_RULES
        const quotes = [...pool.values()].filter(q => q.kind === kind && q.isActive && q.verified).map(toScheduleQuote)
        const mine = schedule.filter(s => s.kind === kind)
        const history = mine.filter(s => s.day < from).map(s => ({ day: s.day, quoteId: s.quoteId }))
        const locked: Record<string, string> = {}
        for (const s of mine) {
            if (s.day < from || s.day > to) continue
            // Mai sovrascritti: i giorni approvati, quello di oggi se c'è già e, con
            // --solo-mancanti, tutti quelli già in calendario.
            if (s.approved || s.day === today || args.onlyMissing) locked[s.day] = s.quoteId
        }
        const days = generateSchedule({ quotes, from, to, seed: `${args.seed}|${kind}`, rules, closedDays: closed, locked, history })
        const existingByDay = new Map(mine.map(s => [s.day, s]))
        const writes = days.filter(d => !d.locked && d.quoteId !== null && existingByDay.get(d.day)?.quoteId !== d.quoteId)
        const generatedDays = new Set(days.map(d => d.day))
        // Righe non approvate su giorni che non sono più lavorativi (es. chiusure nuove).
        const stale = mine.filter(s => s.day >= from && s.day <= to && !s.approved && s.day !== today && !generatedDays.has(s.day)).map(s => s.day)
        plan.push({ kind, days, writes, stale })

        const lockedCount = days.filter(d => d.locked).length
        const empty = days.filter(d => d.quoteId === null).length
        const relaxed = days.filter(d => d.relaxed.length > 0)
        const violations = auditSchedule([...history.slice(-15), ...days], quotes, rules)
            .filter(v => v.day >= from)
        const occasions: Record<string, number> = {}
        for (const d of days) if (d.occasion) occasions[d.occasion] = (occasions[d.occasion] ?? 0) + 1
        const used = new Set(days.map(d => d.quoteId))
        console.log(`  ${kind}: ${days.length} giorni con ${quotes.length} in archivio; bloccati ${lockedCount}, da scrivere ${writes.length}, invariati ${days.length - lockedCount - writes.length - empty}${empty ? `, vuoti ${empty}` : ''}${stale.length ? `, da togliere ${stale.length}` : ''}`)
        console.log(`    giri del pool: ${Math.max(0, ...days.map(d => d.cycle)) + 1}; vincoli allentati in ${relaxed.length} giorni; violazioni ${violations.length}`)
        for (const r of relaxed.slice(0, 5)) console.log(`      ${r.day}: ${r.relaxed.join(', ')}`)
        if (kind === 'citazione') {
            console.log(`    occasioni onorate: ${Object.entries(occasions).map(([k, v]) => `${k} ${v}`).join(', ') || 'nessuna'}`)
            const unusedTagged: Record<string, number> = {}
            for (const q of quotes) if (!used.has(q.id)) for (const o of q.occasions ?? []) unusedTagged[o] = (unusedTagged[o] ?? 0) + 1
            if (Object.keys(unusedTagged).length) {
                console.log(`    citazioni a tema non usate nel periodo (troppe per i giorni dell'occasione): ${Object.entries(unusedTagged).map(([k, v]) => `${k} ${v}`).join(', ')}`)
            }
        } else {
            for (const role of ['GDO', 'CONFERME', 'VENDITORE']) {
                let gap = 0, worst = 0, covered = 0
                for (const d of days) {
                    const has = !!d.quoteId && !!quotes.find(q => q.id === d.quoteId)?.roles?.includes(role)
                    if (has) covered++
                    gap = has ? 0 : gap + 1
                    worst = Math.max(worst, gap)
                }
                console.log(`    ${role}: consiglio in ${covered}/${days.length} giorni, al massimo ${worst} di fila senza`)
            }
        }
    }

    // Anteprima delle prime due settimane.
    console.log('\nPrime due settimane:')
    const [cit, ven] = plan
    for (let i = 0; i < Math.min(14, cit.days.length); i++) {
        const c = pool.get(cit.days[i].quoteId ?? '')
        const v = pool.get(ven.days.find(d => d.day === cit.days[i].day)?.quoteId ?? '')
        console.log(`  ${cit.days[i].day}  ${c ? `${c.author}: ${short(c.text, 60)}` : '(vuoto)'}`)
        if (v) console.log(`              vendita, ${v.author}: ${short(v.text || v.technique || '', 60)}`)
    }

    if (args.out) {
        const dump = plan.flatMap(p => p.days.map(d => ({
            kind: p.kind, ...d,
            author: pool.get(d.quoteId ?? '')?.author ?? null,
            text: pool.get(d.quoteId ?? '')?.text ?? null,
        })))
        writeFileSync(args.out, JSON.stringify(dump, null, 2))
        console.log(`\nCalendario scritto in ${args.out}`)
    }

    if (!args.apply) {
        console.log('\nProva: nessuna scrittura. Per scrivere aggiungere --apply.')
        return
    }

    // ── 4. scrittura ──
    await db.transaction(async (tx) => {
        const upserts = [...toInsert, ...toUpdate]
        for (let i = 0; i < upserts.length; i += 200) {
            const batch = upserts.slice(i, i + 200)
            await tx.insert(dailyQuotes).values(batch).onConflictDoUpdate({
                target: dailyQuotes.id,
                set: {
                    kind: sql`excluded."kind"`, text: sql`excluded."text"`, author: sql`excluded."author"`,
                    work: sql`excluded."work"`, reference: sql`excluded."reference"`,
                    translationUrl: sql`excluded."translationUrl"`, translator: sql`excluded."translator"`,
                    theme: sql`excluded."theme"`, occasions: sql`excluded."occasions"`, roles: sql`excluded."roles"`,
                    suggestedReflection: sql`excluded."suggestedReflection"`, reflectionSource: sql`excluded."reflectionSource"`,
                    technique: sql`excluded."technique"`, usage: sql`excluded."usage"`, originalText: sql`excluded."originalText"`,
                    verified: true,
                },
            })
        }
        for (const p of plan) {
            const values = p.writes.map(d => ({ day: d.day, kind: p.kind, quoteId: d.quoteId!, reflection: null, approved: false }))
            for (let i = 0; i < values.length; i += 200) {
                await tx.insert(dailyQuoteSchedule).values(values.slice(i, i + 200)).onConflictDoUpdate({
                    target: [dailyQuoteSchedule.day, dailyQuoteSchedule.kind],
                    set: {
                        quoteId: sql`excluded."quoteId"`,
                        // stessa citazione: la bozza dell'admin resta; citazione nuova: si riparte da zero
                        reflection: sql`case when ${dailyQuoteSchedule.quoteId} = excluded."quoteId" then ${dailyQuoteSchedule.reflection} else null end`,
                        approved: false, approvedBy: null, approvedAt: null,
                    },
                    // i giorni approvati non si toccano, nemmeno se approvati mentre lo script girava
                    setWhere: eq(dailyQuoteSchedule.approved, false),
                })
            }
            if (p.stale.length) {
                await tx.delete(dailyQuoteSchedule).where(and(
                    eq(dailyQuoteSchedule.kind, p.kind),
                    inArray(dailyQuoteSchedule.day, p.stale),
                    eq(dailyQuoteSchedule.approved, false),
                ))
            }
        }
        if (args.closed.length) {
            const value = JSON.stringify(closed)
            await tx.insert(appSettings).values({ key: QUOTES_CLOSED_DAYS_KEY, value, updatedBy: 'citazioni-import', updatedAt: new Date() })
                .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: 'citazioni-import', updatedAt: new Date() } })
        }
    })
    console.log(`\nScritto: ${toInsert.length + toUpdate.length} citazioni, ${plan.reduce((s, p) => s + p.writes.length, 0)} giorni di calendario${plan.some(p => p.stale.length) ? `, tolti ${plan.reduce((s, p) => s + p.stale.length, 0)} giorni non più lavorativi` : ''}.`)
    console.log('Le schermate lo vedono entro 15 minuti (cache del giorno).')
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
})
