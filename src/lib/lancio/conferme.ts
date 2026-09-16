/**
 * Regole pure della board Conferme per i lead del lancio (spec §4.5).
 *
 * Chi è "lancio" per le Conferme, chi va in cima alla prima chiamata, che
 * etichetta porta, come si leggono le risposte di riscaldamento del bot.
 * Niente DB: getConfermeAppointments passa le righe, la riga della board, lo
 * Storico e il drawer chiamano le stesse funzioni. Una regola, un posto.
 *
 * "In cima" funziona come il badge "Aveva detto sì" dei GDO
 * (pipelineActions.recoverableFirst): sort stabile per priorità, l'ordine
 * del DB resta identico dentro i gruppi.
 */
import { CALL_NOW_MAX_ATTEMPTS, LANCIO_BUCKET, type LancioBotInfo } from './config'

export interface LancioConfermeFields {
    launchBucket: string | null
    status: string
    lancioScelta: string | null
    lancioCallNowAttempts: number | null
    salespersonUserId: string | null
    confirmationsOutcome: string | null
}

/** Lead del bucket lancio con un appuntamento: l'unico che le Conferme vedono. */
export function isLeadLancio(lead: Pick<LancioConfermeFields, 'launchBucket' | 'status'>, bucket: string = LANCIO_BUCKET): boolean {
    return lead.launchBucket === bucket && lead.status === 'APPOINTMENT'
}

/**
 * Il venditore di turno ha fatto tre chiamate a vuoto e il lead è passato alle
 * Conferme (assunzione A1, scritto da recordLancioCallNowNoAnswer): la scelta
 * resta 'chiamata_subito' ma il venditore è stato tolto.
 */
export function isCallNowHandoff(lead: Pick<LancioConfermeFields, 'lancioScelta' | 'lancioCallNowAttempts' | 'salespersonUserId'>): boolean {
    return lead.lancioScelta === 'chiamata_subito'
        && !lead.salespersonUserId
        && (lead.lancioCallNowAttempts ?? 0) >= CALL_NOW_MAX_ATTEMPTS
}

/**
 * 1 = in cima alla prima chiamata: appuntamento del pomeriggio o di dopodomani
 * scelto in chat col bot, oppure tornato dal venditore dopo tre NR, e ancora
 * senza esito Conferme. 0 = ordine normale (compresi i mattina: sono già
 * confermati, nessuna chiamata).
 */
export function lancioPriority(lead: LancioConfermeFields, bucket: string = LANCIO_BUCKET): 0 | 1 {
    if (!isLeadLancio(lead, bucket)) return 0
    if (lead.confirmationsOutcome) return 0
    if (lead.lancioScelta === 'app_pomeriggio' || lead.lancioScelta === 'app_dopodomani') return 1
    if (isCallNowHandoff(lead)) return 1
    return 0
}

/** Copia ordinata: i lancio prima, poi tutti gli altri nell'ordine in cui erano. */
export function lancioFirst<T extends { lead: LancioConfermeFields }>(rows: T[], bucket: string = LANCIO_BUCKET): T[] {
    return [...rows].sort((a, b) => lancioPriority(b.lead, bucket) - lancioPriority(a.lead, bucket))
}

/** Testo del tooltip del badge e del blocco nel drawer. `handoff` vince sulla scelta. */
export function lancioSceltaLabel(scelta: string | null, handoff = false): string {
    if (handoff) return 'Tre chiamate a vuoto del venditore di turno: da richiamare'
    switch (scelta) {
        case 'chiamata_subito': return 'Ha chiesto la chiamata subito: in mano al venditore di turno'
        case 'app_mattina': return 'Appuntamento la mattina dopo, già confermato dal bot: nessuna chiamata'
        case 'app_pomeriggio': return 'Appuntamento il pomeriggio dopo, scelto in chat col bot'
        case 'app_dopodomani': return 'Appuntamento dopodomani mattina, scelto in chat col bot'
        case 'followup': return 'Ha risposto al follow-up del giorno dopo: flusso standard'
        default: return 'Lead del lancio Web Dev AI'
    }
}

/** Le risposte di riscaldamento in ordine, da un jsonb che può essere qualunque cosa. */
export function lancioBotRisposte(info: unknown): string[] {
    if (!info || typeof info !== 'object' || Array.isArray(info)) return []
    const risposte = (info as LancioBotInfo).risposte
    if (!Array.isArray(risposte)) return []
    return risposte
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
        .map(r => r.trim())
}
