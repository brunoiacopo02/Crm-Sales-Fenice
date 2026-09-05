/**
 * Lead che scrivono per primi sul numero WhatsApp Fenice.
 *
 * Contesto (doc del fornitore, 04/09): fra il 26/08 e il 04/09 43 persone hanno
 * aperto loro una chat sul numero Fenice con un link `wa.me` precompilato che
 * gira nel canale Telegram. 29 non hanno mai ricevuto risposta — silenzio
 * mediano 113 ore — perché il bot risponde solo a chi gli arriva dall'intake del
 * CRM, e nel CRM quelle persone non esistevano. Le 14 registrate in parallelo
 * hanno prodotto 4 appuntamenti (29%).
 *
 * Lato bot il problema è chiuso: adotta chi scrive per primo e risponde in
 * secondi. Ma un lead adottato non ha un `leadId` del CRM, quindi il suo esito —
 * appuntamento compreso — non ha dove tornare: `POST /api/bot/outcome` vuole un
 * leadId. Questo modulo legge la lista di quelle chat orfane, la normalizza e la
 * prepara per l'adozione lato CRM.
 *
 * Qui dentro sta SOLO roba pura più il client HTTP: le scritture stanno nella
 * rotta admin, che è l'unico posto da cui possono partire (e mai da sole).
 */

import { signPayload } from '@/lib/marketing-webhooks/signing';
import { normalizePhoneStrict } from '@/lib/phoneNormalize';
import { personKeyOf } from './personKey';

/** Default sovrascrivibile via env, come per BOT_INTAKE_URL / AGENDA_BOT_URL. */
export const LEAD_ENTRANTI_URL_DEFAULT =
    'https://web-app-messaggistica.vercel.app/api/bot/lead-entranti';

/** Fallback nome, identico a quello del webhook AC: un lead senza nome resta un lead. */
export const NOME_FALLBACK = 'Lead senza nome';

/** Fallback funnel, identico a quello del webhook AC. */
export const FUNNEL_FALLBACK = 'SCONOSCIUTO';

/** `source` scritto sui lead creati da qui: li rende isolabili in una query sola. */
export const SOURCE_INBOUND = 'whatsapp-inbound';

/** Riga della risposta del fornitore. Tutto opzionale: valida `normalizzaLeadEntrante`. */
export interface LeadEntranteRaw {
    telefono?: string | null;
    nome?: string | null;
    provenienza?: string | null;
    primoMessaggio?: string | null;
    scrittoIl?: string | null;
    conversationId?: number | null;
    statoBot?: string | null;
    esito?: string | null;
    appuntamento?: string | null;
    /**
     * Il bot ha già mandato almeno un messaggio in quella chat (loro commit
     * d58d2d6). Vedi `intakeSicuro` per il perché è la condizione che conta.
     * Assente sul canale push, dove è sempre falso per costruzione.
     */
    botHaRisposto?: boolean | null;
}

export interface LeadEntranteNormalizzato {
    phone: string;
    /** Ultime 10 cifre: la stessa chiave persona che usa il push verso il bot. */
    personKey: string;
    name: string;
    funnel: string;
    primoMessaggio: string | null;
    /** Quando ha scritto. `null` se la data arriva illeggibile: è contesto, non un requisito. */
    scrittoIl: Date | null;
    conversationId: number | null;
    /** Stato interno del fornitore, GREZZO di proposito (vedi `chatApertaAlBot`). */
    statoBot: string;
    esito: string | null;
    /** Valorizzato solo con `esito === 'APPUNTAMENTO'` e data affidabile. */
    appuntamento: Date | null;
    /**
     * `null` = il campo non è arrivato, cioè non lo sappiamo. Non è `false`, ed
     * è importante che resti distinguibile: entrambi bloccano l'intake, ma solo
     * uno dei due è un guasto da guardare (vedi `intakeSicuro`).
     */
    botHaRisposto: boolean | null;
    /** Perché un `appuntamento` presente nel payload NON è stato accettato. */
    appuntamentoScartato?: string;
}

export type NormalizeResult =
    | { ok: true; lead: LeadEntranteNormalizzato }
    | { ok: false; motivo: MotivoScarto; telefono: string | null };

export type MotivoScarto =
    | 'telefono_mancante'
    | 'telefono_non_normalizzabile'
    | 'telefono_troppo_corto'
    | 'chat_passata_a_una_persona';

