// "Fissato" della Diretta: l'unica definizione, per i numeri e per i premi
// (PO 25/10/2026, corretta dopo la revisione del 25/10).
//
// Fissato = lead distinto con un callLog APPUNTAMENTO della persona nel
// periodo (giorno di Roma, settimana, ora di punta) che ADESSO è ancora in
// appuntamento (leads.status = 'APPOINTMENT'). Un appuntamento fissato e poi
// tolto (richiamo, non risposto, scarto, annullamento dell'admin) smette di
// contare: "fissa e togli" non gonfia né i numeri né gli scalini né i forzieri.
//
// La squadra conta ogni lead una volta sola, anche se l'hanno fissato in due;
// la persona conta i suoi. La usano la home, l'inizio turno, la pagina Squadra,
// gli scalini personali e i forzieri di squadra. La lettura dal DB è in
// ./fissatiDb.ts; qui solo funzioni pure.

export interface RigaFissato {
    userId: string | null
    leadId: string
    createdAt: Date | string
}

/** Il lead conta come fissato solo se adesso è ancora in appuntamento. */
export function fissatoValido(statoLead: string | null | undefined): boolean {
    return statoLead === 'APPOINTMENT'
}

/** Delle righe lette (callLog APPUNTAMENTO con lo stato attuale del lead), quelle che contano. */
export function soloValidi<T extends { stato: string | null }>(righe: readonly T[]): T[] {
    return righe.filter(r => fissatoValido(r.stato))
}

export interface ConteggioFissati {
    /** Lead distinti di tutti: il numero della squadra. */
    totale: number
    /** Lead distinti di ciascuno. */
    perUtente: Record<string, number>
}

/**
 * Fissati nel periodo [start, end) (senza estremi: tutte le righe). Le righe
 * senza persona non contano.
 */
export function contaFissati(rows: readonly RigaFissato[], start?: Date, end?: Date): ConteggioFissati {
    const s = start?.getTime() ?? -Infinity
    const e = end?.getTime() ?? Infinity
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
