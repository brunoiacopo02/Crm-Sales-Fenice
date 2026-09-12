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
import { weekSlots, weekStartFor, addWeeks, slotKey, slotLabel, romeHour, SLOT_HOURS } from "@/lib/venditore/calendarSlots"
import { toggleGroup, applyPaint } from "@/lib/venditore/calendarSelection"
import { MANUAL_BLOCK_NOTICE_MINUTES } from "@/lib/venditore/calendarRules"
import type { CoverageCell } from "@/lib/venditore/calendarCoverage"
import { SlotGrid, type SlotCellView, type SlotMenuOption, type SlotMenuItemView } from "@/components/calendar/SlotGrid"
import { CoverageLegend } from "@/components/calendar/CoverageLegend"
import { TemplateEditor } from "@/components/calendar/TemplateEditor"
import { weekdayFmt, dayOnlyFmt, formatWeekRange, capitalize } from "@/components/calendar/calendarFormat"
import { StatusStrip } from "./StatusStrip"

interface Props {
    initial: CalendarWeekView
    role: string
}

const MAX_WEEKS_FORWARD = 3

function readOnlyNote(editable: boolean, reason: CalendarWeekView['readOnlyReason']): string | null {
    if (editable) return null
    if (reason === 'settimana_passata') return 'Settimana passata: sola lettura.'
    if (reason === 'altro_venditore') return 'Stai guardando il calendario di un altro venditore: sola lettura.'
    // Caso limite: un non-VENDITORE (admin/manager/conferme) guarda il proprio
    // account. Niente motivo specifico dal contratto dati: non lasciarlo muto.
    return 'Sola lettura.'
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

export function MioCalendarioClient({ initial, role }: Props) {
    const [data, setData] = useState<CalendarWeekView>(initial)
    const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.mySlots))
    const [view, setView] = useState<'mio' | 'copertura' | 'modello'>('mio')
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [now, setNow] = useState<Date>(() => new Date())
    // Freccia settimana premuta con modifiche in sospeso: il riquadro inline
    // sotto il navigatore tiene qui il `delta` finché non si decide. Niente
    // `window.confirm` (vietato nel progetto, e su mobile è una finestra di
    // sistema che non si può nemmeno leggere per intero).
    const [pendingWeekDelta, setPendingWeekDelta] = useState<number | null>(null)

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
    const goWeekNow = (delta: number) => {
        const target = addWeeks(new Date(data.weekStartIso), delta)
        loadWeek(target.toISOString())
    }

    // Con modifiche non salvate la freccia non naviga: apre il riquadro sotto
    // il navigatore e lascia decidere. `loadWeek` ricarica `mySlots` dal
    // server e l'effetto su `weekStartIso` ributta via `selected`: senza questa
    // guardia un'intera settimana spuntata spariva con un click di troppo.
    const goWeek = (delta: number) => {
        if (dirty && data.editable) {
            setPendingWeekDelta(delta)
            return
        }
        goWeekNow(delta)
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
                // Il glifo raddoppia il colore: spunta = disponibile, trattino
                // = non disponibile. Su `libero` nessun glifo, perché non c'è
                // nessuna scelta da confermare (vedi il commento sul verde
                // "proposta" qui sopra).
                icon: state === 'disponibile' ? 'check' : state === 'nondisponibile' ? 'minus' : undefined,
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

    // Chiudere la scheda con una settimana spuntata a metà significa restare
    // imprenotabili senza saperlo: il browser chiede conferma. Il testo lo
    // decide Chrome/Firefox (quello nostro è ignorato da anni), a noi basta
    // `preventDefault`. Nessun listener quando non c'è niente da perdere:
    // altrimenti si intralcia anche chi sta solo guardando.
    useEffect(() => {
        if (!dirty || !data.editable) return
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', h)
        return () => window.removeEventListener('beforeunload', h)
    }, [dirty, data.editable])

    // Il riquadro "modifiche non salvate" si chiude da solo appena smette di
    // essere vero (salvataggio riuscito altrove, scarto, ecc.): senza questo
    // effetto restava a schermo anche a `dirty` tornato falso.
    useEffect(() => {
        if (!dirty) setPendingWeekDelta(null)
    }, [dirty])

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

    // Le celle che i gesti di massa (pennellata, riga, colonna) non possono
    // toccare: appuntamenti, blocchi e ore già iniziate. È la stessa regola di
    // `handleCellClick`, scritta una volta sola perché ora la usano in tre.
    const lockedKey = (key: string) => {
        const c = myCells.get(key)
        return !c || !!c.cellDisabled || c.state === 'occupato' || c.state === 'bloccato'
    }

    // Il verso lo ha già deciso `SlotGrid` guardando la cella d'origine: qui si
    // applica e basta, cella per cella, saltando quelle bloccate.
    const handleCellPaint = (key: string, on: boolean) => {
        if (!data.editable) return
        if (lockedKey(key)) return
        setSelected(prev => applyPaint(prev, key, on))
    }

    // Scorciatoia di riga: tutte le occorrenze di quell'ora nella settimana.
    const handleHourToggle = (hour: number) => {
        if (!data.editable) return
        const keys = slots.filter(s => romeHour(s) === hour).map(slotKey)
        setSelected(prev => toggleGroup(prev, keys, lockedKey))
    }

    // Scorciatoia di colonna: le 13 ore di un giorno. `weekSlots` è
    // giorno-maggiore (lunedì 9 → sabato 21), lo stesso ordine con cui
    // `SlotGrid` costruisce le colonne: la fetta è quindi esattamente il
    // giorno `dayIndex` (0 = lunedì … 5 = sabato).
    const handleDayToggle = (dayIndex: number) => {
        if (!data.editable) return
        const keys = slots.slice(dayIndex * SLOT_HOURS.length, (dayIndex + 1) * SLOT_HOURS.length).map(slotKey)
        setSelected(prev => toggleGroup(prev, keys, lockedKey))
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

    /**
     * Il salvataggio vero, staccato dal bottone: torna `true` solo se il server
     * ha accettato. Serve a "Salva e cambia" — cambiare settimana dopo un
     * salvataggio FALLITO butterebbe via proprio le modifiche che l'utente
     * stava cercando di mettere al sicuro.
     */
    const saveWeek = async (): Promise<boolean> => {
        setError(null)
        const res = await saveCalendarWeek(data.weekStartIso, [...selected])
        if (!res.success) {
            setError(res.error ?? 'Salvataggio non riuscito: riprova fra un momento.')
            return false
        }
        try {
            // Stesso `salesUserId` di `loadWeek`: qui è sempre il proprio
            // calendario (si salva solo il proprio), ma la regola vale una
            // sola, così non c'è una seconda lettura da ricordarsi.
            const fresh = await getCalendarWeek({ weekStartIso: data.weekStartIso, salesUserId: targetUserId })
            setData(fresh)
        } catch (e: any) {
            // Il salvataggio è comunque andato: la settimana a DB è aggiornata,
            // qui è fallita solo la rilettura. Non si torna `false`, o
            // "Salva e cambia" resterebbe bloccato su un lavoro già fatto.
            setError(e?.message || 'Salvato, ma il ricaricamento è fallito: aggiorna la pagina.')
        }
        return true
    }

    const handleSave = () => {
        startTransition(async () => { await saveWeek() })
    }

    const saveThen = (after: () => void) => {
        startTransition(async () => {
            if (await saveWeek()) after()
        })
    }

    const discardChanges = () => setSelected(new Set(data.mySlots))

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
                    {pendingWeekDelta !== null && (
                        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            <div>Hai modifiche non salvate su questa settimana.</div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => { const d = pendingWeekDelta; setPendingWeekDelta(null); saveThen(() => goWeekNow(d)) }}
                                    className="cursor-pointer rounded-lg bg-brand-orange px-3 py-1.5 text-xs font-semibold text-white hover:brightness-95"
                                >
                                    Salva e cambia
                                </button>
                                <button
                                    type="button"
                                    // `discardChanges` prima di `goWeekNow` è
                                    // ridondante (l'effetto su `weekStartIso` rifà
                                    // `selected` dal server appena i dati arrivano) ma
                                    // innocuo, e tiene la griglia coerente nel frattempo.
                                    onClick={() => { const d = pendingWeekDelta; setPendingWeekDelta(null); discardChanges(); goWeekNow(d) }}
                                    className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                                >
                                    Scarta e cambia
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPendingWeekDelta(null)}
                                    className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                                >
                                    Resta qui
                                </button>
                            </div>
                        </div>
                    )}
                    {role === 'VENDITORE' && data.editable && (
                        <div className="text-xs text-ash-500">
                            Clicca un&apos;ora per tutta la riga, un giorno per tutta la colonna, oppure trascina col mouse.
                        </div>
                    )}
                    <SlotGrid
                        weekStartIso={data.weekStartIso}
                        cells={myCells}
                        onCellClick={handleCellClick}
                        onCellMenu={handleCellMenu}
                        // I gesti di massa esistono solo dove c'è qualcosa da
                        // cambiare: senza queste prop `SlotGrid` rende le
                        // intestazioni come semplice testo, non come bottoni
                        // che promettono un'azione impossibile (calendario
                        // altrui, settimana passata, ruolo non venditore).
                        onCellPaint={role === 'VENDITORE' && data.editable ? handleCellPaint : undefined}
                        onHourToggle={role === 'VENDITORE' && data.editable ? handleHourToggle : undefined}
                        onDayToggle={role === 'VENDITORE' && data.editable ? handleDayToggle : undefined}
                        readOnly={!data.editable}
                    />
                    <CoverageLegend variant="personale" />
                    {/*
                      * La barra resta appiccicata al fondo dello schermo
                      * mentre si scorre la griglia: il bottone in coda alla
                      * pagina si vedeva solo arrivati in fondo, e su una
                      * settimana lunga si usciva credendo di aver salvato.
                      * Compare solo quando c'è davvero qualcosa da fare
                      * (`canSave`), così non copre nulla il resto del tempo.
                      */}
                    {role === 'VENDITORE' && canSave && (
                        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-2 shadow-lg backdrop-blur">
                            {selected.size === 0 ? (
                                // Salvare zero ore è ammesso, ma deve essere
                                // una scelta: una settimana senza ore non è
                                // prenotabile da nessuno, e finora la barra
                                // diceva solo "0 ore" come fosse un numero
                                // qualsiasi.
                                <div className="text-sm text-rose-800">
                                    <span className="font-semibold">Nessuna ora disponibile</span> — le Conferme non potranno fissarti nessun appuntamento questa settimana
                                </div>
                            ) : (
                                <div className="text-sm text-amber-900">
                                    {dirty
                                        ? <><span className="font-semibold">Modifiche non salvate</span> — {selected.size} ore disponibili</>
                                        : <><span className="font-semibold">Conferma la settimana</span> — {selected.size} ore disponibili</>}
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                {dirty && (
                                    <button
                                        type="button"
                                        onClick={discardChanges}
                                        disabled={isPending}
                                        className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-default disabled:opacity-50"
                                    >
                                        Scarta
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleSave}
                                    disabled={isPending}
                                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-default disabled:opacity-50"
                                >
                                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Salva
                                </button>
                            </div>
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
