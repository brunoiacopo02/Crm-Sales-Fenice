/**
 * Esiti "di stato" del bot su un lead già scartato (PO 29/10/2026).
 *
 * /api/bot/outcome non guardava lo status: un NON_RISPOSTO/INTERROTTO su un lead
 * REJECTED ancora del bot lo rimetteva NEW e lo ridava a un GDO, annullando lo
 * scarto (o la chiusura dei doppioni del 29/10). Questi quattro esiti ora si
 * ignorano (200, nessuna scrittura sul lead).
 *
 * APPUNTAMENTO, NOTA, CONTATTO_UMANO, SPOSTAMENTO e DISDETTA_VERIFICATA passano come
 * prima: un lead scartato che fissa o chiede una persona vale più dello scarto.
 * Verifica sui 60 giorni prima del 29/10: 216 esiti su 148 lead già scartati,
 * nessuno di questi quattro tipi ha portato a un appuntamento, una presenza o una
 * vendita.
 */
const ESITI_DI_STATO = new Set(['NON_RISPOSTO', 'INTERROTTO', 'RICHIAMO', 'DA_SCARTARE'])

export function ignoraEsitoSuScartato(status: string | null | undefined, outcome: string): boolean {
    return status === 'REJECTED' && ESITI_DI_STATO.has(outcome)
}
