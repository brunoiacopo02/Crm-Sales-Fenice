import type { LancioPayloadField } from '@/lib/lancio/intake';

/** Report strutturato che il bot scrive su leads.botReport (tutti i campi opzionali). */
export interface BotReport {
    summary?: string;
    painPoints?: string[];
    budgetSignal?: string;
    urgency?: string;       // 'alta' | 'media' | 'bassa' (libero, non vincolato a livello tipo)
    objections?: string[];
    levaConsigliata?: string;
}

/** Un lead precedente con lo stesso numero: al bot serve per capire che è la stessa chat. */
export interface PreviousLeadRef {
    leadId: string;
    status: string;
    outcome: string | null;
    createdAt: string;
}

/** Payload inviato al webhook del bot quando un lead viene assegnato all'account bot. */
export interface BotIntakePayload {
    leadId: string;
    name: string | null;
    phone: string;
    email: string | null;
    funnel: string | null;
    companyId: string;
    /**
     * Ultime 10 cifre del telefono normalizzato: la stessa persona ha sempre la
     * stessa chiave, anche quando da noi diventa un lead nuovo. Il fornitore
     * deduplica per numero e non può fare altrimenti — una persona ha una chat
     * sola. Con questa capisce da solo che è la stessa conversazione.
     * `acContactId` non basterebbe: copre il 52% dei casi, gli import manuali
     * e i CSV non ce l'hanno.
     */
    personKey?: string;
    /** I lead precedenti con la stessa personKey, dal più recente. Max 10. */
    previousLeadIds?: PreviousLeadRef[];
    /**
     * Lancio (contratto v1.6, spec 2026-09-14 §6.1). Presente SOLO sui lead del
     * lancio: il bot apre con il template di benvenuto del lancio invece
     * dell'apertura di Mario. Assente = flusso attuale, invariato.
     */
    lancio?: LancioPayloadField;
    /**
     * Lead del riscaldamento: il bot deve far nascere la chat SUL numero nuovo,
     * non su quello che gli assegnerebbe la sua quota.
     *
     * La quota del bot e' globale: alzarla manderebbe al numero nuovo anche i
     * lead ordinari, abbassarla terrebbe fuori anche questi. L'unico modo di
     * mandare al numero in riscaldamento *solo* i lead del riscaldamento e'
     * dirglielo qui.
     */
    riscaldamento?: boolean;
    /**
     * Quale numero del bot apre la chat: 1 = storico, 2 = nuovo.
     *
     * Bot 2 ha un tetto giornaliero (vedi numeroBot.ts) perche' un numero si
     * brucia col volume. Il bot ha comunque un controllo suo: qui si decide,
     * li' si verifica.
     */
    numeroBot?: 1 | 2;
}
