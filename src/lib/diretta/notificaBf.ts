// Notifica "lead Black Friday arrivato" (PO 09/11/2026): ogni volta che a un
// GDO arriva un lead BF (ridato dal bot, assegnato a mano, spostato) la
// campanella glielo dice con il toast in diretta, da qualunque pagina. I BF
// stanno sempre in cima alla prima chiamata e non vanno mai in scorta.
//
// Funzioni pure (le usa anche la Topbar). La scrittura sta in notificaBfDb.ts:
// la fanno i percorsi che assegnano (bot che ridà, redistribuzione admin,
// riequilibrio automatico) e, come rete di sicurezza, il caricamento della
// pipeline del GDO. L'id contiene lead, GDO e ora di arrivo (ricostruita dagli
// eventi come nella pipeline, oraArrivo): chi la scrive per secondo va in
// conflitto sulla chiave e non la duplica; un nuovo arrivo dello stesso lead
// allo stesso GDO è un'altra notifica.

import { eBlackFriday } from './scorta'

export const TIPO_NOTIFICA_BF = 'lead_bf_arrivato'
export const TITOLO_NOTIFICA_BF = 'Lead Black Friday: chiamalo subito'
/** Arrivi più vecchi di così non si notificano più (la rete di sicurezza non riaccende il passato). */
export const FINESTRA_NOTIFICA_BF_MS = 72 * 3_600_000

const CHIUSI = new Set(['REJECTED', 'APPOINTMENT'])

export function idNotificaBf(leadId: string, gdoId: string, arrivo: Date): string {
    return `${TIPO_NOTIFICA_BF}:${leadId}:${gdoId}:${arrivo.getTime()}`
}

export interface ArrivoBf {
    leadId: string
    gdoId: string
    nome: string | null | undefined
    funnel: string | null | undefined
    status: string
    arrivo: Date
    companyId: string
}

/** Va notificato? Lead BF aperto, arrivato nella finestra. */
export function daNotificareBf(a: ArrivoBf, ora: Date): boolean {
    if (!eBlackFriday({ funnel: a.funnel })) return false
    if (CHIUSI.has(a.status)) return false
    const eta = ora.getTime() - a.arrivo.getTime()
    return eta >= -60_000 && eta <= FINESTRA_NOTIFICA_BF_MS
}

/** La riga per la tabella notifications. Nessun riferimento al bot né al telefono. */
export function notificaBf(a: ArrivoBf) {
    const nome = a.nome?.trim() || 'Un lead Black Friday'
    return {
        id: idNotificaBf(a.leadId, a.gdoId, a.arrivo),
        recipientUserId: a.gdoId,
        type: TIPO_NOTIFICA_BF,
        title: TITOLO_NOTIFICA_BF,
        body: `${nome} è in cima alla prima chiamata. Priorità su tutto.`,
        metadata: { leadId: a.leadId, coda: 'first', funnel: a.funnel ?? null },
        companyId: a.companyId,
    }
}
