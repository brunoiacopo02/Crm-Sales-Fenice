// Formato dei JSON verificati di citazioni e consigli di vendita e conversione
// nelle righe di dailyQuotes. Funzioni pure: le usa lo script
// scripts/diretta/citazioni-import.ts.
//
// Entrano solo gli elementi con `verified: true` (booleano) e con le fonti:
// una citazione senza URL della traduzione italiana si scarta (le traduzioni
// non le fanno gli agenti), una riflessione senza fonte pure.

import { createHash } from 'node:crypto'
import { KNOWN_OCCASIONS } from './calendar'
import { countLines, REFLECTION_MAX_LINES } from './display'

/** Una citazione più lunga non sta in due righe. */
export const QUOTE_MAX_CHARS = 200
/** Stessi ruoli del default della colonna dailyQuotes.roles. */
export const DEFAULT_QUOTE_ROLES = ['GDO', 'CONFERME', 'VENDITORE', 'ADMIN', 'MANAGER']

const ROLE_MAP: Record<string, string> = { gdo: 'GDO', conferme: 'CONFERME', venditori: 'VENDITORE', venditore: 'VENDITORE' }
const ROLE_ORDER = ['GDO', 'CONFERME', 'VENDITORE', 'ADMIN']
const USAGES = new Set(['applica', 'riconosci_e_difenditi'])

export interface QuoteImportRow {
    id: string
    kind: 'citazione' | 'vendita'
    text: string
    author: string
    work: string | null
    reference: string | null
    translationUrl: string | null
    translator: string | null
    theme: string | null
    occasions: string[]
    roles: string[]
    suggestedReflection: string | null
    reflectionSource: string | null
    technique: string | null
    usage: string | null
    originalText: string | null
    verified: true
}

export type ParseResult =
    | { ok: true; row: QuoteImportRow; warnings: string[] }
    | { ok: false; reason: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const oneLine = (s: string) => s.replace(/\s+/g, ' ')
const orNull = (s: string): string | null => (s ? s : null)
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s)
const fail = (reason: string): ParseResult => ({ ok: false, reason })
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Id stabile: rifare l'import con gli stessi file aggiorna le righe invece di duplicarle. */
export function quoteIdFor(kind: 'citazione' | 'vendita', author: string, key: string): string {
    const hash = createHash('sha1').update(`${kind}|${norm(author)}|${norm(key)}`).digest('hex').slice(0, 16)
    return `${kind === 'citazione' ? 'cit' : 'ven'}_${hash}`
}

/** Il file può essere un array o un oggetto con dentro l'array. */
export function collectItems(json: unknown): unknown[] {
    if (Array.isArray(json)) return json
    if (json && typeof json === 'object') {
        for (const v of Object.values(json)) if (Array.isArray(v)) return v
    }
    return []
}

/** gdo/conferme/venditori → ruoli del CRM, più ADMIN che approva e vede tutto. */
export function mapRoles(ruoli: unknown): { ok: true; roles: string[] } | { ok: false; reason: string } {
    if (!Array.isArray(ruoli) || ruoli.length === 0) return { ok: false, reason: 'ruoli mancanti' }
    const out = new Set<string>(['ADMIN'])
    for (const r of ruoli) {
        const mapped = ROLE_MAP[str(r).toLowerCase()]
        if (!mapped) return { ok: false, reason: `ruolo sconosciuto: ${String(r)}` }
        out.add(mapped)
    }
    return { ok: true, roles: ROLE_ORDER.filter(r => out.has(r)) }
}

function parseOccasions(v: unknown, warnings: string[]): string[] {
    if (v === undefined || v === null) return []
    if (!Array.isArray(v)) {
        warnings.push('occasioni non in elenco: ignorate')
        return []
    }
    const out: string[] = []
    for (const x of v) {
        const k = str(x).toLowerCase()
        if (KNOWN_OCCASIONS.has(k)) {
            if (!out.includes(k)) out.push(k)
        } else {
            warnings.push(`occasione sconosciuta scartata: ${String(x)}`)
        }
    }
    return out
}

