/**
 * Lead che il bot NON prende (PO 29/10/2026).
 *
 * `/api/bot/intake` risponde 200 anche quando scarta, con `accettato:false` e un
 * `motivo` (contratto 29/08). Fino al 29/10 il push leggeva dal corpo solo
 * `duplicato`: lo scarto veniva scritto come `sent` e il lead restava sul bot per
 * sempre, senza chat e senza esito (fissi, numeri scritti male: 25 lead fermi
 * trovati il 29/10, dal 09/08).
 *
 * Ora: il lead va subito ai GDO del giro dei ridati, col motivo registrato; se il
 * numero non è chiamabile nemmeno a voce (+0000…, poche cifre) si chiude come
 * "numero non valido".
 *
 * Parte pura qui (testabile senza DB); la scrittura in `gestisciRifiutoBot`.
 */

/** I motivi per cui il bot non ha creato niente e il lead resterebbe fermo. */
const MOTIVI_DA_RIDARE = new Set(['telefono_non_valido', 'arruolamento_fallito'])

export type CorpoIntake = { accettato?: unknown; motivo?: unknown; duplicato?: unknown }

/** Il corpo di una risposta 2xx dell'intake dice che il lead NON è stato preso? */
export function rifiutoDalCorpo(bodyText: string | null): { motivo: string } | null {
    if (!bodyText) return null
    let c: CorpoIntake
    try { c = JSON.parse(bodyText) as CorpoIntake } catch { return null }
    if (!c || c.accettato !== false || c.duplicato === true) return null
    return { motivo: typeof c.motivo === 'string' ? c.motivo : 'sconosciuto' }
}

/**
 * Il rifiuto lascia il lead fermo sul bot? `apertura_non_partita` no: la chat
 * esiste e il bot la riprova da solo (cron riapri-mute).
 */
export function rifiutoDaRidare(motivo: string): boolean {
    return MOTIVI_DA_RIDARE.has(motivo)
}

/**
 * Numero che non si può chiamare nemmeno a voce: nessuna cifra utile, meno di 6
 * cifre dopo prefissi e zeri, oppure una sola cifra ripetuta (+000000000000000,
 * 3333333333). Un fisso (0xx…) o un numero scritto male ma completo (+0393…)
 * resta chiamabile: lo decide il GDO.
 */
export function numeroNonChiamabile(phone: string | null | undefined): boolean {
    const d = (phone ?? '').replace(/\D/g, '')
    if (!d) return true
    const utili = d.replace(/^0+/, '')
    if (utili.length < 6) return true
    if (/^(\d)\1+$/.test(d)) return true
    if (/^0000/.test(d)) return true
    return false
}

/** Nota che finisce nel ridato al GDO e nella timeline del lead. */
export function notaRifiuto(motivo: string): string {
    return motivo === 'telefono_non_valido'
        ? 'Il bot non ha preso il lead: numero non raggiungibile su WhatsApp (fisso o scritto male). Chiamare a voce.'
        : `Il bot non ha preso il lead (${motivo}). Chiamare a voce.`
}
