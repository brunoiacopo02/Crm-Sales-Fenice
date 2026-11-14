// Azzeramento al cambio della SIM (PO 14/11/2026).
//
// Il tasso è della persona, ma se nel foglio cambia il NUMERO di una riga
// contano solo le chiamate fatte dopo il cambio. Il foglio non dice a che ora
// è cambiato (DATA ULTIMO CAMBIO, quando c'è, è solo un giorno), quindi il CRM
// ricorda l'ultimo numero visto per ogni interno e l'istante del giro in cui
// l'ha visto cambiare: il conteggio riparte da lì. Le chiamate fra il cambio
// vero e il giro (al massimo un'ora) restano fuori: meglio perderle che
// mescolarle alla SIM vecchia.
//
// Stato salvato in appSettings (chiave STATO_SIM_KEY), un JSON
// { [interno]: { numero, dal } }.

import { dayBoundsRome, toRomeDateStr } from '@/lib/dateUtils'

export interface StatoRigaSim {
    /** Numero normalizzato ("" = nessuna SIM). */
    numero: string
    /** Istante (ISO) del giro che ha visto il cambio; null = nessun cambio noto. */
    dal: string | null
}

export type StatoSim = Record<string, StatoRigaSim>

/** "+39 352 228 6297" → "3522286297"; "/", "da ins", "" → "". */
export function normalizzaNumero(raw: string): string {
    let d = raw.replace(/\D/g, '')
    if (d.startsWith('0039')) d = d.slice(4)
    else if (d.startsWith('39') && d.length === 12) d = d.slice(2)
    return d
}

/** DATA ULTIMO CAMBIO è oggi? Accetta gg/mm/aaaa, gg/mm/aa, gg/mm e aaaa-mm-gg. */
export function cambioDiOggi(data: string, adesso: Date): boolean {
    const [a, m, g] = toRomeDateStr(adesso).split('-').map(Number)
    const s = data.trim()
    let iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (iso) return Number(iso[1]) === a && Number(iso[2]) === m && Number(iso[3]) === g
    iso = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/)
    if (!iso) return false
    const anno = iso[3] === undefined ? a : iso[3].length === 2 ? 2000 + Number(iso[3]) : Number(iso[3])
    return Number(iso[1]) === g && Number(iso[2]) === m && anno === a
}

export function aggiornaStatoSim(
    prima: StatoSim,
    righe: { interno: string; numero: string; dataCambio: string }[],
    adesso: Date,
): { stato: StatoSim; cambiati: string[] } {
    const stato: StatoSim = { ...prima }
    const cambiati: string[] = []
    const visti = new Set<string>()
    for (const r of righe) {
        if (visti.has(r.interno)) continue
        visti.add(r.interno)
        const numero = normalizzaNumero(r.numero)
        const p = prima[r.interno]
        if (!p) {
            // Primo giro su questa riga: non c'è un numero di prima con cui
            // confrontare. Se il titolare ha segnato il cambio con la data di
            // oggi gli si crede, e si riparte da adesso.
            const oggi = cambioDiOggi(r.dataCambio, adesso)
            stato[r.interno] = { numero, dal: oggi ? adesso.toISOString() : null }
            if (oggi) cambiati.push(r.interno)
        } else if (p.numero !== numero) {
            stato[r.interno] = { numero, dal: adesso.toISOString() }
            cambiati.push(r.interno)
        } else {
            stato[r.interno] = p
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
        const { numero, dal } = r as { numero?: unknown; dal?: unknown }
        if (typeof numero !== 'string') continue
        out[k] = { numero, dal: typeof dal === 'string' ? dal : null }
    }
    return out
}
