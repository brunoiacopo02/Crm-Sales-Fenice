// Composizione delle righe del giro SIM GDO: per ogni riga del foglio chi è,
// quante chiamate ha fatto oggi (dalla ripartenza, se la SIM è cambiata), il
// tasso e il colore della cella. Logica pura: la usano sia il giro orario sia
// la schermata /admin/sim-gdo.
//
// AGGANCIO riga → utente: interno del centralino (colonna GDO) → tabella
// `pbxExtensions` (la stessa mappa dell'import dei tabulati, scripts/import-cdr.ts).
// Quella mappa però si aggiorna solo con l'import dei tabulati e può restare
// indietro quando un GDO cambia postazione. Per non scrivere il tasso di una
// persona sulla SIM di un'altra, si controlla che il NOME scritto nel foglio
// sia compatibile con il nome dell'utente agganciato: se non lo è la riga
// resta vuota e la schermata dice perché.

import { contaChiamate, coloreCella, tasso, type Colore, type LogChiamata } from './tasso'
import { inizioConteggio, type StatoSim } from './cambioSim'
import type { RigaFoglio } from './intestazioni'
import { dayBoundsRome } from '@/lib/dateUtils'

export interface UtenteInterno {
    id: string
    firstName: string | null
    gdoCode: number | null
    /** name/displayName del CRM, es. "GDO 112". */
    nomeCrm: string | null
}

export type EsitoRiga = 'agganciato' | 'non_agganciato' | 'nome_diverso' | 'interno_ripetuto'

export interface RigaCalcolata extends RigaFoglio {
    esito: EsitoRiga
    utente: UtenteInterno | null
    chiamate: number
    risposte: number
    /** Tasso da scrivere (0-1); null = cella vuota. */
    tasso: number | null
    colore: Colore | null
    /** Istante (ISO) da cui si conta oggi per un cambio SIM; null se si conta tutto il giorno. */
    ripartitoDal: string | null
}

function normalizzaNome(s: string | null | undefined): string {
    return (s ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z]/g, '')
        // "Christian"/"Cristian", "Anthony"/"Antony": la h non distingue nessuno.
        .replace(/h/g, '')
}

/**
 * Il NOME del foglio può essere la persona del CRM? Il foglio usa diminutivi e
 * grafie sue (RICCARDINO, ZORA, CHRISTIAN): basta che i primi tre caratteri
 * coincidano (senza accenti e senza h). Nome vuoto nel foglio = niente da smentire;
 * utente senza nome nel CRM = non si può verificare, quindi no.
 */
export function nomiCompatibili(nomeFoglio: string, nomeCrm: string | null): boolean {
    const a = normalizzaNome(nomeFoglio)
    if (!a) return true
    const b = normalizzaNome(nomeCrm)
    if (!b) return false
    if (a === b) return true
    let comune = 0
    while (comune < a.length && comune < b.length && a[comune] === b[comune]) comune++
    return comune >= 3
}

export function calcolaRighe(input: {
    righe: RigaFoglio[]
    statoSim: StatoSim
    interni: Map<string, UtenteInterno>
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
        const vuota = (esito: EsitoRiga, utente: UtenteInterno | null): RigaCalcolata => ({
            ...r, esito, utente, chiamate: 0, risposte: 0, tasso: null, colore: null, ripartitoDal: null,
        })
        if (visti.has(r.interno)) return vuota('interno_ripetuto', null)
        visti.add(r.interno)

        const utente = input.interni.get(r.interno) ?? null
        if (!utente) return vuota('non_agganciato', null)
        if (!nomiCompatibili(r.nome, utente.firstName)) return vuota('nome_diverso', utente)

        const dal = inizioConteggio(input.statoSim[r.interno]?.dal ?? null, input.adesso)
        const c = contaChiamate(perUtente.get(utente.id) ?? [], dal)
        return {
            ...r,
            esito: 'agganciato',
            utente,
            chiamate: c.chiamate,
            risposte: c.risposte,
            tasso: tasso(c),
            colore: coloreCella(c, input.soglia),
            ripartitoDal: dal > mezzanotte ? dal.toISOString() : null,
        }
    })
}
