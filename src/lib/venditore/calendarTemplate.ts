/**
 * La "settimana tipo" di un venditore: quali ore offre di solito.
 *
 * Decisione PO 2026-09-12 (opzione B): il modello vale da sé — le settimane di
 * chi ne ha uno risultano compilate in automatico, e quindi non producono la
 * multa del lunedì. Per far funzionare muro, copertura e multa da assenza senza
 * riscriverli, il modello non resta virtuale: viene MATERIALIZZATO in slot veri
 * dal giro di cron. Un'ora materializzata è una dichiarazione a tutti gli
 * effetti, multabile per assenza: è il senso della scelta, non un effetto
 * collaterale.
 *
 * Puro: nessun accesso al DB, `now` arriva da fuori.
 */

import { weekSlots, romeDow, romeHour, SLOT_FIRST_HOUR, SLOT_LAST_HOUR, SLOT_DAYS } from './calendarSlots'

/** dow: 1 = lunedì … 6 = sabato. La domenica non è compilabile. */
export interface TemplateSlot {
    dow: number
    hour: number
}

export function templateKey(dow: number, hour: number): string {
    return `${dow}@${hour}`
}

export function isValidTemplateSlot(s: TemplateSlot): boolean {
    return Number.isInteger(s.dow) && s.dow >= 1 && s.dow <= SLOT_DAYS
        && Number.isInteger(s.hour) && s.hour >= SLOT_FIRST_HOUR && s.hour <= SLOT_LAST_HOUR
}

/**
 * Gli istanti che il modello dichiara nella settimana data, escluse le ore già
 * trascorse: materializzare un'ora passata sarebbe una dichiarazione che nessuno
 * ha potuto onorare, e la regola "le ore passate non si modificano" la
 * renderebbe pure incancellabile.
 */
export function slotsFromTemplate(template: TemplateSlot[], weekStart: Date, now: Date): Date[] {
    const voluti = new Set(template.filter(isValidTemplateSlot).map(s => templateKey(s.dow, s.hour)))
    if (voluti.size === 0) return []
    return weekSlots(weekStart).filter(slot =>
        voluti.has(templateKey(romeDow(slot), romeHour(slot))) && slot > now,
    )
}
