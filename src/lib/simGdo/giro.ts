// Composizione delle righe del giro SIM GDO: per ogni riga del foglio chi è,
// quante chiamate ha fatto oggi (dalla ripartenza, se la SIM è cambiata), il
// tasso e il colore della cella. Logica pura: la usano sia il giro orario sia
// la schermata /admin/sim-gdo.
//
// AGGANCIO riga → utente PER NOME (PO 14/11/2026): il foglio è la verità su
// chi usa quale SIM. La riga si aggancia all'unico GDO attivo (non bot, non
// prova: isRealGdo del canone) il cui nome di persona (users.firstName)
// corrisponde al NOME del foglio. Nessuno o più di uno = riga non agganciata.
// AGGANCI FISSI (titolare 20/11/2026): chi cambia spesso il nome nel profilo
// (GDO 106) si aggancia dal codice GDO, non dal nome. La tabella "NOME del
// foglio → gdoCode" sta in appSettings (leggiAgganci); se il NOME è in tabella
// vale solo il codice: se quel codice non è di un GDO attivo la riga resta non
// agganciata ('aggancio_non_valido'), mai per nome. Un GDO preso da un aggancio
// fisso non si aggancia anche per nome da un'altra riga.
// L'interno del centralino (colonna GDO) resta solo un'informazione e la
// chiave dello stato del cambio SIM: la tabella `pbxExtensions` NON si usa,
// è ferma all'ultimo import dei tabulati e serve all'attribuzione storica.

import { contaChiamate, coloreCella, tasso, type Colore, type LogChiamata } from './tasso'
import { inizioConteggio, type StatoSim } from './cambioSim'
import type { RigaFoglio } from './intestazioni'
import { dayBoundsRome } from '@/lib/dateUtils'

export interface UtenteGdo {
    id: string
    /** Nome di persona (users.firstName); name/displayName sono "GDO 1xx". */
    firstName: string | null
    gdoCode: number | null
}

export type EsitoRiga = 'agganciato' | 'nessuno' | 'ambiguo' | 'interno_ripetuto' | 'gdo_ripetuto' | 'aggancio_non_valido'

/** Agganci fissi: nome del foglio normalizzato (normalizzaNome) → gdoCode. */
export type Agganci = Record<string, number>

/**
 * Legge la tabella degli agganci fissi da appSettings, JSON tipo { "ZORA": 106 }.
 * Chiave assente, JSON malformato, non oggetto: tabella vuota. Le voci con
 * valore non numerico (intero positivo) o nome vuoto si scartano. Non lancia mai.
 */
export function leggiAgganci(raw: string | null | undefined): Agganci {
    if (!raw) return {}
    let v: unknown
    try { v = JSON.parse(raw) } catch { return {} }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Agganci = {}
    for (const [nome, codice] of Object.entries(v as Record<string, unknown>)) {
        const chiave = normalizzaNome(nome)
        if (!chiave) continue
        if (typeof codice !== 'number' || !Number.isInteger(codice) || codice <= 0) continue
        out[chiave] = codice
    }
    return out
}

export interface RigaCalcolata extends RigaFoglio {
    esito: EsitoRiga
    utente: UtenteGdo | null
    /** Per 'ambiguo': i GDO che corrispondono al nome. Per 'gdo_ripetuto': il GDO conteso. */
    candidati: UtenteGdo[]
    /** Per 'gdo_ripetuto': le altre righe del foglio agganciate allo stesso GDO. */
    stessoGdoDi: number[]
    chiamate: number
    risposte: number
    /** Tasso da scrivere (0-1); null = cella vuota. */
    tasso: number | null
    colore: Colore | null
    /** Istante (ISO) da cui si conta oggi per un cambio SIM; null se si conta tutto il giorno. */
    ripartitoDal: string | null
}

