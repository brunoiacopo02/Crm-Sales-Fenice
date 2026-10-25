// Controllo degli obiettivi della Diretta salvati dalla pagina admin
// (/admin/diretta). Funzione pura: prende quello che arriva dal form e
// restituisce un GamificationTargets completo oppure il primo errore leggibile.

import type { Fascia, GamificationTargets } from './config'

export type EsitoObiettivi = { ok: true; value: GamificationTargets } | { ok: false; errore: string }

const ORA = /^([01]\d|2[0-3]):[0-5]\d$/

function intero(v: unknown, min: number, max: number): number | null {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null
}

function scalini(v: unknown, nome: string): [number, number] | string {
    if (!Array.isArray(v) || v.length !== 2) return `${nome}: servono due scalini`
    const a = intero(v[0], 1, 1000)
    const b = intero(v[1], 1, 1000)
    if (a === null || b === null) return `${nome}: gli scalini sono numeri interi da 1 a 1000`
    if (a > b) return `${nome}: il primo scalino non può superare il secondo`
    return [a, b]
}

function fascia(v: unknown, nome: string): Fascia | string {
    const f = v as Partial<Fascia> | null
    if (!f || typeof f.start !== 'string' || typeof f.end !== 'string' || !ORA.test(f.start) || !ORA.test(f.end)) {
        return `${nome}: orari nel formato 18:00`
    }
    if (f.start >= f.end) return `${nome}: l'inizio deve venire prima della fine`
    return { start: f.start, end: f.end }
}

function pause(v: unknown, nome: string): Fascia[] | string {
    if (!Array.isArray(v)) return `${nome}: elenco non valido`
    if (v.length > 6) return `${nome}: al massimo 6 pause`
    const out: Fascia[] = []
    for (const [i, p] of v.entries()) {
        const f = fascia(p, `${nome} ${i + 1}`)
        if (typeof f === 'string') return f
        out.push(f)
    }
    return out.sort((a, b) => a.start.localeCompare(b.start))
}

export function validaObiettivi(input: unknown): EsitoObiettivi {
    const i = (input ?? {}) as Record<string, unknown>

    const personale = scalini(i.personale, 'Personale')
    if (typeof personale === 'string') return { ok: false, errore: personale }
    const squadra = scalini(i.squadra, 'Squadra')
    if (typeof squadra === 'string') return { ok: false, errore: squadra }
    const punta = scalini(i.punta, 'Ora di punta')
    if (typeof punta === 'string') return { ok: false, errore: punta }

    const fasce: Record<string, Fascia> = {}
    for (const [k, nome] of [
        ['puntaFeriale', 'Ora di punta feriale'],
        ['puntaSabato', 'Ora di punta del sabato'],
        ['turnoFeriale', 'Turno feriale'],
        ['turnoSabato', 'Turno del sabato'],
    ] as const) {
        const f = fascia(i[k], nome)
        if (typeof f === 'string') return { ok: false, errore: f }
        fasce[k] = f
    }

    const pauseFeriali = pause(i.pauseFeriali, 'Pausa feriale')
    if (typeof pauseFeriali === 'string') return { ok: false, errore: pauseFeriali }
    const pauseSabato = pause(i.pauseSabato, 'Pausa del sabato')
    if (typeof pauseSabato === 'string') return { ok: false, errore: pauseSabato }

    const presenzeObiettivo = intero(i.presenzeObiettivo, 1, 50)
    if (presenzeObiettivo === null) return { ok: false, errore: 'Presenze a settimana: un intero da 1 a 50' }
    const presenzeSogliaEuro = intero(i.presenzeSogliaEuro, 0, 50)
    if (presenzeSogliaEuro === null) return { ok: false, errore: 'Soglia delle presenze: un intero da 0 a 50' }
    const euroPerPresenza = intero(i.euroPerPresenza, 0, 1000)
    if (euroPerPresenza === null) return { ok: false, errore: 'Euro per presenza: un intero da 0 a 1000' }

    return {
        ok: true,
        value: {
            personale,
            squadra,
            punta,
            puntaFeriale: fasce.puntaFeriale,
            puntaSabato: fasce.puntaSabato,
            turnoFeriale: fasce.turnoFeriale,
            turnoSabato: fasce.turnoSabato,
            pauseFeriali,
            pauseSabato,
            presenzeObiettivo,
            presenzeSogliaEuro,
            euroPerPresenza,
        },
    }
}
