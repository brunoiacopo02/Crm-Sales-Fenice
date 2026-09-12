"use client"

/**
 * Client della pagina "Il mio Calendario". Due viste dietro un interruttore:
 * il proprio calendario (spunta ore, blocca/sblocca imprevisti) e la
 * copertura squadra (sola lettura, motivo per cui il PO ha chiesto la
 * funzione: vedere le fasce scoperte in anticipo).
 */

import { useState, useEffect, useMemo, useCallback, useTransition } from "react"
import { ChevronLeft, ChevronRight, Loader2, CalendarClock } from "lucide-react"
import {
    getCalendarWeek, saveCalendarWeek, blockSlot, unblockSlot, type CalendarWeekView,
} from "@/app/actions/salesCalendarActions"
import { weekSlots, weekStartFor, addWeeks, slotKey, slotLabel } from "@/lib/venditore/calendarSlots"
import { MANUAL_BLOCK_NOTICE_MINUTES } from "@/lib/venditore/calendarRules"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"
import { SlotGrid, type SlotCellView, type SlotMenuOption, type SlotMenuItemView } from "@/components/calendar/SlotGrid"
import { CoverageLegend } from "@/components/calendar/CoverageLegend"
import { TemplateEditor } from "@/components/calendar/TemplateEditor"

interface Props {
    initial: CalendarWeekView
    role: string
}

const MAX_WEEKS_FORWARD = 3

const weekdayFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' })
const dateSlashFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric' })
const monthOnlyFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', month: 'long' })

