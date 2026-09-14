/**
 * Lancio "Web Developer AI" — webinar del 5 ottobre 2026 (spec 2026-09-14).
 *
 * Qui sta SOLO logica pura: costanti con i nomi della spec, l'interruttore,
 * la decisione "questo contatto AC e' un lead del lancio?", il campo `lancio`
 * del payload intake e i costruttori delle righe (lead ed eventi) che il
 * webhook e il sync di recupero scrivono. Niente DB, niente rete: e' il
 * pezzo che si puo' sbagliare in silenzio, quindi e' quello testato.
 */

// Niente `import crypto from 'crypto'`: questo modulo lo importa anche la card
// client (LANCIO_BUCKET) e un builtin Node non entra nel bundle del browser.
// globalThis.crypto.randomUUID c'e' in Node 20 e in tutti i browser.
const uuid = () => globalThis.crypto.randomUUID();

export const LANCIO_FUNNEL = 'Lancio Web Dev AI';
export const LANCIO_BUCKET = 'LANCIO_WEBDEV_2026';
export const LANCIO_SLUG = 'webdev-2026-10';
/** Nome della lista AC (oggi id 132), normalizzato trim+lowercase come le liste bloccate. */
export const LANCIO_LIST_NAME_NORMALIZED = 'lancio web developer ai';
export const LANCIO_POOL_LABEL = 'Lancio Web Dev AI 2026';
/** La lista vive sull'account AC Fenice: il lancio e' solo Fenice. */
export const LANCIO_COMPANY = 'fenice';

export type LancioIngresso = 'lista' | 'pulsante_webinar';

/** Campo opzionale `lancio` di BotIntakePayload (contratto v1.6 §6.1). */
export interface LancioPayloadField {
    slug: string;
    ingresso: LancioIngresso;
}

/**
 * Interruttore del ramo lancio nel webhook AC. SOLO la stringa esatta 'on':
 * una env scritta a meta' ('On', 'true') deve lasciare la lista bloccata,
 * che e' il comportamento sicuro (i lead restano in AC e si recuperano col sync).
 */
export function isLancioIntakeEnabled(env: Record<string, string | undefined> = process.env): boolean {
    return env.LANCIO_WEBDEV_INTAKE === 'on';
}

export type LancioDecision =
    | { lancio: true; via: 'payload' | 'membership'; listId: string }
    | { lancio: false; motivo: 'spento' | 'lista_sconosciuta' | 'non_in_lista' };

/**
 * "E' un lead del lancio?" con le stesse due strade delle liste bloccate:
 * fastpath sul campo `list` del payload, poi le membership del contatto.
 * `activeListIds` a null = membership non ancora lette: il chiamante riceve
 * 'non_in_lista' e decide se pagare la chiamata AC per leggerle.
 *
 * `lancioListIds` e' un insieme e non un id solo perche' su AC possono
 * convivere due liste con lo stesso nome (succede quando una campagna viene
 * ricreata): valgono tutte, altrimenti il contatto iscritto al "doppione"
 * scivolerebbe nel flusso normale. null o vuoto = lista non risolvibile.
 */
export function decideLancioIntake(args: {
    enabled: boolean;
    lancioListIds: ReadonlySet<string> | null;
    triggerListId: string | null;
    activeListIds: ReadonlySet<string> | null;
}): LancioDecision {
    const { enabled, lancioListIds, triggerListId, activeListIds } = args;
    if (!enabled) return { lancio: false, motivo: 'spento' };
    if (!lancioListIds || lancioListIds.size === 0) return { lancio: false, motivo: 'lista_sconosciuta' };
    if (triggerListId && lancioListIds.has(String(triggerListId))) {
        return { lancio: true, via: 'payload', listId: String(triggerListId) };
    }
    if (activeListIds) {
        // Ordinato: con piu' liste omonime l'id registrato nell'evento non
        // deve dipendere dall'ordine in cui AC ha risposto.
        for (const id of Array.from(lancioListIds).sort()) {
            if (activeListIds.has(id)) return { lancio: true, via: 'membership', listId: id };
        }
    }
    return { lancio: false, motivo: 'non_in_lista' };
}

export function lancioPayloadField(ingresso: LancioIngresso): LancioPayloadField {
    return { slug: LANCIO_SLUG, ingresso };
}

/**
 * Il campo `lancio` per un lead letto dal DB: presente solo nel bucket del
 * lancio. Un `lancioIngresso` assente o sconosciuto ricade su 'lista', perche'
 * i lead del bucket nascono tutti dalla lista; 'pulsante_webinar' lo scrive
 * solo /api/bot/lead-entrante (B2/B5).
 */
