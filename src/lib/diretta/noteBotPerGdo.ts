// Le note del bot non arrivano mai a un GDO (PO 25/10/2026, ribadito 29/10/2026:
// "così non si fanno condizionare").
//
// Il filtro a parole ("bot", "chat", "fissatore") non basta: il bot scrive anche
// note che non nominano niente di tutto questo, per esempio
// `"a dicembre" — Richiamo indicativo: a dicembre`. Quella frase finiva nella
// nota dell'ultima chiamata (lastCallNote) o del richiamo (recallNote) del lead e
// il GDO la leggeva sulla card, nella scheda e nel popover del richiamo.
//
// La regola qui guarda la FONTE: una nota è del bot se è lo stesso testo che un
// utente bot (users.isBot) ha scritto in una sua chiamata (callLogs) su quel
// lead. updateLeadOutcome scrive la stessa nota sia nel callLog sia nei campi del
// lead, quindi il callLog ne è la firma. Il riassunto dell'IA vocale porta il suo
// marcatore "[Mario vocale]" (lo scrive il webhook, mai una persona).
//
// Si toglie solo il testo. Date, stato, "da rifissare", richiamo e appuntamento
// restano come sono. Funzioni pure: il DB è in noteBotDb.ts.

/** Testi scritti da una macchina su un lead (note del bot, motivi di scarto del bot). */
export type NoteDelBot = ReadonlySet<string>

/** Marcatori che solo una macchina mette in testa a una nota. */
const MARCATORE_MACCHINA = /^\s*\[mario vocale\]/i

const norm = (s: string) => s.trim()

/**
 * La nota l'ha scritta una macchina (bot o IA vocale)? Basta la fonte: il testo
 * è identico a una nota di un callLog del bot su quel lead, oppure porta il
 * marcatore dell'IA vocale.
 */
export function notaDiMacchina(testo: string | null | undefined, noteDelBot: NoteDelBot): boolean {
    if (typeof testo !== 'string') return false
    const t = norm(testo)
    if (!t) return false
    if (noteDelBot.has(t)) return true
    if (MARCATORE_MACCHINA.test(t)) return true
    return false
}

/**
 * Il testo come lo può leggere un GDO: null se l'ha scritto una macchina. Una
 * nota scritta da un GDO o dalle Conferme resta com'è, anche se nomina il bot:
 * la regola guarda chi l'ha scritta, non le parole.
 */
export function notaPerGdo(testo: string | null | undefined, noteDelBot: NoteDelBot): string | null {
    if (notaDiMacchina(testo, noteDelBot)) return null
    return testo ?? null
}

/** Campi di un lead che possono portare testo del bot. */
export interface CampiTestoLead {
    lastCallNote?: string | null
    recallNote?: string | null
    appointmentNote?: string | null
    discardReason?: string | null
    botReport?: unknown
    lancioBotInfo?: unknown
}

const CAMPI_NOTA = ['lastCallNote', 'recallNote', 'appointmentNote', 'discardReason'] as const

/**
 * Il lead come arriva al browser di un GDO: le note del bot diventano null, il
 * report del bot e le informazioni del bot sul lancio spariscono. Tutto il resto
 * (date, stato, versione...) resta identico. I campi assenti restano assenti.
 */
export function leadPerGdo<T extends CampiTestoLead>(lead: T, noteDelBot: NoteDelBot): T {
    const copia = { ...lead } as Record<string, unknown>
    for (const campo of CAMPI_NOTA) {
        if (campo in copia) copia[campo] = notaPerGdo(copia[campo] as string | null | undefined, noteDelBot)
    }
    if ('botReport' in copia) copia.botReport = null
    if ('lancioBotInfo' in copia) copia.lancioBotInfo = null
    return copia as T
}

/**
 * Salvataggio di un GDO su un campo nota che non ha potuto leggere: se arriva
 * vuoto e la nota attuale è della macchina, resta quella attuale (le Conferme e
 * gli admin la usano). Se il GDO scrive qualcosa, vale quello che scrive.
 */
export function notaDaSalvareDalGdo<T extends string | null | undefined>(
    inviata: T,
    attuale: string | null | undefined,
    noteDelBot: NoteDelBot,
): T | string {
    const vuota = typeof inviata !== 'string' || !inviata.trim()
    if (vuota && notaDiMacchina(attuale, noteDelBot)) return attuale as string
    return inviata
}