/**
 * Stati in cui la conversazione col bot è VIVA.
 *
 * ATTENZIONE a cosa NON è: non è il discrimine fra un intake muto e uno che fa
 * partire l'apertura "Ciao, sono Marta…". La guardia dall'altro lato
 * (`apreSopraChatViva`, letta nel loro codice il 05/09) salta l'apertura su
 * qualunque conversazione senza `crm_lead_id`, e sulle righe di questa lista
 * quel campo è nullo per definizione — `closed` e `booked` inclusi. Il campo che
 * decide davvero è `botHaRisposto`: vedi `intakeSicuro`.
 *
 * Resta utile per leggere la lista (quante conversazioni sono vive) e basta.
 *
 * `replying` esiste perché in produzione restano righe ferme su quel valore; per
 * noi è `active`. Il ramo di default tiene: uno stato nuovo lato fornitore non
 * deve mai essere scambiato per "chat aperta" e far partire un'apertura.
 */
const STATI_CHAT_APERTA = new Set(['active', 'replying']);

export function chatApertaAlBot(statoBot: string | null | undefined): boolean {
    return STATI_CHAT_APERTA.has(String(statoBot ?? '').trim().toLowerCase());
}

/**
 * Se mandare l'intake a questa chat è muto. È l'UNICA condizione che conta, ed è
 * dura: non un'opzione, non un default scavalcabile da un flag.
 *
 * La guardia dell'altro lato salta l'apertura solo dopo aver visto che il bot ha
 * già scritto almeno una volta in quella conversazione:
 *
 *     if (aiOwner !== 'mario' || !haOutboundPartito) return false;
 *     if (crmLeadId === null) return true;
 *
 * Con zero outbound la prima riga esce subito e l'apertura parte. Normalmente
 * quella finestra dura qualche decina di secondi — il tempo della risposta a
 * testo libero, che NON passa dalla fascia 08:30-20:30 (quel gate vale per i
 * template). Ma non ha limite superiore: se il drain si pianta — modello
 * irraggiungibile, credito a zero, una raffica di 529 — la conversazione resta
 * adottata e muta per ore. Il credito a zero è già successo.
 *
 * In quella finestra `statoBot` è `active`, quindi guardare lo stato non
 * protegge da niente: serve proprio questo campo.
 *
 * `null` (campo non dichiarato: loro deploy vecchio, o un rollback) blocca come
 * `false`. Preferisco un lead che resta fermo un giro a un'apertura mandata a
 * qualcuno che ha scritto per chiedere altro.
 */
export function intakeSicuro(lead: Pick<LeadEntranteNormalizzato, 'botHaRisposto'>): boolean {
    return lead.botHaRisposto === true;
}

/**
 * Le chat passate a una persona sono escluse dalla lista dal fornitore
 * (`handed_off` non compare). Se comparisse comunque, un intake sopra sarebbe
 * la cosa sbagliata: la scartiamo qui invece di fidarci del filtro altrui.
 */
const STATO_PASSATA_A_UMANO = 'handed_off';

/**
 * Un nome plausibile per una persona. Non è una validazione anagrafica: è un
 * pavimento.
 *
 * Serve perché `nome` arriva da un sistema esterno e finisce dritto sulla card
 * che un GDO ha davanti quando chiama. Oggi il bot manda sempre `null` — nella
 * conversazione il nome non viene estratto da nessuna parte — ma il campo è nel
 * contratto, e il giorno che qualcuno lo riempie (l'ipotesi in piedi è farlo
 * estrarre al modello alla chiusura della chat) un'estrazione sbagliata
 * scriverebbe su quella card il nome di un'altra persona.
 *
 * Cosa ferma davvero: cifre, stringhe lunghissime, URL ed email, e le frasi —
 * "sono la mamma di Luca" ha cinque parole, un nome italiano completo ne ha al
 * massimo quattro ("Maria Teresa Del Giudice").
 *
 * Cosa NON ferma, e va detto: "Piacere sono Monia" passa. Un'estrazione che
 * consegna la frase invece del nome non la si corregge da qui — quella è
 * qualità dell'estrazione, e sta dall'altro lato. Qui si evita solo che
 * arrivi spazzatura riconoscibile.
 */
export function nomePlausibile(nome: string): boolean {
    if (nome.length < 2 || nome.length > 60) return false;
    if (/\d/.test(nome)) return false;
    if (/[@<>/\\|]|https?:/i.test(nome)) return false;
    return nome.split(/\s+/).filter(Boolean).length <= 4;
}

/** Un ISO senza fuso è ambiguo: l'appuntamento risulterebbe sfalsato di 1-2 ore. */
const HA_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

function parseData(raw: string | null | undefined): Date | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Valida e normalizza una riga della lista. Pura: nessun accesso al DB.
 *
 * Il telefono è l'unico campo davvero obbligatorio — è la chiave con cui il bot
 * riconosce la chat e l'unico modo che abbiamo di deduplicare. Tutto il resto ha
 * un fallback: `nome` è quasi sempre `null` (il messaggio è precompilato) e
 * `provenienza` resta grezza perché sulle statistiche di funnel deve restare
 * vero che quelle persone sono arrivate da Telegram o da un inbound spontaneo,
 * non da un funnel che non hanno mai visto.
 */
