/**
 * Gli UTM di ActiveCampaign: id dei custom field e lettura.
 *
 * Esiste per una ragione sola: il webhook AC e il sync di recupero del lancio
 * devono ricavare dallo STESSO contatto gli STESSI cinque UTM. Finche' la
 * mappa degli id e la funzione di lettura sono vissute dentro il route handler
 * del webhook, il sync non poteva riusarle — e infatti non le riusava: sui 56
 * lead del funnel "Lancio Web Dev AI" solo i 6 entrati dal webhook avevano gli
 * UTM, i 50 del sync li avevano tutti a NULL.
 *
 * Niente DB, niente rete: e' il pezzo testabile dell'ingresso AC.
 */

/** Custom field id su AC per gli UTM (visti via /api/3/fields). */
export const UTM_FIELD_IDS = {
    utmSource: '31',
    utmMedium: '32',
    utmCampaign: '33',
    utmContent: '34',
    utmTerm: '35',
} as const;

/** Una riga di /contacts/{id}/fieldValues, o del sideload di ?include=fieldValues. */
export interface AcFieldValue {
    field: string | number;
    value: string | null;
    /** Presente solo nel sideload: a quale contatto appartiene la riga. */
    contact?: string | number | null;
}

/** I cinque UTM come finiscono sulle colonne di `leads`. */
export interface AcUtmValues {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
}

/**
 * Il valore di un custom field, trimmato. null se assente, vuoto o solo spazi:
 * una stringa vuota su `leads.utmSource` sarebbe peggio di NULL, perche'
 * sembrerebbe un dato che c'e'.
 */
export function readFieldLocal(
    fieldValues: ReadonlyArray<AcFieldValue> | null | undefined,
    fieldId: string,
): string | null {
    if (!Array.isArray(fieldValues)) return null;
    const v = fieldValues.find((f) => f && String(f.field) === fieldId)?.value;
    return v && String(v).trim() ? String(v).trim() : null;
}

/** I cinque UTM da un elenco di fieldValues. Elenco vuoto o assente = cinque null. */
export function readUtmFields(fieldValues: ReadonlyArray<AcFieldValue> | null | undefined): AcUtmValues {
    return {
        utmSource: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmSource),
        utmMedium: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmMedium),
        utmCampaign: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmCampaign),
        utmContent: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmContent),
        utmTerm: readFieldLocal(fieldValues, UTM_FIELD_IDS.utmTerm),
    };
}

/** true se almeno uno dei cinque UTM e' valorizzato. */
export function hasAnyUtm(utm: AcUtmValues): boolean {
    return !!(utm.utmSource || utm.utmMedium || utm.utmCampaign || utm.utmContent || utm.utmTerm);
}

/**
 * Indicizza per contatto il sideload `fieldValues` di
 * `/contacts?...&include=fieldValues`.
 *
 * AC non annida i custom field dentro ogni contatto: li mette in un array
 * `fieldValues` di primo livello, dove ogni riga porta il proprio `contact`.
 * Verificato sulla lista 132 il 19/09/2026: 56 contatti, 447 fieldValues, zero
 * contatti scoperti e zero differenze rispetto ai link `contact.fieldValues`.
 *
 * Tollerante per scelta: una risposta senza il sideload (parametro ignorato,
 * versione API diversa) torna una mappa vuota, cioe' esattamente il
 * comportamento di prima del fix — nessun UTM, ma nessun import rotto.
 */
export function indexFieldValuesByContact(sideload: unknown): Map<string, AcFieldValue[]> {
    const byContact = new Map<string, AcFieldValue[]>();
    if (!Array.isArray(sideload)) return byContact;
    for (const raw of sideload) {
        if (!raw || typeof raw !== 'object') continue;
        const fv = raw as AcFieldValue;
        const contactId = String(fv.contact ?? '').trim();
        if (!contactId) continue;
        const list = byContact.get(contactId);
        if (list) list.push(fv);
        else byContact.set(contactId, [fv]);
    }
    return byContact;
}
