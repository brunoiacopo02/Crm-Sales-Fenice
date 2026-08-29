/**
 * Categorie del motivo per cui un lead chiede di parlare con una persona.
 *
 * Il bot manda `motivo` come stringa (contratto v1.5). Qui si normalizza: un
 * valore che non conosciamo diventa `altro` invece di far fallire la richiesta.
 * Una categoria sbagliata è un fastidio, una richiesta persa è un lead perso —
 * e le parole esatte del lead restano comunque in `reason`.
 */
export const CONTACT_CATEGORIES = {
    richiamo: 'Vuole essere richiamato',
    prezzo: 'Domande su prezzo o pagamenti',
    programma: 'Domande sul percorso',
    sfiducia_bot: 'Non si fida della chat',
    problema_tecnico: 'Problema tecnico',
    disdetta: 'Disdetta o spostamento',
    // Contratto del 29/08: il bot segnala QUALSIASI risposta dopo il 3° tentativo,
    // non solo chi chiede esplicitamente di parlare con una persona. Uno che
    // scrive "scusate, ero al lavoro" per il bot era solo un lead che aveva
    // risposto, e da noi restava scartato per sempre.
    // È l'unica categoria in cui c'è un appuntamento da riaprire: mescolata ad
    // `altro` si perde, ed è esattamente quello che il fornitore ci ha chiesto
    // di non fare.
    risposta_dopo_terzo_nr: 'Ha risposto dopo il 3° NR — recuperabile',
    altro: 'Altro',
} as const;

export type ContactCategory = keyof typeof CONTACT_CATEGORIES;

/** Sinonimi accettati dal fornitore, per non dipendere dalla loro etichetta esatta. */
const ALIASES: Record<string, ContactCategory> = {
    richiamo_generico: 'richiamo',
    vuole_essere_richiamato: 'richiamo',
    chiamata: 'richiamo',
    call: 'richiamo',
    costo: 'prezzo',
    costi: 'prezzo',
    pagamento: 'prezzo',
    rateizzazione: 'prezzo',
    dubbio_prezzo: 'prezzo',
    percorso: 'programma',
    corso: 'programma',
    informazioni: 'programma',
    dubbio_programma: 'programma',
    diffidenza: 'sfiducia_bot',
    non_si_fida: 'sfiducia_bot',
    parlare_con_umano: 'sfiducia_bot',
    tecnico: 'problema_tecnico',
    link_non_funziona: 'problema_tecnico',
    video: 'problema_tecnico',
    disdetta_o_sposta: 'disdetta',
    spostamento: 'disdetta',
    annullamento: 'disdetta',
    risposta_dopo_3nr: 'risposta_dopo_terzo_nr',
    risposta_dopo_terzo_tentativo: 'risposta_dopo_terzo_nr',
    ha_risposto_dopo_nr: 'risposta_dopo_terzo_nr',
};

export function normalizeContactCategory(raw: unknown): ContactCategory {
    if (typeof raw !== 'string') return 'altro';
    const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (key in CONTACT_CATEGORIES) return key as ContactCategory;
    return ALIASES[key] ?? 'altro';
}

export function contactCategoryLabel(category: string): string {
    return CONTACT_CATEGORIES[category as ContactCategory] ?? CONTACT_CATEGORIES.altro;
}

/**
 * Un lead è bloccato quando ha già prodotto storico: ogni metrica per-GDO legge
 * l'assegnatario ATTUALE, quindi spostarlo cancellerebbe presenze da cicli bonus
 * già pagati e fatturato già riconciliato. `presentedAt` è latchato dal 17/07:
 * una volta vero non torna falso, nemmeno se il follow-up dice "Sparito".
 *
 * Questa funzione è l'UNICA definizione dell'invariante. Prima esisteva in due
 * copie — una in contactRequestActions.ts e una che avrebbe dovuto esserci in
 * reassign.ts e non c'era — con un commento che prometteva di tenerle allineate.
 * Non ha funzionato: un lead ha perso l'appuntamento (0f90aa98, 25/06).
 */
export function isLeadLocked(status: string, presentedAt: Date | null): boolean {
    return status === 'APPOINTMENT' || presentedAt !== null;
}

/**
 * Di chi è la competenza su una richiesta di contatto umano.
 *
 * Derivata e non memorizzata: un lead che passa ad APPOINTMENT cambia corsia da
 * solo, e non c'è nessuno stato da tenere allineato. Sono le 14 richieste su 64
 * (22%) che oggi finiscono in coda per un GDO quando a chiamare quel lead il
 * giorno prima della call sono le Conferme.
 */
export function contactLane(leadStatus: string): 'conferme' | 'gdo' {
    return leadStatus === 'APPOINTMENT' ? 'conferme' : 'gdo';
}
