"use client"

import { useAuth } from "@/components/AuthProvider"
import { giorniAmmessiAppuntamento } from "@/lib/appointmentWindow"

/**
 * I due giorni in cui questo utente puo' fissare un appuntamento (titolare
 * 24/11/2026), oppure `undefined` se non ha il vincolo: lo hanno solo i GDO.
 * Stessa convenzione del server (`currentTenant`: ruolo mancante = 'GDO').
 * Mentre l'utente si carica non c'e' vincolo lato client: il server controlla comunque.
 * Si ricalcola a ogni render, cosi' una pagina lasciata aperta oltre mezzanotte non resta indietro.
 */
export function useGiorniAppuntamentoGdo(): [string, string] | undefined {
    const { user } = useAuth()
    if (!user) return undefined
    const ruolo = user.user_metadata?.role ?? 'GDO'
    return ruolo === 'GDO' ? giorniAmmessiAppuntamento(new Date()) : undefined
}

/** Vero se `valore` ('YYYY-MM-DD[THH:MM]') e' compilato ed esce dai giorni ammessi. */
export function fuoriFinestraAppuntamento(valore: string, giorni: [string, string] | undefined): boolean {
    return !!giorni && /^\d{4}-\d{2}-\d{2}/.test(valore) && !giorni.includes(valore.slice(0, 10))
}
