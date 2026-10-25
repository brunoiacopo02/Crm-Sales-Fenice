// Nome del funnel da mostrare nella Diretta (collaudo del 25/10/2026).
//
// Nel DB i funnel sono scritti in mille modi ('CORSO 10 ORE', 'corso10ore',
// 'CORSO10ORE-TK', 'JOB SIMULATOR', 'jobsimulator'...) e quasi sempre in
// maiuscolo. Lo stile Fenice vuole il caso frase: qui si traducono i nomi
// noti e per gli altri si scrive la prima lettera maiuscola, lasciando in
// maiuscolo solo le sigle corte (AI, TK, BF, SMM).

const NOTI: Record<string, string> = {
    CORSO10ORE: 'Corso 10 ore',
    CORSO10H: 'Corso 10 ore',
    'CORSO10ORE-TK': 'Corso 10 ore TK',
    JOBSIMULATOR: 'Job Simulator',
    TELEGRAM: 'Telegram',
    'TELEGRAM-TK': 'Telegram TK',
    SOCIAL: 'Social',
    GOOGLE: 'Google',
    DATABASE: 'Database',
    SCONOSCIUTO: 'Sconosciuto',
    BLACKSUMMER: 'Black Summer',
    BLACKFRIDAY: 'Black Friday',
    LANCIOWEBDEVAI: 'Lancio Web Dev AI',
    LANCIODATAANALYST: 'Lancio Data Analyst',
    FUORIFUNNEL: 'Fuori funnel',
    INBOUND: 'Inbound',
    ORG: 'Org',
}

/** Chiave di confronto: maiuscolo, senza spazi né punti. */
function chiave(funnel: string): string {
    return funnel.toUpperCase().replace(/[\s.]+/g, '')
}

/** Caso frase: prima lettera maiuscola, il resto minuscolo, le sigle di 2-3 lettere restano sigle. */
function casoFrase(testo: string): string {
    const parole = testo.trim().split(/\s+/)
    return parole.map((p, i) => {
        if (/^[A-Z]{2,3}$/.test(p)) return p
        const minuscola = p.toLowerCase()
        return i === 0 ? minuscola.charAt(0).toUpperCase() + minuscola.slice(1) : minuscola
    }).join(' ')
}

/** Il funnel in chiaro, oppure null se non c'è. */
export function funnelLeggibile(funnel: string | null | undefined): string | null {
    const f = funnel?.trim()
    if (!f) return null
    const noto = NOTI[chiave(f)]
    if (noto) return noto
    // "TELEGRAM 02/06/2025": il nome noto più il resto com'è.
    const [primo, ...resto] = f.split(/\s+/)
    const notoPrimo = NOTI[chiave(primo)]
    if (notoPrimo && resto.length > 0) return `${notoPrimo} ${resto.join(' ')}`
    return casoFrase(f)
}
