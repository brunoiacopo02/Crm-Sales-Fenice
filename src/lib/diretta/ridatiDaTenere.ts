// Quali lead tenere a un GDO che eredita la pipeline di un altro (PO 25/10/2026
// mattina: Lorenzo al posto di Fabio sul 118). Restano solo gli N ridati dal
// bot più recenti e migliori; il resto esce dalla sua pipeline e lo parcheggia
// scripts/diretta/lead-lorenzo.ts. Funzioni pure, testate senza DB.
//
// Chi può restare: solo i ridati in prima chiamata. Le seconde e terze
// chiamate, i richiami e i lead che il bot non ha mai avuto escono sempre.
//
// "Migliori", in quest'ordine:
//  1. mai chiamati: nessuna chiamata registrata in tutta la storia del lead,
//     poi quelli con meno tentativi;
//  2. con segnali di interesse: "Ti ha cercato" ancora aperto, poi ha scritto
//     di nuovo dopo la restituzione (nota del bot o messaggio in entrata), poi
//     la chat interrotta (aveva parlato col bot prima di fermarsi);
//  3. più recenti: l'ultimo segno di vita, cioè la restituzione o l'ultimo
//     messaggio del lead se è venuto dopo;
//  4. l'id come spareggio, così lo stesso input dà sempre lo stesso piano.
//
// Un lead che il nuovo titolare ha già lavorato (chiamato dopo il passaggio)
// non esce mai e occupa uno degli N posti.

export interface LeadEreditato {
    id: string
    /** Tentativi del giro attuale: 0 = prima chiamata. */
    callCount: number
    /** Chiamate registrate sul lead in tutta la sua storia (callLogs). */
    chiamateTotali: number
    /** Ultima restituzione dal bot; null = il bot non l'ha mai ridato. */
    ridatoIl: Date | null
    /** Ultimo messaggio del lead: nota del bot, messaggio in entrata, richiesta di contatto. */
    ultimoSegnale: Date | null
    /** Richiesta di contatto ancora aperta ("Ti ha cercato"). */
    tiHaCercato: boolean
    /** L'ultima restituzione è per chat interrotta. */
    chatInterrotta: boolean
    /** Ha un richiamo: sta nella coda dei richiami, non in prima chiamata. */
    richiamo: boolean
    /** Chiamato dal nuovo titolare dopo il passaggio: non si tocca. */
    giaLavorato: boolean
}

/** 3 ti ha cercato, 2 ha scritto dopo la restituzione, 1 chat interrotta, 0 niente. */
export function interesse(l: LeadEreditato): 0 | 1 | 2 | 3 {
    if (l.tiHaCercato) return 3
    if (l.ridatoIl && l.ultimoSegnale && l.ultimoSegnale.getTime() > l.ridatoIl.getTime()) return 2
    if (l.chatInterrotta) return 1
    return 0
}

/** Restituzione o ultimo messaggio del lead, il più recente dei due (ms). */
export function ultimoSegnoDiVita(l: LeadEreditato): number {
    return Math.max(l.ridatoIl?.getTime() ?? 0, l.ultimoSegnale?.getTime() ?? 0)
}

/** Può restare: ridato dal bot, in prima chiamata. */
export function puoRestare(l: LeadEreditato): boolean {
    return l.ridatoIl !== null && l.callCount === 0 && !l.richiamo
}

/** Ordine dei migliori (vedi in cima al file). */
export function confrontaMigliori(a: LeadEreditato, b: LeadEreditato): number {
    if (a.chiamateTotali !== b.chiamateTotali) return a.chiamateTotali - b.chiamateTotali
    const i = interesse(b) - interesse(a)
    if (i !== 0) return i
    const t = ultimoSegnoDiVita(b) - ultimoSegnoDiVita(a)
    if (t !== 0) return t
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export type MotivoUscita = 'richiamo' | 'gia_chiamato' | 'non_ridato' | 'ridato_oltre_il_limite'

/** Perché un lead esce: richiamo, seconda o terza chiamata, mai passato dal bot, oltre gli N. */
export function motivoUscita(l: LeadEreditato): MotivoUscita {
    if (l.richiamo) return 'richiamo'
    if (l.callCount > 0) return 'gia_chiamato'
    if (l.ridatoIl === null) return 'non_ridato'
    return 'ridato_oltre_il_limite'
}

export interface PianoTieni<T extends LeadEreditato> {
    /** Restano: prima i già lavorati, poi gli scelti, ciascun gruppo dal migliore. */
    tenuti: T[]
    /** Escono, col motivo. */
    parcheggiati: { lead: T; motivo: MotivoUscita }[]
}

export function pianoTieni<T extends LeadEreditato>(lista: readonly T[], quanti: number): PianoTieni<T> {
    const lavorati = lista.filter(l => l.giaLavorato).sort(confrontaMigliori)
    const posti = Math.max(0, Math.floor(quanti) - lavorati.length)
    const scelti = lista
        .filter(l => !l.giaLavorato && puoRestare(l))
        .sort(confrontaMigliori)
        .slice(0, posti)
    const tenuti = [...lavorati, ...scelti]
    const restano = new Set(tenuti.map(l => l.id))
    return {
        tenuti,
        parcheggiati: lista.filter(l => !restano.has(l.id)).map(lead => ({ lead, motivo: motivoUscita(lead) })),
    }
}
