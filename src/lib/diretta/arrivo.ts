// Ora di arrivo di un lead al GDO che lo ha in mano e "vergini del giorno"
// (PO 25/10/2026). Funzioni pure: le usa getPipelineLeads, si testano senza DB.
//
// Il CRM non ha una colonna con l'ora in cui un lead è arrivato al suo GDO:
// `assignedAt` è la PRIMA presa in carico (latch, migr. 0027) e `createdAt` la
// nascita. Un lead che il bot restituisce, o che l'admin sposta, arriva al GDO
// molto dopo. L'ora vera si ricostruisce dagli eventi di assegnazione.

export interface EventoLead {
    eventType: string
    userId: string | null
    timestamp: Date | string
    /** metadata.toAssigneeId, scritto dalla redistribuzione admin (REASSIGNED_ADMIN). */
    toAssigneeId?: string | null
    /** metadata.assignedToUser, scritto da webhook, import e coda contatti (ASSIGNED). */
    assignedToUser?: string | null
}

/**
 * A chi assegna il lead questo evento, null se non è un'assegnazione.
 *
 * In ASSIGNED `userId` è a volte chi assegna (import, coda contatti: l'admin) e
 * a volte chi riceve (spostamenti da /gestione, cron): quando c'è,
 * `metadata.assignedToUser` è il destinatario e vince.
 */
export function destinatarioAssegnazione(e: EventoLead): string | null {
    switch (e.eventType) {
        case 'REASSIGNED_FROM_BOT': return e.userId ?? null
        case 'REASSIGNED_ADMIN': return e.toAssigneeId ?? null
        case 'ASSIGNED': return e.assignedToUser ?? e.userId ?? null
        default: return null
    }
}

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d))

/**
 * L'ultima assegnazione al proprietario attuale. In mancanza `assignedAt`,
 * poi `createdAt`: un lead che nessun evento racconta resta dove l'avrebbe
 * messo l'ordine di prima.
 */
export function oraArrivo(args: {
    eventi: readonly EventoLead[]
    proprietario: string | null
    assignedAt: Date | string | null
    createdAt: Date | string
}): Date {
    let ultimo = -Infinity
    if (args.proprietario) {
        for (const e of args.eventi) {
            if (destinatarioAssegnazione(e) !== args.proprietario) continue
            const t = ms(e.timestamp)
            if (t > ultimo) ultimo = t
        }
    }
    if (ultimo > -Infinity) return new Date(ultimo)
    return new Date(ms(args.assignedAt ?? args.createdAt))
}

/**
 * Vergine del giorno: lead fresco di ActiveCampaign nato oggi (giorno di Roma)
 * e mai toccato da nessuno, né da un GDO né dal bot. Un ritorno dal bot riparte
 * da callCount 0 e status NEW come un lead nuovo: si distingue solo dagli
 * eventi, per questo arrivano già calcolati in `ridatoDalBot`/`passatoDalBot`.
 */
export function eVergineDelGiorno(l: {
    status: string
    callCount: number
    source: string | null
    launchBucket: string | null
    createdAt: Date | string
    ridatoDalBot: boolean
    passatoDalBot: boolean
    tiHaCercato: boolean
}, inizioGiorno: Date): boolean {
    return l.status === 'NEW'
        && l.callCount === 0
        && l.source === 'activecampaign'
        && !l.launchBucket
        && !l.ridatoDalBot
        && !l.passatoDalBot
        && !l.tiHaCercato
        && ms(l.createdAt) >= inizioGiorno.getTime()
}

/**
 * Ordine della 1ª chiamata: prima i vergini del giorno, poi la priorità che la
 * board dava già (stella, "ti ha cercato", ...), poi l'ora di arrivo più
 * recente, e `id` come spareggio così l'ordine resta fermo fra un caricamento
 * e l'altro (fix del 14/05, lead "spariti").
 */
export function ordinaPrimaChiamata<T extends { id: string; arrivedAt: Date; vergine: boolean }>(
    lista: readonly T[],
    priorita: (l: T) => number,
): T[] {
    return [...lista].sort((a, b) => {
        if (a.vergine !== b.vergine) return a.vergine ? -1 : 1
        const p = priorita(b) - priorita(a)
        if (p !== 0) return p
        const t = b.arrivedAt.getTime() - a.arrivedAt.getTime()
        if (t !== 0) return t
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/** "12 min fa", "3 ore fa": da chiamare solo lato client, con l'ora del browser. */
export function tempoDaArrivo(arrivoMs: number, oraMs: number): string {
    const diff = Math.max(0, oraMs - arrivoMs)
    const minuti = Math.floor(diff / 60_000)
    if (minuti < 1) return 'adesso'
    if (minuti < 60) return `${minuti} min fa`
    const ore = Math.floor(minuti / 60)
    if (ore < 24) return ore === 1 ? '1 ora fa' : `${ore} ore fa`
    const giorni = Math.floor(ore / 24)
    return giorni === 1 ? '1 giorno fa' : `${giorni} giorni fa`
}
