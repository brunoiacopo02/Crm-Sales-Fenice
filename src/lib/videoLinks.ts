// Mappa slug -> URL reale del video (VSL) mandato al lead insieme all'agenda.
//
// Perché esiste: i template WhatsApp permettono un bottone URL con **base fissa
// e suffisso dinamico**. Esponendo tutti i video sotto `https://<crm>/v/<slug>`
// basta UN solo template approvato da Meta per coprire tutte le varianti —
// invece di farne approvare uno per video. Aggiungere una variante in futuro
// vuol dire aggiungere una riga qui, senza passare da Meta.
//
// Effetto collaterale utile: il click passa dal CRM, quindi sappiamo chi ha
// aperto il video (evento VIDEO_OPENED sul lead).
//
// ATTENZIONE: gli URL vanno compilati prima di dare il via agli invii. Uno slug
// con URL vuoto si comporta come uno slug sconosciuto (pagina di cortesia, mai
// un errore in faccia al lead).

export const VIDEO_LINKS: Record<string, string> = {
    'offerta-mese': '',
    'lavora-famiglia': '',
    'lavora-nofigli': '',
    'nonlavora-famiglia': '',
    'nonlavora-nofigli': '',
}

/** Slug ammessi, per validazione e per i tool di export. */
export const VIDEO_SLUGS = Object.keys(VIDEO_LINKS)

/**
 * Risolve lo slug nell'URL del video.
 * `known: false` sia per slug inesistenti sia per slug non ancora compilati:
 * in entrambi i casi il chiamante deve mostrare la pagina di cortesia.
 */
export function resolveVideoUrl(slug: string): { url: string | null; known: boolean } {
    const url = VIDEO_LINKS[slug]
    if (!url) return { url: null, known: false }
    return { url, known: true }
}

/**
 * Slug della variante a partire dai flag scelti dal GDO nel modale Agenda.
 * Stessa precedenza di ActiveCampaign: "offerta del mese" vince sugli altri due.
 */
export function videoSlugFromVariant(v: { lavora: boolean; haFamiglia: boolean; offertaDelMese?: boolean }): string {
    if (v.offertaDelMese) return 'offerta-mese'
    const lavoro = v.lavora ? 'lavora' : 'nonlavora'
    const famiglia = v.haFamiglia ? 'famiglia' : 'nofigli'
    return `${lavoro}-${famiglia}`
}
