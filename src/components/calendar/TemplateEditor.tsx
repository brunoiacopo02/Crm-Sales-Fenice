"use client"

/**
 * Editor della "settimana tipo": l'orario abituale del venditore, valido ogni
 * settimana finché non lo cambia (decisione PO 2026-09-12, opzione B — vedi
 * `calendarTemplate.ts`).
 *
 * Griglia identica per forma a `SlotGrid` (6 giorni × 13 ore) ma senza date:
 * qui c'è solo giorno-della-settimana e ora, mai un istante reale. Per questo
 * non riusa `SlotGrid`, che calcola le date vere a partire da `weekStartIso`
 * e non avrebbe senso su un modello "senza settimana".
 *
 * Il salvataggio resta obbligatorio quanto sulla griglia vera: cambiare una
 * spunta qui non scrive nulla finché non si preme "Salva".
 */

import { useEffect, useState, useTransition } from "react"
import { Check, Loader2, Minus, Save, Trash2 } from "lucide-react"
import { saveMyTemplate, clearMyTemplate } from "@/app/actions/salesCalendarActions"
import { SLOT_HOURS } from "@/lib/venditore/calendarSlots"
import { templateKey, type TemplateSlot } from "@/lib/venditore/calendarTemplate"
import { toggleGroup, applyPaint } from "@/lib/venditore/calendarSelection"
import { useDragPaint } from "./useDragPaint"

interface Props {
    /** La settimana tipo così come la conosce il server (da `CalendarWeekView.template`). */
    initial: TemplateSlot[]
    /** Chiamato dopo un salvataggio o una cancellazione riusciti: il genitore ricarica la settimana corrente. */
    onSaved?: () => void
}

const DOWS = [1, 2, 3, 4, 5, 6]
const DOW_LABEL_IT: Record<number, string> = {
    1: 'Lunedì', 2: 'Martedì', 3: 'Mercoledì', 4: 'Giovedì', 5: 'Venerdì', 6: 'Sabato',
}
const DOW_ABBR_IT: Record<number, string> = {
    1: 'Lun', 2: 'Mar', 3: 'Mer', 4: 'Gio', 5: 'Ven', 6: 'Sab',
}

function keysFromTemplate(slots: TemplateSlot[]): Set<string> {
    return new Set(slots.map(s => templateKey(s.dow, s.hour)))
}

