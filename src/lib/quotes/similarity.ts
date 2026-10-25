// Similarità testuale semplice tra due citazioni, per non metterne di troppo
// simili a pochi giorni di distanza: Jaccard sui "lemmi" normalizzati
// (minuscole, senza accenti, senza parole vuote, desinenze tolte alla buona).
// Non è semantica: serve a riconoscere la stessa frase scritta in due modi.

const STOPWORDS = new Set([
    // articoli e preposizioni (anche articolate)
    'il', 'lo', 'la', 'gli', 'le', 'uno', 'una', 'del', 'dello', 'della', 'dei', 'degli', 'delle',
    'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle',
    'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle',
    'col', 'coi', 'con', 'per', 'tra', 'fra', 'verso', 'senza', 'sopra', 'sotto',
    // congiunzioni e avverbi frequenti
    'che', 'chi', 'cui', 'non', 'anche', 'pero', 'perche', 'poiche', 'quando', 'mentre', 'dunque',
    'quindi', 'oppure', 'neanche', 'neppure', 'nemmeno', 'come', 'dove', 'cosi', 'piu', 'meno',
    'molto', 'molta', 'molti', 'molte', 'poco', 'poca', 'pochi', 'poche', 'tanto', 'tanta', 'tanti',
    'tante', 'troppo', 'sempre', 'mai', 'gia', 'ancora', 'solo', 'soltanto', 'tutto', 'tutta',
    'tutti', 'tutte', 'bene', 'male', 'quasi', 'proprio', 'allora', 'ogni', 'qui', 'qua',
    // pronomi e possessivi
    'noi', 'voi', 'lui', 'lei', 'loro', 'mio', 'mia', 'miei', 'mie', 'tuo', 'tua', 'tuoi', 'tue',
    'suo', 'sua', 'suoi', 'sue', 'nostro', 'nostra', 'nostri', 'nostre', 'vostro', 'vostra', 'vostri',
    'vostre', 'questo', 'questa', 'questi', 'queste', 'quello', 'quella', 'quelli', 'quelle', 'quel',
    'cio', 'quale', 'quali', 'qualcuno', 'qualcosa', 'niente', 'nulla', 'ognuno', 'altro', 'altra',
    'altri', 'altre', 'stesso', 'stessa', 'stessi', 'stesse', 'esso', 'essa', 'essi', 'esse', 'chiunque',
    // essere e avere
    'sono', 'sei', 'siamo', 'siete', 'era', 'erano', 'fu', 'furono', 'sara', 'saranno', 'sia', 'siano',
    'essere', 'stato', 'stata', 'stati', 'state', 'hai', 'abbiamo', 'avete', 'hanno', 'avere', 'aveva',
    'avevano', 'avra', 'avranno', 'abbia', 'abbiano',
])

/** Radice alla buona: via la vocale finale (e la "h" di -che/-chi/-ghe/-ghi) dalle parole lunghe. */
function stem(w: string): string {
    if (w.length <= 4) return w
    if (/(ch|gh)[ei]$/.test(w)) return w.slice(0, -2)
    if (/[aeiou]$/.test(w)) return w.slice(0, -1)
    return w
}

export function lemmas(text: string): Set<string> {
    const norm = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
    const out = new Set<string>()
    for (const w of norm.split(' ')) {
        if (w.length < 3 || STOPWORDS.has(w)) continue
        out.add(stem(w))
    }
    return out
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
    if (a.size === 0 || b.size === 0) return 0
    let shared = 0
    for (const x of a) if (b.has(x)) shared++
    return shared / (a.size + b.size - shared)
}

/**
 * Soglia di Jaccard oltre la quale due frasi sono "troppo simili". Tarata sulle
 * bozze del 25/10/2026 (520 citazioni): a 0,3 con due lemmi in comune cadono
 * solo 4 coppie, tutte davvero ripetitive (es. Confucio "il signore… il volgo").
 */
export const SIMILARITY_THRESHOLD = 0.3
/** Almeno due lemmi in comune: con frasi brevi una parola sola darebbe falsi allarmi. */
const MIN_SHARED = 2

export function tooSimilar(a: ReadonlySet<string>, b: ReadonlySet<string>, threshold = SIMILARITY_THRESHOLD): boolean {
    let shared = 0
    for (const x of a) if (b.has(x)) shared++
    if (shared < MIN_SHARED) return false
    return jaccard(a, b) >= threshold
}