export function normalizzaLeadEntrante(raw: LeadEntranteRaw): NormalizeResult {
    const telefonoRaw = typeof raw.telefono === 'string' ? raw.telefono.trim() : '';
    if (!telefonoRaw) return { ok: false, motivo: 'telefono_mancante', telefono: null };

    const statoBot = String(raw.statoBot ?? '').trim().toLowerCase();
    if (statoBot === STATO_PASSATA_A_UMANO) {
        return { ok: false, motivo: 'chat_passata_a_una_persona', telefono: telefonoRaw };
    }

    const phone = normalizePhoneStrict(telefonoRaw);
    if (!phone) return { ok: false, motivo: 'telefono_non_normalizzabile', telefono: telefonoRaw };

    const personKey = personKeyOf(phone);
    if (!personKey) return { ok: false, motivo: 'telefono_troppo_corto', telefono: telefonoRaw };

    const nomeGrezzo = typeof raw.nome === 'string' ? raw.nome.trim() : '';
    // Un nome implausibile non fa scartare il lead: quella persona esiste e va
    // chiamata. Ricade sul fallback, come un nome assente.
    const nome = nomeGrezzo && nomePlausibile(nomeGrezzo) ? nomeGrezzo : '';
    const provenienza = typeof raw.provenienza === 'string' ? raw.provenienza.trim().toUpperCase() : '';
    const primoMessaggio = typeof raw.primoMessaggio === 'string' && raw.primoMessaggio.trim()
        ? raw.primoMessaggio.trim()
        : null;
    const esito = typeof raw.esito === 'string' && raw.esito.trim() ? raw.esito.trim().toUpperCase() : null;

    // L'appuntamento è l'unico campo di questa lista che, se sbagliato, manda le
    // Conferme a chiamare qualcuno per una call che non esiste. Contratto: è
    // valorizzato SOLO con esito APPUNTAMENTO. Qui si ricontrolla comunque, e si
    // pretende un fuso esplicito come già fa /api/bot/outcome.
    let appuntamento: Date | null = null;
    let appuntamentoScartato: string | undefined;
    const appuntamentoRaw = typeof raw.appuntamento === 'string' ? raw.appuntamento.trim() : '';
    if (appuntamentoRaw) {
        if (esito !== 'APPUNTAMENTO') {
            appuntamentoScartato = `data presente ma esito e' ${esito ?? 'nullo'}, non APPUNTAMENTO`;
        } else if (!HA_OFFSET.test(appuntamentoRaw)) {
            appuntamentoScartato = 'data senza fuso orario esplicito (atteso offset, es. +02:00)';
        } else {
            const d = parseData(appuntamentoRaw);
            if (!d) appuntamentoScartato = 'data non parsabile';
            else appuntamento = d;
        }
    } else if (esito === 'APPUNTAMENTO') {
        appuntamentoScartato = 'esito APPUNTAMENTO senza data';
    }

    return {
        ok: true,
        lead: {
            phone,
            personKey,
            name: nome || NOME_FALLBACK,
            funnel: provenienza || FUNNEL_FALLBACK,
            primoMessaggio,
            scrittoIl: parseData(raw.scrittoIl),
            conversationId: typeof raw.conversationId === 'number' ? raw.conversationId : null,
            statoBot: statoBot || 'sconosciuto',
            esito,
            appuntamento,
            botHaRisposto: typeof raw.botHaRisposto === 'boolean' ? raw.botHaRisposto : null,
            ...(appuntamentoScartato ? { appuntamentoScartato } : {}),
        },
    };
}

/** Un lead del CRM già esistente sullo stesso numero. */
export interface LeadEsistente {
    id: string;
    status: string;
    presentedAt: Date | null;
    createdAt: Date;
    assignedToId: string | null;
    companyId: string;
}

export type Azione =
    | { azione: 'crea'; lead: LeadEntranteNormalizzato }
    | {
        azione: 'collega';
        lead: LeadEntranteNormalizzato;
        esistente: LeadEsistente;
        /** Lead con storico: l'appuntamento dalla lista NON va applicato sopra. */
        bloccato: boolean;
    }
    | { azione: 'scarta'; motivo: MotivoScarto | 'duplicato_nel_batch' | 'altra_azienda'; telefono: string | null };

/**
 * Un lead è bloccato quando ha già prodotto storico. Stessa invariante di
 * `isLeadLocked` in contactRequests.ts, ma qui riguarda solo il ramo
 * "applica l'appuntamento che il bot aveva già fissato": su un lead che ha già
 * un appuntamento o una presenza latchata non si sovrascrive niente.
 */
