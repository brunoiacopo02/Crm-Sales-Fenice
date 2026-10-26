// Pagina Squadra della Diretta (ex classifica, PO 25/10/2026). Funzioni pure:
// conteggi, ordinamenti e la vista che arriva al browser. La modalità
// (appSettings 'leaderboard_mode') decide anche QUALI dati partono dal server:
// in 'top3' chi guarda non riceve le presenze degli altri, così la sua
// posizione non si ricava nemmeno aprendo la rete del browser.
//
// Classifica settimanale (seconda tornata del 25/10): settimana lun-sab, si
// mostrano solo i primi tre con il premio in euro (50, 25, 10 lordi; a pari
// merito stessa posizione e premi divisi, PO 26/10/2026); ordine e
// premi sono gli stessi che l'admin registra a settimana chiusa
// (src/lib/economy/premiSettimana.ts).

import { ordinaPerPresenze, posizioniPremiate } from '@/lib/economy/premiSettimana'

export type LeaderboardMode = 'top3' | 'completa' | 'nessuna'
export const LEADERBOARD_MODE_KEY = 'leaderboard_mode'

export function parseLeaderboardMode(raw: string | null | undefined): LeaderboardMode {
    const v = (raw ?? '').trim()
    return v === 'completa' || v === 'nessuna' ? v : 'top3'
}

// I fissati (squadra e persona) si contano con contaFissati di ./fissati.ts,
// la stessa definizione della home, degli scalini e dei forzieri.

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

/** Presenze della settimana, poi il nome solo come ordine di lettura (a pari presenze si è pari merito). */
export function ordinaClassifica(membri: MembroSquadra[]): MembroSquadra[] {
    return ordinaPerPresenze(membri)
}

/**
 * Il podio: chi sta nelle prime tre posizioni con almeno `minPresenze`
 * presenze (una, di default). A pari merito si sta nella stessa posizione e
 * i premi si dividono (posizioniPremiate): il podio può avere più di tre persone.
 */
export function primiTre(membri: MembroSquadra[], minPresenze = 1, premiEuro: readonly number[] = []) {
    return posizioniPremiate(membri, premiEuro, minPresenze).filter(x => x.posizione <= 3 && x.presenze >= minPresenze)
}

/**
 * Presenze che servono a chi guarda per raggiungere chi gli sta subito sopra:
 * a pari presenze si è nella stessa posizione, quindi basta pareggiare.
 * null se non è in squadra, se è sul podio o se il podio è ancora vuoto.
 */
export function mancaPerSalire(ordinati: MembroSquadra[], viewerId: string, minPresenze = 1): number | null {
    const io = ordinati.find(x => x.id === viewerId)
    if (!io) return null
    const podio = primiTre(ordinati, minPresenze)
    if (podio.length === 0 || podio.some(x => x.id === viewerId)) return null
    const sopra = ordinati.filter(x => x.presenze > io.presenze).at(-1)
    return sopra ? Math.max(1, sopra.presenze - io.presenze) : null
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
    /** Euro lordi al 1°, 2° e 3° della settimana. */
    premiEuro: [number, number, number]
    /** Presenze minime per il podio. */
    minPresenze: number
    /** Settimana della classifica: lunedì e sabato 'YYYY-MM-DD'. */
    settimana: { lunedi: string; sabato: string }
}

export interface PersonaRow { id: string; nome: string; immagine: string | null; cornice: boolean; titolo: string | null; tu: boolean }
export interface PodioRow extends PersonaRow { posizione: number; presenze: number; premio: number }
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
    settimana: { lunedi: string; sabato: string }
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
            ? primiTre(snap.membri, snap.minPresenze, snap.premiEuro).map(x => ({ ...persona(x), posizione: x.posizione, presenze: x.presenze, premio: x.euro }))
            : [],
        mancaPerSalire: snap.mode === 'top3' ? mancaPerSalire(ordinati, viewerId, snap.minPresenze) : null,
        classifica: snap.mode === 'completa'
            ? posizioniPremiate(snap.membri, snap.premiEuro, snap.minPresenze).map(x => ({
                ...persona(x), posizione: x.posizione, presenze: x.presenze, fissati: x.fissati,
                premio: x.posizione <= 3 ? x.euro : 0,
            }))
            : [],
        fenici: feniciDellaSettimana(snap.membri, snap.sogliaFenici).map(persona),
        sonoInSquadra: snap.membri.some(x => x.id === viewerId),
        settimana: snap.settimana,
    }
}
