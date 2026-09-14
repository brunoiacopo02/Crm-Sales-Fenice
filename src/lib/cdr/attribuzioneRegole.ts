/**
 * Regole pure dell'attribuzione interno → persona (niente database qui, cosi'
 * si testano da sole). La parte che legge e scrive sta in `attribuzione.ts`.
 *
 * Un'"ancora" e' un (interno, giorno) in cui si sa con certezza chi stava alla
 * postazione: ha scritto gli esiti sui numeri chiamati da quell'interno.
 */

/** Oltre questa distanza da un'ancora un giorno resta senza attribuzione. */
export const FINESTRA_GIORNI = 10
/** Il dominante deve valere almeno questa quota degli agganci del giorno. */
export const QUOTA_MINIMA = 0.6
/** Sotto questo numero di agganci il giorno non fa da ancora. */
export const AGGANCI_MINIMI = 3

export type ChiaveGiorno = string // `${interno}|${YYYY-MM-DD}`

export const chiaveGiorno = (src: string, dateLocal: string): ChiaveGiorno => `${src}|${dateLocal}`

const mezzogiornoMs = (d: string) => Date.parse(`${d}T12:00:00Z`)

/**
 * Mappa completa (interno, giorno) → utente: agganci diretti piu' eredita'.
 * `giorni` e' l'elenco dei giorni-postazione presenti nei tabulati. I giorni
 * senza ancora entro FINESTRA_GIORNI non compaiono nella mappa.
 */
export function estendiAncore(
    ancore: Map<ChiaveGiorno, string>,
    giorni: { src: string; dateLocal: string }[],
): Map<ChiaveGiorno, string> {
    const perInterno = new Map<string, { d: string; ms: number; user: string }[]>()
    for (const [k, user] of ancore) {
        const [src, d] = k.split('|')
        const list = perInterno.get(src) ?? []
        list.push({ d, ms: mezzogiornoMs(d), user })
        perInterno.set(src, list)
    }
    for (const list of perInterno.values()) list.sort((a, b) => a.ms - b.ms)

    const finestraMs = FINESTRA_GIORNI * 86400_000
    const mappa = new Map<ChiaveGiorno, string>(ancore)
    for (const g of giorni) {
        const k = chiaveGiorno(g.src, g.dateLocal)
        if (mappa.has(k)) continue
        const list = perInterno.get(g.src)
        if (!list) continue
        const ms = mezzogiornoMs(g.dateLocal)
        let best: { dist: number; user: string } | null = null
        for (const a of list) {
            const dist = Math.abs(a.ms - ms)
            if (dist > finestraMs) continue
            // A parita' di distanza vince l'ancora piu' vecchia (la lista e'
            // ordinata per data), cosi' il risultato non dipende dall'ordine
            // in cui le ancore sono arrivate dal database.
            if (!best || dist < best.dist) best = { dist, user: a.user }
        }
        if (best) mappa.set(k, best.user)
    }
    return mappa
}

/**
 * Disposizione piu' recente delle scrivanie: per ogni interno, l'utente
 * dell'ancora DIRETTA piu' recente. Serve a `pbxExtensions`, che il prossimo
 * import legge per timbrare le chiamate nuove.
 */
export function ultimaDisposizione(ancore: Map<ChiaveGiorno, string>): Map<string, string> {
    const ultima = new Map<string, { d: string; user: string }>()
    for (const [k, user] of ancore) {
        const [src, d] = k.split('|')
        const cur = ultima.get(src)
        if (!cur || d > cur.d) ultima.set(src, { d, user })
    }
    return new Map([...ultima].map(([src, v]) => [src, v.user]))
}
