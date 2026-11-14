// Composizione delle righe del giro SIM GDO: per ogni riga del foglio chi è,
// quante chiamate ha fatto oggi (dalla ripartenza, se la SIM è cambiata), il
// tasso e il colore della cella. Logica pura: la usano sia il giro orario sia
// la schermata /admin/sim-gdo.
//
// AGGANCIO riga → utente PER NOME (PO 14/11/2026): il foglio è la verità su
// chi usa quale SIM. La riga si aggancia all'unico GDO attivo (non bot, non
// prova: isRealGdo del canone) il cui nome di persona (users.firstName)
// corrisponde al NOME del foglio. Nessuno o più di uno = riga non agganciata.
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

export type EsitoRiga = 'agganciato' | 'nessuno' | 'ambiguo' | 'interno_ripetuto'

export interface RigaCalcolata extends RigaFoglio {
    esito: EsitoRiga
    utente: UtenteGdo | null
    /** Per 'ambiguo': i GDO che corrispondono al nome. */
    candidati: UtenteGdo[]
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

/** Lettere iniziali in comune richieste per i diminutivi (RICCARDINO ↔ Riccardo). */
export const PREFISSO_MINIMO = 4

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

/** GDO attivi che corrispondono al nome del foglio (passare solo GDO veri e attivi). */
export function candidatiPerNome(nomeFoglio: string, utenti: UtenteGdo[]): UtenteGdo[] {
    return utenti.filter(u => nomiCompatibili(nomeFoglio, u.firstName))
}

export function calcolaRighe(input: {
    righe: RigaFoglio[]
    statoSim: StatoSim
    /** GDO attivi, non bot, non prova. */
    utenti: UtenteGdo[]
    logs: (LogChiamata & { userId: string | null })[]
    soglia: number | null
    adesso: Date
}): RigaCalcolata[] {
    const { start: mezzanotte } = dayBoundsRome(input.adesso)
    const perUtente = new Map<string, LogChiamata[]>()
    for (const l of input.logs) {
        if (!l.userId) continue
        const lista = perUtente.get(l.userId)
        if (lista) lista.push(l)
        else perUtente.set(l.userId, [l])
    }

    const visti = new Set<string>()
    return input.righe.map((r): RigaCalcolata => {
        const vuota = (esito: EsitoRiga, candidati: UtenteGdo[] = []): RigaCalcolata => ({
            ...r, esito, utente: null, candidati, chiamate: 0, risposte: 0, tasso: null, colore: null, ripartitoDal: null,
        })
        // L'interno è la chiave dello stato del cambio SIM: due righe con lo
        // stesso interno si confonderebbero, vale la prima.
        if (visti.has(r.interno)) return vuota('interno_ripetuto')
        visti.add(r.interno)

        const candidati = candidatiPerNome(r.nome, input.utenti)
        if (candidati.length === 0) return vuota('nessuno')
        if (candidati.length > 1) return vuota('ambiguo', candidati)
        const utente = candidati[0]

        const dal = inizioConteggio(input.statoSim[r.interno]?.dal ?? null, input.adesso)
        const c = contaChiamate(perUtente.get(utente.id) ?? [], dal)
        return {
            ...r,
            esito: 'agganciato',
            utente,
            candidati,
            chiamate: c.chiamate,
            risposte: c.risposte,
            tasso: tasso(c),
            colore: coloreCella(c, input.soglia),
            ripartitoDal: dal > mezzanotte ? dal.toISOString() : null,
        }
    })
}