export function TemplateEditor({ initial, onSaved }: Props) {
    const [selected, setSelected] = useState<Set<string>>(() => keysFromTemplate(initial))
    const [isPending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    const [confirmingClear, setConfirmingClear] = useState(false)

    // Il modello caricato dal genitore è la fonte di verità: ci si
    // risincronizza quando cambia davvero (dopo un salvataggio, qui o
    // altrove), non ad ogni render — stesso pattern di `MioCalendarioClient`
    // per `data.mySlots`.
    useEffect(() => {
        setSelected(keysFromTemplate(initial))
    }, [initial])

    const dirty = (() => {
        const base = keysFromTemplate(initial)
        if (base.size !== selected.size) return true
        for (const k of base) if (!selected.has(k)) return true
        return false
    })()

    const toggleCell = (dow: number, hour: number) => {
        const key = templateKey(dow, hour)
        setSelected(prev => applyPaint(prev, key, !prev.has(key)))
    }

    // Click sull'etichetta dell'ora: seleziona/deseleziona l'intera riga
    // (tutti i giorni). Se e' gia' tutta selezionata, il click la svuota:
    // e' quello che rende immediato "tutti i giorni tranne sabato".
    const toggleRow = (hour: number) => {
        const keys = DOWS.map(dow => templateKey(dow, hour))
        setSelected(prev => toggleGroup(prev, keys, () => false))
    }

    // Click sull'intestazione del giorno: stessa logica, sulla colonna.
    const toggleColumn = (dow: number) => {
        const keys = SLOT_HOURS.map(hour => templateKey(dow, hour))
        setSelected(prev => toggleGroup(prev, keys, () => false))
    }

    // Pennellata "premi e trascina": stessa logica della griglia settimanale
    // vera. Qui non ci sono celle bloccate (nessun appuntamento/blocco su un
    // modello senza date), quindi `isPaintable` è sempre vero.
    const { containerProps, shouldIgnoreClick } = useDragPaint({
        enabled: !isPending,
        isPaintable: () => true,
        isOn: key => selected.has(key),
        onPaint: (key, on) => setSelected(prev => applyPaint(prev, key, on)),
    })

    const handleSave = () => {
        setError(null)
        setConfirmingClear(false)
        startTransition(async () => {
            const slots: TemplateSlot[] = [...selected].map(key => {
                const [dow, hour] = key.split('@').map(Number)
                return { dow, hour }
            })
            const res = await saveMyTemplate(slots)
            if (!res.success) {
                setError(res.error ?? 'Salvataggio non riuscito: riprova fra un momento.')
                return
            }
            onSaved?.()
        })
    }

    const handleClearConfirmed = () => {
        setError(null)
        startTransition(async () => {
            const res = await clearMyTemplate()
            setConfirmingClear(false)
            if (!res.success) {
                setError(res.error ?? 'Rimozione non riuscita: riprova fra un momento.')
                return
            }
            onSaved?.()
        })
    }

    return (
        <div className="space-y-3">
            <div className="rounded-xl border border-ash-200 bg-ash-50 px-4 py-3 text-sm text-ash-600">
                Vale ogni settimana. Le settimane che non hai ancora compilato si riempiono da sole.
            </div>

            <div className="text-xs text-ash-500">
                Clicca un&apos;ora per tutta la riga, un giorno per tutta la colonna, oppure trascina col mouse.
            </div>

            {error && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
                <div
                    className="grid min-w-[720px] select-none"
                    style={{ gridTemplateColumns: '64px repeat(6, minmax(96px, 1fr))' }}
                    {...containerProps}
                >
                    <div className="sticky left-0 z-10 border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-ash-400">
                        Ora
                    </div>
                    {DOWS.map(dow => (
                        <button
                            key={dow}
                            type="button"
                            onClick={() => toggleColumn(dow)}
                            disabled={isPending}
                            aria-label={`Seleziona o deseleziona tutte le ore di ${DOW_LABEL_IT[dow]}`}
                            title="Tutto il giorno"
                            className="cursor-pointer border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-center text-[11px] font-bold text-ash-700 transition-colors last:border-r-0 hover:bg-ash-100 disabled:cursor-default"
                        >
                            {DOW_ABBR_IT[dow]}
                        </button>
                    ))}

                    {SLOT_HOURS.map(hour => (
                        <div key={hour} className="contents">
                            <button
                                type="button"
                                onClick={() => toggleRow(hour)}
                                disabled={isPending}
                                aria-label={`Seleziona o deseleziona le ${hour}:00 su tutti i giorni`}
                                title="Tutta la riga"
                                className="sticky left-0 z-10 flex cursor-pointer items-center border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-xs font-semibold text-ash-500 transition-colors hover:bg-ash-100 disabled:cursor-default"
                            >
                                {String(hour).padStart(2, '0')}:00
                            </button>
                            {DOWS.map(dow => {
                                const key = templateKey(dow, hour)
                                const active = selected.has(key)
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        data-paint-key={key}
                                        onClick={() => {
                                            if (shouldIgnoreClick()) return
                                            toggleCell(dow, hour)
                                        }}
                                        disabled={isPending}
                                        aria-label={`${DOW_LABEL_IT[dow]} alle ${String(hour).padStart(2, '0')}:00 — ${active ? 'disponibile' : 'non disponibile'}`}
                                        className={`flex min-h-11 w-full cursor-pointer items-center justify-center gap-1 border-b border-r border-ash-200 px-1 text-[10px] font-semibold transition-colors last:border-r-0 hover:brightness-95 disabled:cursor-default ${active ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100/70 text-rose-800'}`}
                                    >
                                        {active
                                            ? <Check className="h-3.5 w-3.5" aria-hidden />
                                            : <Minus className="h-3.5 w-3.5 opacity-60" aria-hidden />}
                                    </button>
                                )
                            })}
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    {!confirmingClear ? (
                        <button
                            type="button"
                            onClick={() => setConfirmingClear(true)}
                            disabled={isPending}
                            className="flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-default disabled:opacity-50"
                        >
                            <Trash2 className="h-4 w-4" /> Cancella la settimana tipo
                        </button>
                    ) : (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                            {/*
                              * Cancellare il modello ferma le settimane FUTURE, non
                              * disfa quelle che il sistema ha già riempito: quelle ore
                              * sono ormai dichiarazioni sue a tutti gli effetti — le
                              * Conferme ci fissano sopra e valgono 50 € di multa per
                              * ogni assenza. È l'unico punto in cui quella conseguenza
                              * incrocia una persona che sta facendo il gesto opposto:
                              * va detta qui, non scoperta con una trattenuta.
                              */}
                            <span>
                                Cancellare la settimana tipo? Le settimane che ha già riempito restano
                                dichiarazioni tue: gli appuntamenti si fissano lì e se non ti presenti
                                la multa scatta lo stesso. Toglile a mano dalla griglia della settimana.
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleClearConfirmed}
                                    disabled={isPending}
                                    className="cursor-pointer rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-default disabled:opacity-50"
                                >
                                    Conferma cancellazione
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmingClear(false)}
                                    disabled={isPending}
                                    className="cursor-pointer rounded-md border border-ash-200 px-2 py-1 text-xs font-semibold text-ash-600 transition-colors hover:bg-ash-100 disabled:cursor-default disabled:opacity-50"
                                >
                                    Annulla
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!dirty || isPending}
                    className="flex items-center gap-2 rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-default disabled:opacity-50"
                >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {`Salva (${selected.size} ore)`}
                </button>
            </div>
        </div>
    )
}
