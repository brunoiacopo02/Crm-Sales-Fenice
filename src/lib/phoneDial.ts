/**
 * Numero "da chiamare": come lo vede e lo compone chi telefona dal CRM.
 *
 * I GDO chiamano con l'estensione Chrome di MicroSIP, che riconosce i numeri
 * nazionali (solo cifre) e NON quelli col prefisso internazionale: con un
 * "+39..." dovevano copiare a mano le cifre dopo il prefisso.
 *
 * Questa funzione serve SOLO alla visualizzazione e ai link tel:. Il numero
 * nel DB resta com'è (al bot / WhatsApp serve col prefisso).
 *
 * Regole:
 * - tolgo spazi, trattini, punti, parentesi, barre;
 * - "+39", "0039", "+0039", "+039" davanti a un numero italiano → via;
 * - "39" senza "+" davanti a 10 cifre che iniziano per 3 (mobile) → via;
 * - "+" seguito da un mobile italiano di 10 cifre (es. "+3281234567", il
 *   "39" è stato perso) → via il "+";
 * - un numero italiano nazionale (3xxxxxxxxx mobile, 0xxxxxxx fisso) resta;
 * - tutto il resto (esteri veri, numeri strani) torna com'era, intatto.
 */

/** Mobile italiano nazionale: 3 + 9 cifre (10 in tutto). */
const MOBILE_IT = /^3\d{9}$/;
/** Fisso italiano nazionale: 0 + 5..10 cifre. */
const FISSO_IT = /^0\d{5,10}$/;

function isNazionaleIt(digits: string): boolean {
    return MOBILE_IT.test(digits) || FISSO_IT.test(digits);
}

export function toDialablePhone(raw: string | null | undefined): string {
    if (raw == null) return '';
    const trimmed = String(raw).trim();
    if (!trimmed) return '';

    // Solo cifre e un eventuale "+" in testa sono ammessi dopo la pulizia
    // dei separatori: se c'è altro (lettere, interni "int. 2"...) non tocco.
    const compact = trimmed.replace(/[\s\-.()/]/g, '');
    if (!/^\+?\d+$/.test(compact)) return trimmed;

    const hasPlus = compact.startsWith('+');
    const digits = hasPlus ? compact.slice(1) : compact;

    // Già nazionale italiano, senza "+": va bene così (solo ripulito).
    if (!hasPlus && isNazionaleIt(digits)) return digits;

    // Prefisso Italia scritto in uno dei modi visti nei dati.
    for (const prefix of ['0039', '039', '39']) {
        if (!digits.startsWith(prefix)) continue;
        const rest = digits.slice(prefix.length);
        if (!isNazionaleIt(rest)) continue;
        // Senza "+" accetto "39" solo davanti a un mobile (12 cifre in tutto):
        // "39" + fisso è ambiguo con numeri nazionali veri, lo lascio stare.
        // "039" senza "+" è un fisso di Monza, non un prefisso: non tocco.
        if (!hasPlus) {
            if (prefix === '0039' || (prefix === '39' && MOBILE_IT.test(rest))) return rest;
            continue;
        }
        return rest;
    }

    // "+" davanti a un mobile italiano di 10 cifre: il "39" si è perso.
    // Nessun prefisso estero +3x ha numeri di 10 cifre in tutto con questa forma
    // da noi (Francia/Spagna/Belgio/Olanda sono 11, Grecia/Portogallo 12).
    if (hasPlus && MOBILE_IT.test(digits)) return digits;

    // Estero o non riconosciuto: lo restituisco come arrivava.
    return trimmed;
}

/** href per i link di chiamata (tel:) costruito sul numero da chiamare. */
export function telHref(raw: string | null | undefined): string {
    return `tel:${toDialablePhone(raw).replace(/\s+/g, '')}`;
}
