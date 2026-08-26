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
