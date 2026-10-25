// Pagina Squadra della Diretta (ex classifica, PO 25/10/2026). Funzioni pure:
// conteggi, ordinamenti e la vista che arriva al browser. La modalità
// (appSettings 'leaderboard_mode') decide anche QUALI dati partono dal server:
// in 'top3' chi guarda non riceve le presenze degli altri, così la sua
// posizione non si ricava nemmeno aprendo la rete del browser.

export type LeaderboardMode = 'top3' | 'completa' | 'nessuna'
export const LEADERBOARD_MODE_KEY = 'leaderboard_mode'

export function parseLeaderboardMode(raw: string | null | undefined): LeaderboardMode {
    const v = (raw ?? '').trim()
    return v === 'completa' || v === 'nessuna' ? v : 'top3'
}

export interface FissatoRow { userId: string | null; leadId: string; createdAt: string | Date }

/**
 * "Fissato" = lead distinto con callLog APPUNTAMENTO nel periodo [start, end).
 * La squadra conta i lead distinti di tutti; la persona i suoi.
 */
export function contaFissati(rows: FissatoRow[], start: Date, end: Date): { totale: number; perUtente: Record<string, number> } {
    const s = start.getTime()
    const e = end.getTime()
    const squadra = new Set<string>()
    const perUtente = new Map<string, Set<string>>()
    for (const r of rows) {
        if (!r.userId) continue
        const t = new Date(r.createdAt).getTime()
        if (t < s || t >= e) continue
        squadra.add(r.leadId)
        let set = perUtente.get(r.userId)
        if (!set) { set = new Set(); perUtente.set(r.userId, set) }
        set.add(r.leadId)
    }
    return { totale: squadra.size, perUtente: Object.fromEntries([...perUtente].map(([k, v]) => [k, v.size])) }
}

export interface MembroSquadra {
    id: string
    nome: string
    presenze: number
    fissati: number
    immagine: string | null
    cornice: boolean
    titolo: string | null
}

const perNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })

/** Presenze della settimana, a pari presenze i fissati, poi il nome. */
export function ordinaClassifica(membri: MembroSquadra[]): MembroSquadra[] {
    return [...membri].sort((a, b) => (b.presenze - a.presenze) || (b.fissati - a.fissati) || perNome(a, b))
}

/** Il podio: i primi tre con almeno una presenza. */
export function primiTre(ordinati: MembroSquadra[]): MembroSquadra[] {
    return ordinati.filter(x => x.presenze > 0).slice(0, 3)
}

/**
 * Presenze che servono a chi guarda per superare chi gli sta subito sopra.
 * null se non è in squadra, se è sul podio o se il podio è ancora vuoto.
 * Si conta un'unità in più del distacco: a pari presenze l'ordine dipende dai
 * fissati, e la frase deve restare vera qualunque cosa succeda.
 */
export function mancaPerSalire(ordinati: MembroSquadra[], viewerId: string): number | null {
    const idx = ordinati.findIndex(x => x.id === viewerId)
    if (idx <= 0) return null
    const podio = primiTre(ordinati)
    if (podio.length === 0 || podio.some(x => x.id === viewerId)) return null
    return Math.max(1, ordinati[idx - 1].presenze - ordinati[idx].presenze + 1)
}

/** Chi ha superato la soglia di presenze della settimana, in ordine alfabetico. */
export function feniciDellaSettimana(membri: MembroSquadra[], soglia: number): MembroSquadra[] {
    return membri.filter(x => x.presenze > soglia).sort(perNome)
}

/**
 * Barra a blocchi: un blocco ogni `unita` fissati (5 sopra i 20, altrimenti 1),
 * ogni blocco pieno da 0 a 1. primoScalinoIndex è il blocco che chiude il
 * primo scalino.
 */
export function blocchiSquadra(valore: number, scalini: [number, number], unita?: number): { blocchi: number[]; primoScalinoIndex: number; unita: number } {
    const u = unita ?? (scalini[1] <= 20 ? 1 : 5)
    const n = Math.max(1, Math.ceil(scalini[1] / u))
    const blocchi = Array.from({ length: n }, (_, i) => {
        const pieno = Math.min(Math.max(valore - i * u, 0), u) / u
        return Math.round(pieno * 100) / 100
    })
    return { blocchi, primoScalinoIndex: Math.max(0, Math.ceil(scalini[0] / u) - 1), unita: u }
}

export function fraseScalini(valore: number, scalini: [number, number]): string {
    const [primo, secondo] = scalini
    if (valore >= secondo) return 'Secondo scalino raggiunto.'
    if (valore >= primo) {
        const k = secondo - valore
        return `Primo scalino raggiunto, ${k === 1 ? 'manca 1' : `mancano ${k}`} al secondo.`
    }
    const k = primo - valore
    return `${k === 1 ? 'Manca 1' : `Mancano ${k}`} al primo scalino.`
}

export function fasePunta(now: Date, start: Date, end: Date): 'prima' | 'durante' | 'dopo' {
    const t = now.getTime()
    if (t < start.getTime()) return 'prima'
    if (t < end.getTime()) return 'durante'
    return 'dopo'
}

// ── Vista ────────────────────────────────────────────────────────────────

export interface PuntaSnapshot { start: string; end: string; count: number; scalini: [number, number] }

/** Quello che calcola il server (in cache per 20 s), uguale per tutti. */
export interface SquadraSnapshot {
    day: string
    squadraOggi: number
    scaliniSquadra: [number, number]
    punta: PuntaSnapshot | null
    sogliaFenici: number
    mode: LeaderboardMode
    membri: MembroSquadra[]
}

export interface PersonaRow { id: string; nome: string; immagine: string | null; cornice: boolean; titolo: string | null; tu: boolean }
export interface PodioRow extends PersonaRow { posizione: number; presenze: number }
export interface ClassificaRow extends PodioRow { fissati: number }

/** Quello che arriva al browser di chi guarda. */
export interface SquadraView {
    mode: LeaderboardMode
    day: string
    squadraOggi: number
    scaliniSquadra: [number, number]
    punta: PuntaSnapshot | null
    sogliaFenici: number
    primiTre: PodioRow[]
    mancaPerSalire: number | null
    classifica: ClassificaRow[]
    fenici: PersonaRow[]
    sonoInSquadra: boolean
}

export function buildSquadraView(snap: SquadraSnapshot, viewerId: string): SquadraView {
    const ordinati = ordinaClassifica(snap.membri)
    const persona = (x: MembroSquadra): PersonaRow => ({
        id: x.id, nome: x.nome, immagine: x.immagine, cornice: x.cornice, titolo: x.titolo, tu: x.id === viewerId,
    })
    return {
        mode: snap.mode,
        day: snap.day,
        squadraOggi: snap.squadraOggi,
        scaliniSquadra: snap.scaliniSquadra,
        punta: snap.punta,
        sogliaFenici: snap.sogliaFenici,
        primiTre: snap.mode === 'top3'
            ? primiTre(ordinati).map((x, i) => ({ ...persona(x), posizione: i + 1, presenze: x.presenze }))
            : [],
        mancaPerSalire: snap.mode === 'top3' ? mancaPerSalire(ordinati, viewerId) : null,
        classifica: snap.mode === 'completa'
            ? ordinati.map((x, i) => ({ ...persona(x), posizione: i + 1, presenze: x.presenze, fissati: x.fissati }))
            : [],
        fenici: feniciDellaSettimana(snap.membri, snap.sogliaFenici).map(persona),
        sonoInSquadra: snap.membri.some(x => x.id === viewerId),
    }
}
