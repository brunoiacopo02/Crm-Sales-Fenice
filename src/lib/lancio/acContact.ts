/**
 * Lettura pura di un contatto ActiveCampaign per il lancio "Web Developer AI".
 *
 * Esiste per una ragione sola: il sync di recupero (/import) e il webhook AC
 * devono ricavare dallo STESSO contatto lo stesso nome, la stessa email e
 * soprattutto lo stesso telefono. Se divergessero anche di un prefisso, lo
 * stesso contatto entrerebbe due volte nel bucket — la dedup per telefono non
 * lo vedrebbe — e la persona riceverebbe due aperture WhatsApp.
 *
 * Le regole sono quelle di `handleLancioIntake` nel webhook: strict, poi
 * lenient, poi via il '+39' (nei lead italiani il prefisso non si scrive), e
 * `phoneSuspicious` dal solo esito strict.
 *
 * Niente DB, niente rete: e' il pezzo testabile del sync.
 */
import { normalizePhoneStrict, normalizePhoneLenient, isPlausiblePhone } from '../phoneNormalize';

/** Il sottoinsieme del contatto AC che serve al lancio. */
export interface LancioAcContact {
    id?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    phone?: unknown;
}

export interface LancioContactRead {
    name: string;
    email: string | null;
    /** Telefono come finisce su `leads.phone`. */
    phone: string;
    /** Esito strict: null = solo lenient (numero monco). */
    phoneStrict: string | null;
    /** true = niente bot, il lead resta nel bucket senza padrone. */
    phoneSuspicious: boolean;
}

/** L'id del contatto come stringa, o null se AC non l'ha mandato. */
export function lancioContactId(contact: LancioAcContact | null | undefined): string | null {
    const id = String(contact?.id ?? '').trim();
    return id ? id : null;
}

/**
 * Nome, email e telefono di un contatto AC. null = telefono assente o senza
 * nemmeno una cifra: il contatto non e' lavorabile (il sync lo conta in
 * `skippedNoPhone`, il webhook scrive una failure).
 */
export function readLancioAcContact(contact: LancioAcContact | null | undefined): LancioContactRead | null {
    const rawPhone = String(contact?.phone ?? '').trim();
    const phoneStrict = normalizePhoneStrict(rawPhone);
    const phoneFinalNormalized = phoneStrict ?? normalizePhoneLenient(rawPhone);
    const phoneFinal = phoneFinalNormalized?.startsWith('+39')
        ? phoneFinalNormalized.slice(3)
        : phoneFinalNormalized;
    if (!rawPhone || !phoneFinal) return null;

    const firstName = String(contact?.firstName ?? '').trim();
    const lastName = String(contact?.lastName ?? '').trim();
    const name = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Lead senza nome';
    const email = String(contact?.email ?? '').trim() || null;

    return { name, email, phone: phoneFinal, phoneStrict, phoneSuspicious: !isPlausiblePhone(phoneStrict) };
}