function parseCitazione(o: Record<string, unknown>): ParseResult {
    const warnings: string[] = []
    const text = oneLine(str(o.testo))
    const author = str(o.autore)
    const work = str(o.fonte) || str(o.opera)
    const url = str(o.traduzione_fonte_url)
    if (!text) return fail('testo mancante')
    if (text.length > QUOTE_MAX_CHARS) return fail(`testo di ${text.length} caratteri: non sta in 2 righe`)
    if (!author) return fail('autore mancante')
    if (!work) return fail('opera mancante')
    if (!isUrl(url)) return fail('URL della traduzione mancante')
    const theme = str(o.tema)
    if (!theme) warnings.push('tema mancante')

    let suggestedReflection = orNull(str(o.riflessione))
    let reflectionSource = orNull(str(o.riflessione_fonte_url))
    if (!suggestedReflection) {
        reflectionSource = null
    } else if (!reflectionSource || !isUrl(reflectionSource)) {
        warnings.push('riflessione scartata: manca la fonte')
        suggestedReflection = null
        reflectionSource = null
    } else if (countLines(suggestedReflection) > REFLECTION_MAX_LINES) {
        warnings.push('riflessione oltre 10 righe: da accorciare in approvazione')
    }

    return {
        ok: true,
        warnings,
        row: {
            id: quoteIdFor('citazione', author, text),
            kind: 'citazione',
            text,
            author,
            work,
            reference: orNull(str(o.riferimento)),
            translationUrl: url,
            translator: orNull(str(o.traduttore)),
            theme: orNull(theme),
            occasions: parseOccasions(o.occasioni, warnings),
            roles: [...DEFAULT_QUOTE_ROLES],
            suggestedReflection,
            reflectionSource,
            technique: null,
            usage: null,
            originalText: orNull(str(o.originale)),
            verified: true,
        },
    }
}

function parseVendita(o: Record<string, unknown>): ParseResult {
    const warnings: string[] = []
    const phrase = oneLine(str(o.frase))
    const author = str(o.autore)
    const work = str(o.opera)
    const technique = str(o.tecnica)
    const advice = str(o.consiglio)
    const phraseUrl = str(o.frase_fonte_url)
    const adviceUrl = str(o.fonte_consiglio_url)
    if (!author) return fail('autore mancante')
    if (!work) return fail('opera mancante')
    if (!phrase && !technique) return fail('né frase né tecnica')
    if (phrase && !isUrl(phraseUrl)) return fail('frase senza URL della fonte')
    if (!advice) return fail('consiglio mancante')
    if (!isUrl(adviceUrl)) return fail('consiglio senza URL della fonte')
    const roles = mapRoles(o.ruoli)
    if (!roles.ok) return fail(roles.reason)
    const theme = str(o.tema)
    if (!theme) warnings.push('tema mancante')
    const usage = str(o.uso)
    if (usage && !USAGES.has(usage)) warnings.push(`uso sconosciuto: ${usage}`)
    if (phrase.length > QUOTE_MAX_CHARS) warnings.push(`frase di ${phrase.length} caratteri: lunga per lo spazio del consiglio`)
    if (countLines(advice) > REFLECTION_MAX_LINES) warnings.push('consiglio oltre 10 righe: da accorciare in approvazione')

    return {
        ok: true,
        warnings,
        row: {
            id: quoteIdFor('vendita', author, `${phrase}|${technique}`),
            kind: 'vendita',
            text: phrase,
            author,
            work,
            reference: orNull(str(o.riferimento)),
            translationUrl: isUrl(phraseUrl) ? phraseUrl : null,
            translator: orNull(str(o.traduttore)),
            theme: orNull(theme),
            occasions: [],
            roles: roles.roles,
            suggestedReflection: advice,
            reflectionSource: adviceUrl,
            technique: orNull(technique),
            usage: USAGES.has(usage) ? usage : null,
            originalText: null,
            verified: true,
        },
    }
}

export function parseImportItem(raw: unknown): ParseResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('non è un oggetto')
    const o = raw as Record<string, unknown>
    if (o.verified !== true) return fail('non verificata')
    if ('testo' in o) return parseCitazione(o)
    if ('frase' in o || 'consiglio' in o) return parseVendita(o)
    return fail('formato sconosciuto')
}
