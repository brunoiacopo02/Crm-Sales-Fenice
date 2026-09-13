/**
 * Regola del fissaggio: una Conferma può dare un appuntamento a un venditore
 * solo su un'ora che lui ha dichiarato, non ha bloccato e non ha già occupato.
 *
 * Un'ora dichiarata è un'ora OFFERTA, e un appuntamento la consuma: due lead
 * alla stessa ora dallo stesso venditore sono un doppio buco (uno dei due non
 * viene ricevuto), non una disponibilità doppia.
 *
 * Decisione PO 2026-09-12, che ribalta il precedente "avviso, non blocco":
 * il muro c'è, ma la Conferma può scavalcarlo scrivendo un motivo, che resta
 * tracciato. Admin e manager non sono soggetti.
 *
 * Pura: riceve fatti già letti, non tocca il DB.
 */

import { slotLabel } from './calendarSlots'

export type BookingRefusal = 'fuori_griglia' | 'non_dichiarato' | 'bloccato' | 'gia_occupato'

/**
 * `freeHours` lo aggiunge `checkBookingAllowed` (che ha il DB sotto mano) allo
 * spread di questa decisione: la funzione pura qui sotto non lo calcola.
 */
export type BookingDecision =
    | { ok: true }
    | { ok: false; reason: BookingRefusal; freeHours?: string[] }

/**
 * `slot` è il risultato di `slotStartFor(appointmentDate)`: null significa
 * che quell'ora non esiste nella griglia (prima delle 9, dopo le 21, domenica)
 * e quindi nessuno può averla dichiarata.
 *
 * L'ordine dei controlli è anche l'ordine del messaggio: la causa più a monte
 * vince, così la Conferma legge il problema vero e non il suo effetto.
 */
export function bookingCheck(input: {
    slot: Date | null
    declared: boolean
    blocked: boolean
    occupied: boolean
}): BookingDecision {
    if (!input.slot) return { ok: false, reason: 'fuori_griglia' }
    if (!input.declared) return { ok: false, reason: 'non_dichiarato' }
    if (input.blocked) return { ok: false, reason: 'bloccato' }
    if (input.occupied) return { ok: false, reason: 'gia_occupato' }
    return { ok: true }
}

/**
 * Messaggi scritti per la Conferma che li legge, non per chi legge i log.
 *
 * `freeHours` sono le ore davvero prenotabili di QUEL giorno: un rifiuto che
 * non dice cosa fare costringe a indovinare, e indovinare finisce in forzatura.
 */
export function bookingRefusalMessage(
    reason: BookingRefusal,
    appointmentAt: Date,
    freeHours: string[] = [],
): string {
    const ora = slotLabel(appointmentAt)
    const base = (() => {
        switch (reason) {
            case 'fuori_griglia':
                return "Quest'ora è fuori dal calendario dei venditori (si dichiara dalle 9 alle 21, da lunedì a sabato): nessuno può averla resa disponibile."
            case 'non_dichiarato':
                return `Il venditore non ha dichiarato disponibile le ${ora}.`
            case 'bloccato':
                return `Il venditore ha bloccato le ${ora}.`
            case 'gia_occupato':
                return `Il venditore ha già un appuntamento alle ${ora}.`
        }
    })()

    if (freeHours.length > 0) return `${base} Quel giorno è libero alle ${freeHours.join(', ')}.`
    // Fuori griglia il giorno può non esistere affatto (domenica): suggerire
    // "un altro giorno" lì sarebbe rumore, il messaggio base già basta.
    if (reason === 'fuori_griglia') return base
    return `${base} Quel giorno non ha altre ore libere: scegli un altro giorno o un altro venditore.`
}

/**
 * Il motivo con cui si scavalca il muro finisce in supervisione e viene letto
 * da un'altra persona giorni dopo: "ok", "." o "urgente" non spiegano nulla.
 * Dieci caratteri non fanno una spiegazione, ma tolgono di mezzo il click
 * riflesso su un campo obbligatorio.
 *
 * Ritorna `null` se il motivo va bene, altrimenti il messaggio da mostrare.
 */
export function forceReasonProblem(reason: string | null | undefined): string | null {
    if ((reason ?? '').trim().length >= 10) return null
    return 'Scrivi almeno 10 caratteri: questo motivo finisce in supervisione.'
}
