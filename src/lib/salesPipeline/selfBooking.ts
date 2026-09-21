/**
 * Il muro del fissaggio per il venditore che si prenota da solo.
 *
 * E' il muro delle Conferme (`bookingCheck`) meno un rifiuto: 'non_dichiarato'
 * non si applica. Un'ora che il venditore non ha dichiarato resta prenotabile
 * da lui, perche' e' il suo calendario e mandarlo a compilare la griglia
 * mentre ha il cliente al telefono farebbe perdere l'appuntamento. Restano
 * duri gli altri tre: fuori griglia, bloccata, gia' occupata — quelli non sono
 * preferenze, sono ore in cui l'appuntamento non si terrebbe.
 *
 * Puro: riceve fatti gia' letti, non tocca il DB.
 */

import { bookingCheck } from '../venditore/calendarBooking'
import { slotLabel } from '../venditore/calendarSlots'

export type SelfBookingRefusal = 'fuori_griglia' | 'bloccato' | 'gia_occupato'

export type SelfBookingDecision =
    | { ok: true }
    | { ok: false; reason: SelfBookingRefusal; message: string }

export function selfBookingCheck(input: {
    slot: Date | null
    blocked: boolean
    occupied: boolean
    at: Date
}): SelfBookingDecision {
    // `declared: true` disattiva il solo rifiuto che qui non vogliamo, e ci
    // lascia l'ordine dei controlli gia' collaudato del muro delle Conferme.
    const base = bookingCheck({
        slot: input.slot,
        declared: true,
        blocked: input.blocked,
        occupied: input.occupied,
    })
    if (base.ok) return { ok: true }

    const reason = base.reason as SelfBookingRefusal
    const ora = input.slot ? slotLabel(input.slot) : slotLabel(input.at)
    const message = (() => {
        switch (reason) {
            case 'fuori_griglia':
                return "Quest'ora e' fuori dal calendario (si fissa dalle 9 alle 21, da lunedi a sabato)."
            case 'bloccato':
                return `Hai bloccato le ${ora}: sbloccale dal tuo calendario, oppure scegli un'altra ora.`
            case 'gia_occupato':
                return `Hai gia' un appuntamento alle ${ora}.`
        }
    })()
    return { ok: false, reason, message }
}
