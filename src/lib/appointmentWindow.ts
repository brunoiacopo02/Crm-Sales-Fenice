/**
 * Finestra in cui un GDO può fissare un appuntamento (titolare 24/11/2026):
 * i DUE giorni lavorativi successivi a oggi, saltando la domenica. Mai oggi,
 * mai il passato, mai oltre il secondo giorno. Le festività non sono gestite.
 *
 * Tutto in giorni di calendario Europe/Rome ('YYYY-MM-DD'): non conta il fuso
 * del browser né UTC. Funzioni pure, usate sia dal client (campo data) sia
 * dal server (Server Action), che è il controllo che vale.
 */
import { toRomeDateStr } from './dateUtils'
import { nextWorkDayRome } from './conferme/boardWindow'

/** I due giorni ammessi ('YYYY-MM-DD' di Roma), dal più vicino al più lontano. */
export function giorniAmmessiAppuntamento(now: Date): [string, string] {
    const g1 = nextWorkDayRome(now)
    // Mezzogiorno UTC: il giorno di Roma coincide con quello UTC.
    const g2 = nextWorkDayRome(new Date(`${g1}T12:00:00Z`))
    return [g1, g2]
}

/** Il giorno di Roma di `quando`: stringa 'YYYY-MM-DD[THH:MM]' (già ora di Roma) oppure istante. */
function giornoDi(quando: string | Date): string | null {
    if (typeof quando === 'string') {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(quando)
        return m ? m[1] : null
    }
    if (isNaN(quando.getTime())) return null
    return toRomeDateStr(quando)
}

export function appuntamentoAmmesso(quando: string | Date, now: Date): boolean {
    const giorno = giornoDi(quando)
    if (!giorno) return false
    return giorniAmmessiAppuntamento(now).includes(giorno)
}

/** 'mercoledì 25/11' */
export function etichettaGiornoAppuntamento(giorno: string): string {
    const [y, m, d] = giorno.split('-').map(Number)
    const nome = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'long' })
        .format(new Date(Date.UTC(y, m - 1, d, 12)))
    return `${nome} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

export function messaggioFinestraAppuntamento(now: Date): string {
    const [a, b] = giorniAmmessiAppuntamento(now)
    return `L'appuntamento si può fissare solo per ${etichettaGiornoAppuntamento(a)} o ${etichettaGiornoAppuntamento(b)}.`
}

export function controllaAppuntamentoGdo(
    quando: string | Date | null | undefined,
    now: Date,
): { ok: true } | { ok: false; error: string } {
    if (!quando || !giornoDi(quando)) return { ok: false, error: "Data dell'appuntamento non valida." }
    return appuntamentoAmmesso(quando, now) ? { ok: true } : { ok: false, error: messaggioFinestraAppuntamento(now) }
}