export function lancioFieldForLead(lead: { launchBucket: string | null; lancioIngresso: string | null }): LancioPayloadField | undefined {
    if (lead.launchBucket !== LANCIO_BUCKET) return undefined;
    const ingresso: LancioIngresso = lead.lancioIngresso === 'pulsante_webinar' ? 'pulsante_webinar' : 'lista';
    return lancioPayloadField(ingresso);
}

export interface LancioLeadInput {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    acContactId: string | null;
    phoneSuspicious: boolean;
    /** null = account bot non trovato: il lead resta nel bucket senza padrone. */
    botId: string | null;
    now: Date;
    utm?: {
        utmSource?: string | null;
        utmMedium?: string | null;
        utmCampaign?: string | null;
        utmContent?: string | null;
        utmTerm?: string | null;
    };
}

/** Shape della riga `leads` che scrivono webhook e sync (sottoinsieme di leads.$inferInsert). */
export interface LancioLeadRow {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    funnel: string;
    source: string;
    acContactId: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    phoneSuspicious: boolean;
    launchBucket: string;
    lancioIngresso: LancioIngresso;
    status: string;
    callCount: number;
    assignedToId: string | null;
    assignedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    companyId: string;
}

/**
 * Riga lead del lancio. Telefono sospetto → nel bucket senza padrone, come
 * la quarantena del flusso normale (una chat su 0000000000 non esiste).
 * Bot assente → idem, ma senza rete di salvataggio: non esiste nessun percorso
 * che riassegni al bot un lead gia' dentro (il sync salta i lead gia'
 * presenti). Restano nel bucket senza padrone e l'unica strada e' distribuirli
 * ai GDO dalla card del pool su /import.
 * `assignedAt` = adesso SOLO se assegnato: e' la data con cui il lead viene
 * contato nel mese (regola magazzino, §4.8).
 */
export function buildLancioLeadRow(input: LancioLeadInput): LancioLeadRow {
    const assegnabile = !input.phoneSuspicious && !!input.botId;
    return {
        id: input.id,
        name: input.name,
        phone: input.phone,
        email: input.email,
        funnel: LANCIO_FUNNEL,
        source: 'activecampaign',
        acContactId: input.acContactId,
        utmSource: input.utm?.utmSource ?? null,
        utmMedium: input.utm?.utmMedium ?? null,
        utmCampaign: input.utm?.utmCampaign ?? null,
        utmContent: input.utm?.utmContent ?? null,
        utmTerm: input.utm?.utmTerm ?? null,
        phoneSuspicious: input.phoneSuspicious,
        launchBucket: LANCIO_BUCKET,
        lancioIngresso: 'lista',
        status: 'NEW',
        callCount: 0,
        assignedToId: assegnabile ? input.botId : null,
        assignedAt: assegnabile ? input.now : null,
        createdAt: input.now,
        updatedAt: input.now,
        companyId: LANCIO_COMPANY,
    };
}

/** Stessa shape di leadEvents.$inferInsert, costruita a mano come in pickAndAssignBuckets. */
export interface LeadEventRow {
    id: string;
    leadId: string;
    eventType: 'IMPORTED' | 'ASSIGNED' | 'LANCIO_INTAKE';
    userId: string | null;
    fromSection: string | null;
    toSection: string | null;
    metadata: Record<string, unknown>;
    timestamp: Date;
    companyId: string;
}

/**
 * Gli eventi dell'ingresso di un lead lancio: IMPORTED (come il webhook),
 * ASSIGNED con routing='lancio' (solo se c'e' il bot), LANCIO_INTAKE.
 * Tornano come righe, non vengono scritte: il sync le inserisce a chunk di 500.
 */
export function buildLancioIntakeEventRows(args: {
    leadId: string;
    botId: string | null;
    adminId: string | null;
    acContactId: string | null;
    source: 'activecampaign' | 'lancio_sync';
    via: 'payload' | 'membership' | 'sync';
    listId: string | null;
    now: Date;
}): LeadEventRow[] {
    const base = {
        leadId: args.leadId,
        userId: args.adminId,
        fromSection: null,
        timestamp: args.now,
        companyId: LANCIO_COMPANY,
    };
    const rows: LeadEventRow[] = [{
        ...base,
        id: uuid(),
        eventType: 'IMPORTED',
        toSection: 'Prima Chiamata',
        metadata: { source: args.source, acContactId: args.acContactId, provenienza: LANCIO_FUNNEL, lancio: true },
    }];
    if (args.botId) {
        rows.push({
            ...base,
            id: uuid(),
            eventType: 'ASSIGNED',
            toSection: null,
            metadata: { assignedToUser: args.botId, source: args.source, routing: 'lancio' },
        });
    }
    rows.push({
        ...base,
        id: uuid(),
        eventType: 'LANCIO_INTAKE',
        toSection: null,
        metadata: { slug: LANCIO_SLUG, ingresso: 'lista', via: args.via, listId: args.listId, assegnatoAlBot: !!args.botId },
    });
    return rows;
}
