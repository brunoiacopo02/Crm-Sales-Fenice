// Azzeramento al cambio della SIM (regola del titolare, 14/11/2026 sera).
//
// Il tasso è della persona, ma quando nel foglio viene segnato un cambio di
// SIM, cioè quando nella colonna DATA ULTIMO CAMBIO compare un valore nuovo,
// contano solo le chiamate fatte da quel momento. Il foglio dice al massimo il
// giorno, non l'ora: il CRM ricorda l'ultimo valore visto per ogni interno e
// l'istante del giro in cui l'ha visto cambiare, e il conteggio riparte da lì.
//
// - valore nuovo e non vuoto (anche non interpretabile o di un altro giorno):
//   si riparte dall'istante del giro;
// - stesso valore, o cella svuotata: nessun azzeramento (si aggiorna solo il ricordo);
// - riga mai vista: si memorizza il valore senza azzerare;
// - il cambio del NUMERO da solo non azzera niente.
//
// Stato in appSettings (chiave STATO_SIM_KEY), JSON { [interno]: { dataCambio, dal } }.
// Il formato vecchio ({ numero, dal }, azzeramento sul numero) si legge come
// "riga mai vista": al primo giro nuovo si memorizza, senza azzerare.

import { dayBoundsRome } from '@/lib/dateUtils'

export interface StatoRigaSim {
    /** Ultimo valore visto di DATA ULTIMO CAMBIO (spazi tolti); null = mai visto. */
    dataCambio: string | null
    /** Istante (ISO) del giro che ha visto il cambio; null = nessun cambio noto. */
    dal: string | null
}

export type StatoSim = Record<string, StatoRigaSim>

/** "14 / 11 / 2026 " → "14/11/2026". */
export function normalizzaDataCambio(raw: string): string {
    return raw.replace(/\s+/g, '')
}

export function aggiornaStatoSim(
    prima: StatoSim,
    righe: { interno: string; dataCambio: string }[],
    adesso: Date,
): { stato: StatoSim; cambiati: string[] } {
    const stato: StatoSim = { ...prima }
    const cambiati: string[] = []
    const visti = new Set<string>()
    for (const r of righe) {
        if (visti.has(r.interno)) continue
        visti.add(r.interno)
        const valore = normalizzaDataCambio(r.dataCambio)
        const p = prima[r.interno]
        if (!p || p.dataCambio === null) {
            // Mai vista (o stato del formato vecchio): si memorizza e basta.
            stato[r.interno] = { dataCambio: valore, dal: p?.dal ?? null }
        } else if (valore !== '' && valore !== p.dataCambio) {
            stato[r.interno] = { dataCambio: valore, dal: adesso.toISOString() }
            cambiati.push(r.interno)
        } else {
            stato[r.interno] = { dataCambio: valore, dal: p.dal }
        }
    }
    return { stato, cambiati }
}

/** Da quando si contano le chiamate di oggi: mezzanotte di Roma, o la ripartenza se è di oggi. */
export function inizioConteggio(dal: string | null, adesso: Date): Date {
    const { start } = dayBoundsRome(adesso)
    if (!dal) return start
    const d = new Date(dal)
    return Number.isNaN(d.getTime()) || d < start ? start : d
}

export function leggiStatoSim(raw: string | null | undefined): StatoSim {
    if (!raw) return {}
    let v: unknown
    try { v = JSON.parse(raw) } catch { return {} }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: StatoSim = {}
    for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
        if (!r || typeof r !== 'object') continue
        const { dataCambio, dal } = r as { dataCambio?: unknown; dal?: unknown }
        out[k] = {
            // Formato vecchio (con `numero`, senza `dataCambio`): come mai vista.
            dataCambio: typeof dataCambio === 'string' ? dataCambio : null,
            dal: typeof dal === 'string' ? dal : null,
        }
    }
    return out
}
