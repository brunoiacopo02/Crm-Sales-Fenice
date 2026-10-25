// Logica pura della home "Diretta" (PO 25/10/2026): frasi di ritmo, fasi
// dell'ora di punta, del turno e delle pause, etichette dei giorni, binario
// delle presenze e miglior settimana. Niente database e niente orologio
// implicito: l'istante arriva sempre come parametro, così i test fissano il
// tempo e il server e il browser calcolano la stessa cosa.

import { dayBoundsRome, toRomeDateStr, weekBoundsRome } from '@/lib/dateUtils'
import { fasciaBounds, shiftWindow, type GamificationTargets } from './config'

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']

/** Primo giorno contato per la miglior settimana: presenze da ottobre 2026. */
export const PRESENZE_DAL = new Date('2026-10-01T00:00:00+02:00')
/** Fissati contati per la miglior settimana: dal primo giorno della Diretta. */
export const FISSATI_DAL = new Date('2026-10-26T00:00:00+01:00')

/** Giorno della settimana di Roma, 0 = domenica. */
export function giornoSettimanaRoma(at: Date): number {
    return new Date(`${toRomeDateStr(at)}T12:00:00Z`).getUTCDay()
}

/** Ora di Roma in formato 18:05. */
export function oraBreve(at: Date): string {
    return new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at)
}

/** Ora "parlata": 18 se è un'ora piena, altrimenti 17:45. */
export function oraParlata(at: Date): string {
    const s = oraBreve(at)
    return s.endsWith(':00') ? String(Number(s.slice(0, 2))) : s
}

/** "l'" o "il " davanti a un numero scritto in cifre: l'8, l'11, il 10. */
export function articoloNumero(n: number): string {
    const s = String(Math.abs(Math.trunc(n)))
    return n === 1 || n === 11 || s.startsWith('8') ? "l'" : 'il '
}

/** Durata in italiano: 45 min, 1 ora, 2 ore e 5 min. */
export function durataTesto(minuti: number): string {
    const m = Math.max(0, Math.ceil(minuti))
    if (m < 1) return 'meno di un minuto'
    const h = Math.floor(m / 60)
    const r = m % 60
    if (h === 0) return `${r} min`
    const ore = h === 1 ? '1 ora' : `${h} ore`
    return r === 0 ? ore : `${ore} e ${r} min`
}

/** Il traguardo verso cui si corre adesso: il primo scalino, poi il secondo. */
export function traguardo(n: number, scalini: [number, number]): number {
    return n < scalini[0] ? scalini[0] : scalini[1]
}

/** Frase di ritmo sotto i fissati di oggi. */
export function fraseRitmo(n: number, scalini: [number, number]): string {
    const [primo, secondo] = scalini
    if (n >= secondo) return 'Obiettivo pieno raggiunto.'
    const mancano = (k: number) => (k === 1 ? 'Ti manca 1' : `Ti mancano ${k}`)
    if (n >= primo) return `Primo obiettivo preso. ${mancano(secondo - n)} per ${articoloNumero(secondo)}${secondo}.`
    return `${mancano(primo - n)} per ${articoloNumero(primo)}${primo}.`
}

/** Frase sotto il conteggio di squadra. */
export function fraseSquadra(n: number, scalini: [number, number]): string {
    const [primo, secondo] = scalini
    if (n >= secondo) return 'Obiettivo pieno di squadra raggiunto.'
    const mancano = (k: number) => (k === 1 ? 'Ne manca 1' : `Ne mancano ${k}`)
    if (n >= primo) return `Primo obiettivo di squadra preso. ${mancano(secondo - n)} per ${articoloNumero(secondo)}${secondo}.`
    return `${mancano(primo - n)} per ${articoloNumero(primo)}${primo}.`
}

export type Fase = 'prima' | 'durante' | 'dopo'

export interface StatoFinestra {
    fase: Fase
    start: Date
    end: Date
    /** Minuti all'inizio (prima), alla fine (durante), zero (dopo). */
    minuti: number
}

