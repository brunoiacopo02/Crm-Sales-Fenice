/**
 * Regola del fissaggio: una Conferma può dare un appuntamento a un venditore
 * solo su un'ora che lui ha dichiarato e non ha bloccato.
 *
 * Decisione PO 2026-09-12, che ribalta il precedente "avviso, non blocco":
 * il muro c'è, ma la Conferma può scavalcarlo scrivendo un motivo, che resta
 * tracciato. Admin e manager non sono soggetti.
 *
 * Pura: riceve fatti già letti, non tocca il DB.
 */

import { slotLabel } from './calendarSlots'

export type BookingRefusal = 'fuori_griglia' | 'non_dichiarato' | 'bloccato'

export type BookingDecision = { ok: true } | { ok: false; reason: BookingRefusal }

/**
 * `slot` è il risultato di `slotStartFor(appointmentDate)`: null significa
 * che quell'ora non esiste nella griglia (prima delle 9, dopo le 21, domenica)
 * e quindi nessuno può averla dichiarata.
 */
export function bookingCheck(input: {
    slot: Date | null
    declared: boolean
    blocked: boolean
}): BookingDecision {
    if (!input.slot) return { ok: false, reason: 'fuori_griglia' }
    if (!input.declared) return { ok: false, reason: 'non_dichiarato' }
    if (input.blocked) return { ok: false, reason: 'bloccato' }
    return { ok: true }
}

/** Messaggi scritti per la Conferma che li legge, non per chi legge i log. */
export function bookingRefusalMessage(reason: BookingRefusal, appointmentAt: Date): string {
    const ora = slotLabel(appointmentAt)
    switch (reason) {
        case 'fuori_griglia':
            return "Quest'ora è fuori dal calendario dei venditori (si dichiara dalle 9 alle 21, da lunedì a sabato): nessuno può averla resa disponibile."
        case 'non_dichiarato':
            return `Il venditore non ha dichiarato disponibile le ${ora}.`
        case 'bloccato':
            return `Il venditore ha bloccato le ${ora}.`
    }
}