function isBloccato(l: LeadEsistente): boolean {
    return l.status === 'APPOINTMENT' || l.presentedAt !== null;
}

/**
 * Decide cosa fare di ogni riga. Pura: il chiamante le passa i lead già
 * esistenti nel CRM indicizzati per personKey.
 *
 * Dedup per numero, come chiede il fornitore: se quel telefono è già un lead
 * nostro non se ne crea un altro — si manda l'intake con il `leadId` esistente,
 * ed è quello che fa uscire la riga dalla sua lista. Fra più lead con lo stesso
 * numero (succede: 1.708 gruppi sullo storico) si prende il più recente, che è
 * quello su cui la persona sta lavorando adesso.
 *
 * `esistentiPerAltraAzienda` è la stessa guardia cross-tenant del webhook AC: un
 * contatto che è già lead di Serenamente non deve generarne uno Fenice.
 */
export function pianificaAdozione(
    righe: LeadEntranteRaw[],
    esistentiPerPersonKey: Map<string, LeadEsistente[]>,
): Azione[] {
    const azioni: Azione[] = [];
    const vistiNelBatch = new Set<string>();

    for (const riga of righe) {
        const res = normalizzaLeadEntrante(riga);
        if (!res.ok) {
            azioni.push({ azione: 'scarta', motivo: res.motivo, telefono: res.telefono });
            continue;
        }
        const lead = res.lead;

        if (vistiNelBatch.has(lead.personKey)) {
            azioni.push({ azione: 'scarta', motivo: 'duplicato_nel_batch', telefono: lead.phone });
            continue;
        }
        vistiNelBatch.add(lead.personKey);

        const candidati = esistentiPerPersonKey.get(lead.personKey) ?? [];
        if (candidati.length === 0) {
            azioni.push({ azione: 'crea', lead });
            continue;
        }

        const fenice = candidati.filter((c) => c.companyId === 'fenice');
        if (fenice.length === 0) {
            azioni.push({ azione: 'scarta', motivo: 'altra_azienda', telefono: lead.phone });
            continue;
        }

        const piuRecente = fenice.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
        azioni.push({ azione: 'collega', lead, esistente: piuRecente, bloccato: isBloccato(piuRecente) });
    }

    return azioni;
}

export type FetchResult =
    | { ok: true; totale: number; totaleCompleto: number; righe: LeadEntranteRaw[] }
    | { ok: false; motivo: 'missing_env' | 'http_error' | 'network_error' | 'bad_response'; status?: number; detail?: string };

/**
 * Legge la lista dal fornitore. Stessa firma HMAC di `/api/bot/intake` e
 * `/api/bot/contatti-umani`: `x-bot-signature: sha256=<HMAC del corpo grezzo>`
 * con `BOT_WEBHOOK_SECRET`.
 *
 * Timeout largo (20s) e non i 5s del push: qui si aspetta una lista, non si
 * notifica un lead, e una lettura persa costa un giro intero.
 */
export async function fetchLeadEntranti(limit = 500): Promise<FetchResult> {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) return { ok: false, motivo: 'missing_env', detail: 'BOT_WEBHOOK_SECRET non impostato' };

    const url = process.env.BOT_LEAD_ENTRANTI_URL || LEAD_ENTRANTI_URL_DEFAULT;
    const rawBody = JSON.stringify({ limit });

    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-bot-signature': signPayload(rawBody, secret) },
            body: rawBody,
            signal: AbortSignal.timeout(20000),
        });
    } catch (e) {
        return { ok: false, motivo: 'network_error', detail: String(e) };
    }

    const testo = await res.text().catch(() => '');
    if (!res.ok) {
        return { ok: false, motivo: 'http_error', status: res.status, detail: testo.slice(0, 400) };
    }

    let body: unknown;
    try {
        body = JSON.parse(testo);
    } catch {
        return { ok: false, motivo: 'bad_response', status: res.status, detail: testo.slice(0, 400) };
    }

    const b = body as { ok?: boolean; totale?: number; totaleCompleto?: number; lead?: unknown };
    if (!Array.isArray(b?.lead)) {
        return { ok: false, motivo: 'bad_response', status: res.status, detail: 'campo `lead` mancante o non array' };
    }

    const righe = b.lead as LeadEntranteRaw[];
    return {
        ok: true,
        righe,
        totale: typeof b.totale === 'number' ? b.totale : righe.length,
        // Se `totaleCompleto` > `totale` la lista è tagliata dal `limit`: il
        // chiamante rifà la chiamata con un valore più alto.
        totaleCompleto: typeof b.totaleCompleto === 'number' ? b.totaleCompleto : righe.length,
    };
}
