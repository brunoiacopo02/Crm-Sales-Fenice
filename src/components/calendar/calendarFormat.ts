/**
 * Formattazione condivisa del modulo calendario: nessuno stato, nessun DOM,
 * niente `"use client"` (sono funzioni pure, le importa sia il server sia il
 * client). Vivevano in `MioCalendarioClient.tsx`, e `formatWeekRange` era
 * duplicata parola per parola anche in `CalendariVenditoriClient.tsx`: due
 * copie della stessa etichetta sono due modi di scriverla il giorno che una
 * delle due cambia.
 *
 * Tutti i formattatori sono fissati su Europe/Rome: mai `getHours()`/`getDay()`
 * locali, come nel resto del modulo (vedi `calendarSlots.ts`).
 */

export const weekdayFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' })
export const dateSlashFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' })
export const timeFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const dayOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric' })
export const monthOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long' })

export function formatCountdown(ms: number): string {
    if (ms <= 0) return '0m'
    const totalMinutes = Math.floor(ms / 60_000)
    const days = Math.floor(totalMinutes / (24 * 60))
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
    const minutes = totalMinutes % 60
    if (days > 0) return `${days}g ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
}

export function formatWeekRange(weekStartIso: string): string {
    const start = new Date(weekStartIso)
    const end = new Date(start.getTime() + 5 * 86_400_000) // sabato: mai/dom mai attraversata da DST
    const startMonth = monthOnlyFmt.format(start)
    const endMonth = monthOnlyFmt.format(end)
    const startDay = dayOnlyFmt.format(start)
    const endDay = dayOnlyFmt.format(end)
    return startMonth === endMonth
        ? `${startDay} – ${endDay} ${endMonth}`
        : `${startDay} ${startMonth} – ${endDay} ${endMonth}`
}

export function capitalize(s: string): string {
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
