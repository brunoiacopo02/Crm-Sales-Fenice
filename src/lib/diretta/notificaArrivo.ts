// Notifica "appena arrivato" (PO 25/10/2026 mattina): quando un lead vergine
// arriva a un GDO, la campanella glielo dice anche se in quel momento sta
// lavorando le seconde o le terze chiamate. Cliccandola si apre il lead.
//
// Funzioni pure (le usa anche la Topbar, quindi niente moduli Node qui): tipo,
// id, testo e metadata. La scrittura sta in notificaArrivoDb.ts e la fa il
// webhook ActiveCampaign dopo aver risposto, con after().

export const TIPO_NOTIFICA_APPENA_ARRIVATO = 'lead_appena_arrivato'

export const TITOLO_APPENA_ARRIVATO = 'Appena arrivato: chiamalo subito'

/**
 * Id stabile per la coppia lead e GDO: scritta due volte (un retry, un doppio
 * passaggio) resta una sola notifica, perché la seconda va in conflitto sulla
 * chiave e non si scrive.
 */
export function idNotificaAppenaArrivato(leadId: string, gdoId: string): string {
    return `${TIPO_NOTIFICA_APPENA_ARRIVATO}:${leadId}:${gdoId}`
}

export interface ArrivoDaNotificare {
    leadId: string
    gdoId: string
    nome: string | null | undefined
    funnel?: string | null
    companyId: string
}

/** La riga per la tabella notifications. Nessun riferimento al bot né al telefono. */
export function notificaAppenaArrivato(a: ArrivoDaNotificare) {
    const nome = a.nome?.trim() || 'Un lead nuovo'
    return {
        id: idNotificaAppenaArrivato(a.leadId, a.gdoId),
        recipientUserId: a.gdoId,
        type: TIPO_NOTIFICA_APPENA_ARRIVATO,
        title: TITOLO_APPENA_ARRIVATO,
        body: `${nome} è in cima alla prima chiamata.`,
        metadata: { leadId: a.leadId, coda: 'first', funnel: a.funnel ?? null },
        companyId: a.companyId,
    }
}
