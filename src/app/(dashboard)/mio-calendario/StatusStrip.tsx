"use client"

/**
 * La striscia di stato in testa a "Il mio Calendario": dice a che punto è la
 * settimana (compilata, proposta dalla settimana tipo, in scadenza, multata,
 * esente). Solo presentazione: riceve la vista già calcolata e un `now`
 * aggiornato dal genitore, non ha stato proprio.
 */

import type { CalendarWeekView } from "@/app/actions/salesCalendarActions"
import { weekdayFmt, dateSlashFmt, timeFmt, formatCountdown } from "@/components/calendar/calendarFormat"

export function StatusStrip({ data, now, onOpenTemplate }: { data: CalendarWeekView; now: Date; onOpenTemplate: () => void }) {
    const deadline = new Date(data.deadlineIso)

    if (data.submittedAtIso) {
        const submitted = new Date(data.submittedAtIso)
        // ATTENZIONE: `fromTemplate` da solo NON basta a dire "compilata dal
        // modello" — torna vero anche per una proposta mai materializzata
        // (nessun piano a DB, `submittedAtIso` nullo). Qui dentro
        // `submittedAtIso` è già garantito non nullo da questo `if`, quindi
        // combinato con `fromTemplate` significa davvero "il cron l'ha
        // materializzata" (vedi il commento su `CalendarWeekView.fromTemplate`
        // in `salesCalendarActions.ts`).
        if (data.fromTemplate) {
            return (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    <p>
                        {`Compilata dalla tua settimana tipo il ${weekdayFmt.format(submitted)} ${dateSlashFmt.format(submitted)} alle ${timeFmt.format(submitted)} — ${data.slotCount} ore dichiarate. Puoi modificarla comunque.`}
                    </p>
                    <div className="mt-1">
                        <button
                            type="button"
                            onClick={onOpenTemplate}
                            className="cursor-pointer font-semibold text-emerald-900 underline hover:no-underline"
                        >
                            Gestisci la settimana tipo
                        </button>
                    </div>
                </div>
            )
        }
        return (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {`Compilato ${weekdayFmt.format(submitted)} ${dateSlashFmt.format(submitted)} alle ${timeFmt.format(submitted)} — ${data.slotCount} ore dichiarate`}
                {data.late && ' (in ritardo)'}
            </div>
        )
    }
    if (data.isExempt) {
        return (
            <div className="rounded-xl border border-ash-200 bg-ash-50 px-4 py-3 text-sm text-ash-600">
                Sei esente dall&apos;obbligo di compilazione.
            </div>
        )
    }
    if (data.penaltyIso) {
        const penalty = new Date(data.penaltyIso)
        return (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {`Calendario non compilato: multa di 50 € registrata ${weekdayFmt.format(penalty)} ${dateSlashFmt.format(penalty)}. Puoi compilare comunque.`}
            </div>
        )
    }
    if (now < deadline) {
        const ms = deadline.getTime() - now.getTime()
        return (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p>{`Compila entro ${weekdayFmt.format(deadline)} ${timeFmt.format(deadline)} — mancano ${formatCountdown(ms)}`}</p>
                {data.template.length > 0 && (
                    // Il modello esiste ma questa settimana non ha ancora un
                    // piano a DB (`submittedAtIso` nullo sopra): è la proposta
                    // del modello, non ancora una dichiarazione. Vero fino a
                    // che il cron (o il prossimo salvataggio del modello) la
                    // materializza.
                    <p className="mt-1 text-xs text-amber-700">
                        Hai una settimana tipo: se non intervieni si compila da sola entro la scadenza.
                    </p>
                )}
            </div>
        )
    }
    // Scadenza passata ma la multa non risulta ancora registrata (es. cron non
    // ancora eseguito): non inventiamo un importo, solo lo stato dei fatti.
    return (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {`Calendario non compilato: la scadenza delle ${timeFmt.format(deadline)} di ${weekdayFmt.format(deadline)} è passata.`}
        </div>
    )
}