/** Dove sta `now` rispetto a una finestra: prima, durante o dopo. */
export function statoFinestra(now: Date, w: { start: Date; end: Date } | null): StatoFinestra | null {
    if (!w) return null
    const t = now.getTime()
    if (t < w.start.getTime()) return { fase: 'prima', start: w.start, end: w.end, minuti: (w.start.getTime() - t) / 60000 }
    if (t < w.end.getTime()) return { fase: 'durante', start: w.start, end: w.end, minuti: (w.end.getTime() - t) / 60000 }
    return { fase: 'dopo', start: w.start, end: w.end, minuti: 0 }
}

/** Testo accanto all'orologio in alto: quanto manca alla fine del turno. */
export function testoTurno(now: Date, t: GamificationTargets): string | null {
    const s = statoFinestra(now, shiftWindow(now, t))
    if (!s) return null
    if (s.fase === 'prima') return `il turno inizia alle ${oraBreve(s.start)}`
    if (s.fase === 'durante') return `mancano ${durataTesto(s.minuti)}`
    return 'turno finito'
}

/** Pause del giorno di `now`, in ordine: il sabato ha le sue, la domenica nessuna. */
export function pauseDelGiorno(now: Date, t: GamificationTargets): { start: Date; end: Date }[] {
    const g = giornoSettimanaRoma(now)
    if (g === 0) return []
    const elenco = g === 6 ? t.pauseSabato : t.pauseFeriali
    return (elenco ?? [])
        .map(f => fasciaBounds(now, f))
        .filter(p => p.end.getTime() > p.start.getTime())
        .sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** La pausa in corso o la prossima di oggi; null se per oggi sono finite. */
export function statoPausa(now: Date, t: GamificationTargets): { fase: 'durante' | 'prossima'; start: Date; end: Date; minuti: number } | null {
    const ms = now.getTime()
    for (const p of pauseDelGiorno(now, t)) {
        if (ms < p.start.getTime()) return { fase: 'prossima', ...p, minuti: (p.start.getTime() - ms) / 60000 }
        if (ms < p.end.getTime()) return { fase: 'durante', ...p, minuti: (p.end.getTime() - ms) / 60000 }
    }
    return null
}

/** Giorno dell'appuntamento rispetto a oggi: oggi, domani, martedì, l'8 novembre. */
export function etichettaGiorno(at: Date, now: Date): string {
    const a = toRomeDateStr(at)
    const b = toRomeDateStr(now)
    const diff = Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
    if (diff === 0) return 'oggi'
    if (diff === 1) return 'domani'
    if (diff > 1 && diff < 7) return GIORNI[new Date(`${a}T12:00:00Z`).getUTCDay()]
    const giorno = Number(a.slice(8, 10))
    const mese = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long' }).format(at)
    return `${articoloNumero(giorno)}${giorno} ${mese}`
}

/** Riga della cronaca: "Zora fissa per martedì", "Tu fissi per domani". */
export function fraseCronaca(nome: string, mio: boolean, giorno: string | null): string {
    const chi = mio ? 'Tu fissi' : `${nome} fissa`
    return giorno ? `${chi} per ${giorno}` : `${chi} un appuntamento`
}

/** Ultime righe per lead distinto (in ordine dal più recente), al massimo `limite`. */
export function ultimiPerLead<T extends { leadId: string }>(righeDalPiuRecente: T[], limite: number): T[] {
    const visti = new Set<string>()
    const out: T[] = []
    for (const r of righeDalPiuRecente) {
        if (visti.has(r.leadId)) continue
        visti.add(r.leadId)
        out.push(r)
        if (out.length >= limite) break
    }
    return out
}

export interface Casella { n: number; euro: boolean; piena: boolean }

/** Binario delle presenze: almeno l'obiettivo (7), dalla soglia in poi le caselle valgono euro. */
export function binarioPresenze(presenze: number, t: GamificationTargets): Casella[] {
    const totale = Math.max(t.presenzeObiettivo, presenze)
    return Array.from({ length: totale }, (_, i) => ({
        n: i + 1,
        euro: i + 1 > t.presenzeSogliaEuro,
        piena: i < presenze,
    }))
}

/** Lunedì (YYYY-MM-DD di Roma) della settimana che contiene `at`. */
export function chiaveSettimana(at: Date): string {
    return toRomeDateStr(weekBoundsRome(at).start)
}

/** Somma per settimana di righe pesate (presenze e aggiustamenti manuali). */
export function sommaPerSettimana(righe: { at: Date; n: number }[]): Map<string, number> {
    const out = new Map<string, number>()
    for (const r of righe) {
        const k = chiaveSettimana(r.at)
        out.set(k, (out.get(k) ?? 0) + r.n)
    }
    return out
}

/** Lead distinti per settimana (i fissati). */
export function distintiPerSettimana(righe: { at: Date; leadId: string }[]): Map<string, number> {
    const insiemi = new Map<string, Set<string>>()
    for (const r of righe) {
        const k = chiaveSettimana(r.at)
        let s = insiemi.get(k)
        if (!s) { s = new Set(); insiemi.set(k, s) }
        s.add(r.leadId)
    }
    return new Map([...insiemi].map(([k, s]) => [k, s.size]))
}

/** La settimana col valore più alto; a parità vince la più recente. */
export function migliorSettimana(conteggi: Map<string, number>): { settimana: string | null; valore: number } {
    let settimana: string | null = null
    let valore = 0
    for (const [k, v] of conteggi) {
        if (v > valore || (v === valore && v > 0 && settimana !== null && k > settimana)) {
            settimana = k
            valore = v
        }
    }
    return { settimana, valore }
}

/** Ultimo giorno lavorativo prima di oggi (lun-sab): lunedì guarda il sabato. */
export function giornoLavorativoPrecedente(now: Date): { start: Date; end: Date; etichetta: string } {
    let d = new Date(dayBoundsRome(now).start.getTime() - 12 * 3_600_000)
    if (giornoSettimanaRoma(d) === 0) d = new Date(d.getTime() - 24 * 3_600_000)
    const { start, end } = dayBoundsRome(d)
    const ieri = toRomeDateStr(new Date(dayBoundsRome(now).start.getTime() - 12 * 3_600_000))
    return { start, end, etichetta: toRomeDateStr(d) === ieri ? 'ieri' : GIORNI[giornoSettimanaRoma(d)] }
}

/** Schermata d'inizio turno: una volta al giorno, dall'inizio del turno alla fine. */
export function mostraInizioTurno(now: Date, t: GamificationTargets, ultimoGiornoVisto: string | null): boolean {
    const turno = shiftWindow(now, t)
    if (!turno) return false
    if (now.getTime() < turno.start.getTime() || now.getTime() >= turno.end.getTime()) return false
    return ultimoGiornoVisto !== toRomeDateStr(now)
}

/**
 * Valore mostrato dopo un avanzamento ottimistico: finché il "pavimento" è
 * valido non si scende sotto il valore appena mostrato (il dato di squadra
 * arriva da una cache di 15 secondi); scaduto, vale il server.
 */
export function conPavimento(server: number, pavimento: { valore: number; fino: number } | null, adesso: number): number {
    return pavimento && adesso < pavimento.fino ? Math.max(server, pavimento.valore) : server
}

/** Quanto è ricco il momento appuntamento: il 1°, il primo e il secondo scalino. */
export function tipoMomento(n: number, scalini: [number, number]): 'pieno' | 'scalino' | 'semplice' {
    if (n === scalini[1]) return 'pieno'
    if (n === 1 || n === scalini[0]) return 'scalino'
    return 'semplice'
}

/** Euro senza decimali alla maniera italiana: 24 €. */
export function euro(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

/** Settimana in chiaro dal lunedì YYYY-MM-DD: "settimana del 12 ottobre". */
export function etichettaSettimana(lunedi: string): string {
    const giorno = Number(lunedi.slice(8, 10))
    const mese = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', month: 'long' }).format(new Date(`${lunedi}T12:00:00Z`))
    return `settimana del${giorno === 1 || giorno === 8 || giorno === 11 ? "l'" : ' '}${giorno} ${mese}`
}