function formatCountdown(ms: number): string {
    if (ms <= 0) return '0m'
    const totalMinutes = Math.floor(ms / 60_000)
    const days = Math.floor(totalMinutes / (24 * 60))
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
    const minutes = totalMinutes % 60
    if (days > 0) return `${days}g ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
}

function formatWeekRange(weekStartIso: string): string {
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

function readOnlyNote(editable: boolean, reason: CalendarWeekView['readOnlyReason']): string | null {
    if (editable) return null
    if (reason === 'settimana_passata') return 'Settimana passata: sola lettura.'
    if (reason === 'altro_venditore') return 'Stai guardando il calendario di un altro venditore: sola lettura.'
    // Caso limite: un non-VENDITORE (admin/manager/conferme) guarda il proprio
    // account. Niente motivo specifico dal contratto dati: non lasciarlo muto.
    return 'Sola lettura.'
}

function capitalize(s: string): string {
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function fasciaLabel(cov: CoverageCell): string {
    const dt = new Date(cov.slotStart)
    const weekday = capitalize(weekdayFmt.format(dt))
    const day = dayOnlyFmt.format(dt)
    const time = slotLabel(dt)
    const attesi = cov.expectedPeople.toLocaleString('it-IT', { maximumFractionDigits: 1 })
    const chi = cov.available.length === 0
        ? 'nessuno disponibile'
        : `${cov.available.length} disponibil${cov.available.length === 1 ? 'e' : 'i'}`
    return `${weekday} ${day} alle ${time} — ${chi}, ≈${attesi} attesi`
}

function StatusStrip({ data, now, onOpenTemplate }: { data: CalendarWeekView; now: Date; onOpenTemplate: () => void }) {
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

export function MioCalendarioClient({ initial, role }: Props) {
    const [data, setData] = useState<CalendarWeekView>(initial)
    const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.mySlots))
    const [view, setView] = useState<'mio' | 'copertura' | 'modello'>('mio')
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [now, setNow] = useState<Date>(() => new Date())

    // Countdown ricalcolato ogni minuto, mai a ogni render.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000)
        return () => clearInterval(id)
    }, [])

    // La selezione locale segue la settimana caricata: al cambio settimana si
    // riparte sempre dallo stato salvato lato server.
    useEffect(() => {
        setSelected(new Set(data.mySlots))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.weekStartIso])

    // `salesUserId` va ripassato SEMPRE, anche quando si cambia solo settimana:
    // senza, `getCalendarWeek` ricade sul chiamante e chi stava guardando il
    // calendario di un collega (`?venditore=<id>`) alla prima freccia si
    // ritrova davanti il proprio, senza che nulla lo segnali. Sul proprio
    // calendario è un no-op: `targetUserId` coincide già con chi guarda.
    const targetUserId = data.targetUserId
    const loadWeek = useCallback((weekStartIso: string) => {
        setError(null)
        startTransition(async () => {
            try {
                const fresh = await getCalendarWeek({ weekStartIso, salesUserId: targetUserId })
                setData(fresh)
            } catch (e: any) {
                setError(e?.message || 'Errore caricamento calendario.')
            }
        })
    }, [targetUserId])

    const maxForwardWeekMs = useMemo(
        () => addWeeks(weekStartFor(new Date()), MAX_WEEKS_FORWARD).getTime(),
        [],
    )

    // `addWeeks`, mai `+ delta * 7 * 86_400_000`: l'aritmetica in millisecondi
    // sbaglia settimana nelle due del cambio d'ora (vedi calendarSlots.ts).
    const goWeek = (delta: number) => {
        const target = addWeeks(new Date(data.weekStartIso), delta)
        loadWeek(target.toISOString())
    }

    const atMaxForward = new Date(data.weekStartIso).getTime() >= maxForwardWeekMs

    const slots = useMemo(() => weekSlots(new Date(data.weekStartIso)), [data.weekStartIso])
    const instantByKey = useMemo(() => new Map(slots.map(s => [slotKey(s), s])), [slots])
    const coverageByKey = useMemo(() => new Map(data.coverage.map(c => [c.slotKey, c])), [data.coverage])
    const venditoriById = useMemo(() => new Map(data.venditori.map(v => [v.id, v.name])), [data.venditori])
    const blocksByKey = useMemo(() => new Map(data.myBlocks.map(b => [b.slotKey, b])), [data.myBlocks])
    const apptByKey = useMemo(() => new Map(data.myAppointments.map(a => [a.slotKey, a])), [data.myAppointments])
    const mySlotsSet = useMemo(() => new Set(data.mySlots), [data.mySlots])

    const myCells = useMemo(() => {
        const m = new Map<string, SlotCellView>()
        const disabledMenuItem = (reason: string): SlotMenuItemView => ({ disabled: true, reason })

        for (const slot of slots) {
            const key = slotKey(slot)
            const appt = apptByKey.get(key)
            const block = blocksByKey.get(key)
            const cov = coverageByKey.get(key)

            let state: SlotCellView['state']
            let subtitle: string | undefined
            let cellDisabled: boolean | undefined
            let title: string | undefined
            // Le tre voci del menu "⋯": assente = niente menu su questa cella
            // (è il caso di un appuntamento, dove nessuna delle tre scelte ha
            // senso). Le ragioni si scrivono qui, mai in un `title`: un
            // bottone disabilitato non lo mostra in Chrome (spec §4.4).
            let menu: SlotCellView['menu']

            const pastHourReason = 'Le ore già iniziate non si modificano: restano come le avevi dichiarate.'

            // Un'ora già iniziata non si ri-dichiara: è la prova di quello che
            // era stato offerto, e le Conferme hanno 48 ore per segnalare
            // un'assenza. Il divieto vero è in `saveCalendarWeek` (che ignora
            // gli slot passati); qui si evita solo che lo si scopra con un
            // salvataggio che sembra andato a buon fine e non cambia nulla.
            if (slot <= now) {
                cellDisabled = true
                title = pastHourReason
            }

            if (appt) {
                state = 'occupato'
                subtitle = appt.leadName
                // Nessun menu: uno slot occupato da un appuntamento non ha
                // nessuna delle tre scelte disponibile.
            } else if (block) {
                state = 'bloccato'
                subtitle = block.kind === 'FOLLOWUP' ? `Follow-up: ${block.leadName ?? ''}` : 'Bloccato'
                // `unblockSlot` rifiuta i blocchi FOLLOWUP di un lead ancora
                // assegnato: la riga resta visibile ma spenta, con la
                // spiegazione, non nascosta (stessa decisione della finestra
                // di preavviso qui sotto). Un blocco ORFANO (lead non più
                // suo) si può invece togliere: senza, lo slot resterebbe
                // occupato per sempre senza che nessuno possa farci niente.
                if (block.kind === 'FOLLOWUP' && !block.orphan) {
                    const reason = "Questo slot è occupato da un follow-up: spostalo o registrane l'esito."
                    menu = {
                        disponibile: disabledMenuItem(reason),
                        bloccato: disabledMenuItem('È già bloccato per il follow-up.'),
                        nondisponibile: disabledMenuItem(reason),
                    }
                } else {
                    if (block.kind === 'FOLLOWUP') subtitle = 'Follow-up non più tuo'
                    const bloccatoReason = block.kind === 'FOLLOWUP'
                        ? 'Era bloccato per un follow-up non più tuo.'
                        : 'È già bloccato per imprevisto.'
                    // Sbloccabile sempre (orfano, o blocco manuale): la scelta
                    // finale (disponibile/non disponibile) decide solo la
                    // selezione locale dopo lo sblocco, non tocca il server
                    // due volte.
                    menu = {
                        disponibile: {},
                        bloccato: disabledMenuItem(bloccatoReason),
                        nondisponibile: {},
                    }
                }
            } else if (selected.has(key)) {
                state = 'disponibile'
                // Anticipazione lato client della stessa regola server-side
                // (manualBlockCheck/MANUAL_BLOCK_NOTICE_MINUTES): il controllo
                // vero resta nel server action, questo evita solo il click a
                // vuoto seguito da un rifiuto che sembra un guasto.
                const minutiDiPreavviso = (slot.getTime() - now.getTime()) / 60_000
                const bloccatoItem: SlotMenuItemView = minutiDiPreavviso <= MANUAL_BLOCK_NOTICE_MINUTES
                    ? disabledMenuItem("Troppo tardi: uno slot si blocca almeno un'ora prima.")
                    : {}
                menu = {
                    disponibile: disabledMenuItem('È già disponibile.'),
                    bloccato: bloccatoItem,
                    nondisponibile: cellDisabled ? disabledMenuItem(pastHourReason) : {},
                }
            } else {
                // Rosso = "ha scelto di non esserci". È vero solo se una
                // dichiarazione esiste davvero a DB (`data.declared`). Se
                // `mySlots` è una PROPOSTA — default verde mai salvato,
                // settimana tipo non ancora materializzata, settimana passata
                // che nessuno ha mai compilato — la cella resta bianca
                // (`libero`): nessuna scelta è stata fatta, e affermare il
                // contrario è la stessa bugia del verde sui calendari altrui.
                state = data.declared ? 'nondisponibile' : 'libero'
                menu = {
                    disponibile: cellDisabled ? disabledMenuItem(pastHourReason) : {},
                    bloccato: disabledMenuItem('Devi prima segnarlo come disponibile.'),
                    nondisponibile: disabledMenuItem(
                        data.declared ? 'È già non disponibile.' : 'Non è fra le ore selezionate.',
                    ),
                }
            }

            // La copertura arriva dal DB (ultimo salvataggio), non dalla
            // selezione locale non ancora salvata: per non contarmi due volte
            // sottraggo me stesso solo se ero davvero disponibile server-side.
            const amIAvailableServerSide = mySlotsSet.has(key) && !blocksByKey.has(key)
            const othersAvailable = cov ? cov.available.length - (amIAvailableServerSide ? 1 : 0) : 0

            m.set(key, {
                state,
                subtitle,
                badge: othersAvailable > 0 ? String(othersAvailable) : undefined,
                tone: cov?.status ?? 'neutro',
                menu,
                cellDisabled,
                title,
            })
        }
        return m
    }, [slots, apptByKey, blocksByKey, coverageByKey, selected, mySlotsSet, now, data.declared])

    const coverageCells = useMemo(() => {
        const m = new Map<string, SlotCellView>()
        for (const slot of slots) {
            const key = slotKey(slot)
            const cov = coverageByKey.get(key)
            const availableCount = cov?.available.length ?? 0
            const expected = (cov?.expectedPeople ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 1 })
            const names = cov?.available.map(id => venditoriById.get(id) ?? id) ?? []
            // I nomi vanno nel corpo della cella (spec §5.1): il `title` resta
            // solo come comodità per chi ha il mouse, non l'unico posto dove
            // esistono — su telefono l'hover non esiste.
            const detail = names.length === 0
                ? undefined
                : names.length > 3
                    ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
                    : names.join(', ')
            m.set(key, {
                // Il segnale primario qui è il semaforo (`tone`), non lo stato
                // personale: teniamo il fondo cella neutro per non doppiare il
                // messaggio.
                state: 'libero',
                subtitle: `${availableCount} disp · ≈${expected}`,
                detail,
                tone: cov?.status ?? 'neutro',
                title: names.length > 0 ? names.join(', ') : undefined,
            })
        }
        return m
    }, [slots, coverageByKey, venditoriById])

    const dirty = useMemo(() => {
        if (selected.size !== data.mySlots.length) return true
        for (const k of data.mySlots) if (!selected.has(k)) return true
        return false
    }, [selected, data.mySlots])

    // Il bottone Salva si spegne SOLO su una settimana già dichiarata e non
    // toccata. Su una settimana mai dichiarata resta acceso anche senza
    // modifiche: `mySlots` è una proposta (il default verde, o la settimana
    // tipo non ancora materializzata) e coincide con la selezione iniziale,
    // quindi `dirty` nasce falso — accettare la proposta così com'è era
    // impossibile, e chi chiudeva la pagina credendosi a posto prendeva la
    // multa delle 14:00 e restava imprenotabile per tutta la settimana.
    const canSave = data.editable && (dirty || !data.declared)

    const uncovered = useMemo(
        () => data.coverage.filter(c => c.status === 'rosso' || c.status === 'ambra'),
        [data.coverage],
    )

    const handleCellClick = (key: string) => {
        if (!data.editable) return
        const cell = myCells.get(key)
        if (!cell) return
        if (cell.cellDisabled) return
        if (cell.state === 'occupato' || cell.state === 'bloccato') return
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    // Le tre voci del menu portano a uno STATO FINALE (Disponibile / Imprevisto
    // / Non disponibile), non a un'azione unica come prima. Da una cella
    // bloccata, qualunque scelta diversa dal blocco stesso passa prima da uno
    // sblocco lato server; da una cella non bloccata, "Imprevisto" chiama
    // `blockSlot` e le altre due sono solo una modifica della selezione
    // locale (il salvataggio resta il bottone "Salva").
    const handleCellMenu = (key: string, option: SlotMenuOption) => {
        if (!data.editable) return
        const cell = myCells.get(key)
        const instant = instantByKey.get(key)
        if (!cell || !instant) return
        const menuItem = cell.menu?.[option]
        if (!menuItem || menuItem.disabled) return
        const slotIso = instant.toISOString()

        if (cell.state === 'bloccato') {
            setError(null)
            startTransition(async () => {
                const res = await unblockSlot(slotIso)
                if (!res.success) {
                    setError(res.error ?? 'Sblocco non riuscito.')
                    return
                }
                if (option === 'nondisponibile') {
                    setSelected(prev => {
                        const next = new Set(prev)
                        next.delete(key)
                        return next
                    })
                } else {
                    // Lo sblocco da solo NON basta: un blocco FOLLOWUP orfano
                    // può insistere su un'ora che non era dichiarata (il lead
                    // non è più suo, il blocco è rimasto). Lì la selezione
                    // locale non contiene la chiave, e senza questa riga il
                    // menu diceva "Disponibile" e la cella restava rossa.
                    // Sui blocchi manuali — ammessi solo su ore già dichiarate
                    // — è un no-op.
                    setSelected(prev => new Set(prev).add(key))
                }
                loadWeek(data.weekStartIso)
            })
            return
        }

        if (option === 'bloccato') {
            setError(null)
            startTransition(async () => {
                const res = await blockSlot(slotIso)
                if (!res.success) setError(res.error ?? 'Blocco non riuscito.')
                else loadWeek(data.weekStartIso)
            })
            return
        }

        if (option === 'disponibile') {
            setSelected(prev => new Set(prev).add(key))
        } else {
            setSelected(prev => {
                const next = new Set(prev)
                next.delete(key)
                return next
            })
        }
    }

    const handleSave = () => {
        setError(null)
        startTransition(async () => {
            const res = await saveCalendarWeek(data.weekStartIso, [...selected])
            if (!res.success) {
                setError(res.error ?? 'Salvataggio non riuscito: riprova fra un momento.')
                return
            }
            try {
                // Stesso `salesUserId` di `loadWeek`: qui è sempre il proprio
                // calendario (si salva solo il proprio), ma la regola vale una
                // sola, così non c'è una seconda lettura da ricordarsi.
                const fresh = await getCalendarWeek({ weekStartIso: data.weekStartIso, salesUserId: targetUserId })
                setData(fresh)
            } catch (e: any) {
                setError(e?.message || 'Salvato, ma il ricaricamento è fallito: aggiorna la pagina.')
            }
        })
    }

    const roNote = readOnlyNote(data.editable, data.readOnlyReason)

    return (
        <div className="mx-auto max-w-5xl space-y-4">
            <header>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-ash-900">
                    <CalendarClock className="h-6 w-6 text-brand-orange" /> Il mio Calendario
                </h1>
                <p className="text-sm text-ash-500">
                    Dichiara le ore in cui sei disponibile per gli appuntamenti dei prossimi giorni.
                </p>
            </header>

            {role === 'VENDITORE' && (
                <StatusStrip data={data} now={now} onOpenTemplate={() => setView('modello')} />
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                {view === 'modello' ? (
                    // La settimana tipo non ha una settimana: il navigatore
                    // qui non avrebbe senso da mostrare.
                    <div className="text-sm text-ash-500">Vale ogni settimana, non solo quella corrente.</div>
                ) : (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => goWeek(-1)}
                            disabled={isPending}
                            aria-label="Settimana precedente"
                            className="rounded-lg border border-ash-200 bg-white p-1.5 text-ash-700 hover:bg-ash-100 disabled:opacity-50"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="min-w-[10rem] text-center text-sm font-semibold text-ash-800">
                            {formatWeekRange(data.weekStartIso)}
                        </div>
                        <button
                            type="button"
                            onClick={() => goWeek(1)}
                            disabled={isPending || atMaxForward}
                            aria-label="Settimana successiva"
                            className="rounded-lg border border-ash-200 bg-white p-1.5 text-ash-700 hover:bg-ash-100 disabled:opacity-50"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                        {isPending && <Loader2 className="h-4 w-4 animate-spin text-ash-400" />}
                    </div>
                )}

                <div className="inline-flex rounded-lg border border-ash-200 bg-white p-1 text-sm font-semibold">
                    <button
                        type="button"
                        onClick={() => setView('mio')}
                        className={`rounded-md px-3 py-1.5 transition-colors ${view === 'mio' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                    >
                        Il mio calendario
                    </button>
                    <button
                        type="button"
                        onClick={() => setView('copertura')}
                        className={`rounded-md px-3 py-1.5 transition-colors ${view === 'copertura' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                    >
                        Copertura squadra
                    </button>
                    {role === 'VENDITORE' && (
                        <button
                            type="button"
                            onClick={() => setView('modello')}
                            className={`rounded-md px-3 py-1.5 transition-colors ${view === 'modello' ? 'bg-brand-orange text-white' : 'text-ash-600 hover:bg-ash-100'}`}
                        >
                            Settimana tipo
                        </button>
                    )}
                </div>
            </div>

            {view !== 'modello' && roNote && (
                <div className="text-xs italic text-ash-500">{roNote}</div>
            )}

            {error && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                </div>
            )}

            {view === 'mio' && (
                <div className="space-y-3">
                    <SlotGrid
                        weekStartIso={data.weekStartIso}
                        cells={myCells}
                        onCellClick={handleCellClick}
                        onCellMenu={handleCellMenu}
                        readOnly={!data.editable}
                    />
                    <CoverageLegend variant="personale" />
                    {role === 'VENDITORE' && (
                        <div className="flex items-center justify-end">
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={!canSave || isPending}
                                className="flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-default disabled:opacity-50"
                            >
                                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                                {`Salva (${selected.size} ore)`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {view === 'copertura' && (
                <div className="space-y-3">
                    <SlotGrid
                        weekStartIso={data.weekStartIso}
                        cells={coverageCells}
                        readOnly
                    />
                    <CoverageLegend variant="copertura" />
                    <div className="rounded-xl border border-ash-200 bg-white p-4">
                        <h2 className="mb-2 text-sm font-bold text-ash-800">Fasce scoperte questa settimana</h2>
                        {uncovered.length === 0 ? (
                            <div className="text-sm text-ash-500">Nessuna fascia scoperta.</div>
                        ) : (
                            <ul className="space-y-1 text-sm text-ash-700">
                                {uncovered.map(c => (
                                    <li key={c.slotKey}>{fasciaLabel(c)}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {view === 'modello' && role === 'VENDITORE' && (
                <TemplateEditor
                    initial={data.template}
                    onSaved={() => loadWeek(data.weekStartIso)}
                />
            )}
        </div>
    )
}