/** Minuscole, senza accenti, solo lettere, senza h ("Christian" = "Cristian"). */
export function normalizzaNome(s: string | null | undefined): string {
    return (s ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        .replace(/h/g, '')
}

/**
 * Lettere iniziali in comune richieste per i diminutivi (RICCARDINO ↔ Riccardo,
 * ZORA ↔ Zoretta: PO 14/11/2026, 3 lettere). Se più GDO attivi corrispondono
 * la riga è ambigua e resta vuota.
 */
export const PREFISSO_MINIMO = 3

/**
 * Il NOME del foglio è questa persona? Uguali dopo la normalizzazione, oppure
 * un prefisso comune di almeno PREFISSO_MINIMO lettere. Nomi vuoti: mai.
 */
export function nomiCompatibili(nomeFoglio: string, nomeCrm: string | null): boolean {
    const a = normalizzaNome(nomeFoglio)
    const b = normalizzaNome(nomeCrm)
    if (!a || !b) return false
    if (a === b) return true
    let comune = 0
    while (comune < a.length && comune < b.length && a[comune] === b[comune]) comune++
    return comune >= PREFISSO_MINIMO
}

/** Il NOME del foglio è proprio il nome della persona (dopo la normalizzazione)? */
export function nomeUguale(nomeFoglio: string, nomeCrm: string | null): boolean {
    const a = normalizzaNome(nomeFoglio)
    return a !== '' && a === normalizzaNome(nomeCrm)
}

/**
 * GDO attivi che corrispondono al nome del foglio (passare solo GDO veri e
 * attivi). Il nome uguale batte il prefisso: MARIA con Maria e Mariana attive
 * è Maria, non un nome ambiguo.
 */
export function candidatiPerNome(nomeFoglio: string, utenti: UtenteGdo[]): UtenteGdo[] {
    const compatibili = utenti.filter(u => nomiCompatibili(nomeFoglio, u.firstName))
    const uguali = compatibili.filter(u => nomeUguale(nomeFoglio, u.firstName))
    return uguali.length > 0 ? uguali : compatibili
}

export function calcolaRighe(input: {
    righe: RigaFoglio[]
    statoSim: StatoSim
    /** GDO attivi, non bot, non prova. */
    utenti: UtenteGdo[]
    logs: (LogChiamata & { userId: string | null })[]
    soglia: number | null
    adesso: Date
    /** Agganci fissi nome → gdoCode (leggiAgganci); assente = solo per nome. */
    agganci?: Agganci
}): RigaCalcolata[] {
    const agganci = input.agganci ?? {}
    const { start: mezzanotte } = dayBoundsRome(input.adesso)
    const perUtente = new Map<string, LogChiamata[]>()
    for (const l of input.logs) {
        if (!l.userId) continue
        const lista = perUtente.get(l.userId)
        if (lista) lista.push(l)
        else perUtente.set(l.userId, [l])
    }

    const vuota = (r: RigaFoglio, esito: EsitoRiga, candidati: UtenteGdo[] = [], stessoGdoDi: number[] = []): RigaCalcolata => ({
        ...r, esito, utente: null, candidati, stessoGdoDi, chiamate: 0, risposte: 0, tasso: null, colore: null, ripartitoDal: null,
    })

    // 1. Ogni riga col suo GDO (o il motivo per cui non ne ha uno).
    const visti = new Set<string>()
    const fisso: boolean[] = []
    const scelte = input.righe.map((r): RigaCalcolata | UtenteGdo => {
        // L'interno è la chiave dello stato del cambio SIM: due righe con lo
        // stesso interno si confonderebbero, vale la prima.
        fisso.push(false)
        const i = fisso.length - 1
        if (visti.has(r.interno)) return vuota(r, 'interno_ripetuto')
        visti.add(r.interno)
        const codice = Object.prototype.hasOwnProperty.call(agganci, normalizzaNome(r.nome)) ? agganci[normalizzaNome(r.nome)] : undefined
        if (codice !== undefined) {
            // Nome in tabella: conta solo il codice, mai il nome del profilo.
            const utente = input.utenti.find(x => x.gdoCode === codice)
            if (!utente) return vuota(r, 'aggancio_non_valido')
            fisso[i] = true
            return utente
        }
        const candidati = candidatiPerNome(r.nome, input.utenti)
        if (candidati.length === 0) return vuota(r, 'nessuno')
        if (candidati.length > 1) return vuota(r, 'ambiguo', candidati)
        return candidati[0]
    })

    // 2. Uno stesso GDO non sta su due righe: tiene la riga col nome uguale,
    // se è una sola; altrimenti restano vuote tutte.
    const righeDi = new Map<string, number[]>()
    scelte.forEach((s, i) => {
        if ('esito' in s) return
        righeDi.set(s.id, [...(righeDi.get(s.id) ?? []), i])
    })

    return input.righe.map((r, i): RigaCalcolata => {
        const s = scelte[i]
        if ('esito' in s) return s
        const utente = s
        const contese = righeDi.get(utente.id) ?? [i]
        const fissi = contese.filter(j => fisso[j])
        if (contese.length > 1 && fissi.length > 0) {
            // Aggancio fisso: batte il nome. Se i fissi sono più d'uno (due nomi
            // in tabella sullo stesso codice) restano vuoti tutti.
            if (!(fissi.length === 1 && fissi[0] === i)) {
                const altre = contese.filter(j => j !== i).map(j => input.righe[j].riga)
                return vuota(r, 'gdo_ripetuto', [utente], altre)
            }
        } else if (contese.length > 1) {
            const uguali = contese.filter(j => nomeUguale(input.righe[j].nome, utente.firstName))
            const tiene = uguali.length === 1 ? uguali[0] : null
            if (tiene !== i) {
                const altre = (tiene === null ? contese.filter(j => j !== i) : [tiene]).map(j => input.righe[j].riga)
                return vuota(r, 'gdo_ripetuto', [utente], altre)
            }
        }
        const candidati = [utente]

        const dal = inizioConteggio(input.statoSim[r.interno]?.dal ?? null, input.adesso)
        const c = contaChiamate(perUtente.get(utente.id) ?? [], dal)
        return {
            ...r,
            esito: 'agganciato',
            utente,
            candidati,
            stessoGdoDi: [],
            chiamate: c.chiamate,
            risposte: c.risposte,
            tasso: tasso(c),
            colore: coloreCella(c, input.soglia),
            ripartitoDal: dal > mezzanotte ? dal.toISOString() : null,
        }
    })
}
