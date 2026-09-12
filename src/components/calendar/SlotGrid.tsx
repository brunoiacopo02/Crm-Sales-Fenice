"use client"

/**
 * Griglia settimanale presentazionale: 7 colonne (ora + 6 giorni) x 13 righe
 * (09:00-21:00, lunedì-sabato). Non conosce server action né regole di
 * dominio: riceve celle già decise (`SlotCellView`) e inoltra solo i click.
 *
 * Riusata da Task 10 per le altre due schermate (Conferme, direzione): per
 * questo non deve mai importare `salesCalendarActions` o sapere cos'è una multa.
 */

import { toRomeDateStr } from "@/lib/dateUtils"
import { SLOT_HOURS, SLOT_DAYS, weekSlots, slotKey, slotLabel } from "@/lib/venditore/calendarSlots"
import type { CoverageStatus } from "@/lib/venditore/calendarCoverage"

export type SlotCellState = 'libero' | 'disponibile' | 'occupato' | 'bloccato'

export interface SlotCellView {
    state: SlotCellState
    /** Numero/testo breve mostrato in alto a destra sulla cella. */
    badge?: string
    /** Testo breve sotto il contenuto principale della cella. */
    subtitle?: string
    /** Seconda riga, più piccola, sotto `subtitle` (es. i nomi dei colleghi). */
    detail?: string
    /** Colore del semaforo copertura per questo slot. */
    tone?: CoverageStatus
    /** Tooltip nativo (es. l'elenco completo dei colleghi disponibili). */
    title?: string
    /**
     * Il bottone "⋯" resta visibile ma spento, con `menuTitle` come
     * spiegazione: il venditore deve capire che la finestra è chiusa, non
     * credere a un guasto (spec §4.4).
     */
    menuDisabled?: boolean
    menuTitle?: string
}

export interface SlotGridProps {
    weekStartIso: string
    cells: Map<string, SlotCellView>
    onCellClick?: (slotKey: string) => void
    onCellMenu?: (slotKey: string) => void
    readOnly?: boolean
}

const DAY_ABBR_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

const STATE_STYLES: Record<SlotCellState, string> = {
    libero: 'bg-white border-ash-200 text-ash-400',
    disponibile: 'bg-emerald-50 border-emerald-300 text-emerald-800',
    occupato: 'bg-sky-50 border-sky-300 text-sky-900',
    bloccato: 'bg-ash-100 border-ash-300 text-ash-500 line-through',
}

const TONE_STYLES: Record<CoverageStatus, string> = {
    rosso: 'bg-rose-500',
    ambra: 'bg-amber-400',
    verde: 'bg-emerald-500',
    neutro: 'bg-transparent',
}

const STATE_LABEL_IT: Record<SlotCellState, string> = {
    libero: 'libero',
    disponibile: 'disponibile',
    occupato: 'occupato',
    bloccato: 'bloccato',
}

// Formattatori fissati su Europe/Rome: mai getHours()/getDay() locali, come
// nel resto del modulo calendario (vedi calendarSlots.ts).
const weekdayFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' })
const dayMonthFmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long' })

function capitalize(s: string): string {
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function ariaLabelFor(instant: Date, view: SlotCellView): string {
    const weekday = capitalize(weekdayFmt.format(instant))
    const dayMonth = dayMonthFmt.format(instant)
    const hm = slotLabel(instant)
    return `${weekday} ${dayMonth} alle ${hm} — ${STATE_LABEL_IT[view.state]}`
}

export function SlotGrid({ weekStartIso, cells, onCellClick, onCellMenu, readOnly }: SlotGridProps) {
    const weekStart = new Date(weekStartIso)
    const slots = weekSlots(weekStart)
    const hoursPerDay = SLOT_HOURS.length
    const days: Date[][] = []
    for (let d = 0; d < SLOT_DAYS; d++) {
        days.push(slots.slice(d * hoursPerDay, (d + 1) * hoursPerDay))
    }

    const headerLabel = (dayIndex: number): string => {
        const first = days[dayIndex][0]
        const [, month, dayNum] = toRomeDateStr(first).split('-')
        return `${DAY_ABBR_IT[dayIndex]} ${dayNum}/${month}`
    }

    return (
        <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
            <div
                className="grid min-w-[720px]"
                style={{ gridTemplateColumns: '64px repeat(6, minmax(96px, 1fr))' }}
            >
                <div className="border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-ash-400">
                    Ora
                </div>
                {days.map((_, d) => (
                    <div
                        key={d}
                        className="border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-center text-[11px] font-bold text-ash-700 last:border-r-0"
                    >
                        {headerLabel(d)}
                    </div>
                ))}

                {SLOT_HOURS.map((hour, row) => (
                    <div key={hour} className="contents">
                        <div className="flex items-center border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-xs font-semibold text-ash-500">
                            {String(hour).padStart(2, '0')}:00
                        </div>
                        {days.map((daySlots, d) => {
                            const instant = daySlots[row]
                            const key = slotKey(instant)
                            const view = cells.get(key) ?? { state: 'libero' as const }
                            const disabled = !!readOnly
                            const showMenu = !disabled && !!onCellMenu
                                && (view.state === 'disponibile' || view.state === 'bloccato')

                            return (
                                <div key={key} className="relative border-b border-r border-ash-200 last:border-r-0">
                                    <button
                                        type="button"
                                        disabled={disabled}
                                        title={view.title}
                                        aria-label={ariaLabelFor(instant, view)}
                                        onClick={() => onCellClick?.(key)}
                                        onContextMenu={(e) => {
                                            if (!onCellMenu || disabled) return
                                            e.preventDefault()
                                            onCellMenu(key)
                                        }}
                                        className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 border-2 border-transparent px-1 py-1 text-[10px] transition-colors ${STATE_STYLES[view.state]} ${disabled ? 'cursor-default' : 'cursor-pointer hover:brightness-95'}`}
                                    >
                                        {view.tone && (
                                            <div className={`absolute inset-x-0 top-0 h-[3px] ${TONE_STYLES[view.tone]}`} />
                                        )}
                                        {view.subtitle && (
                                            <span className="line-clamp-2 text-center leading-tight">
                                                {view.subtitle}
                                            </span>
                                        )}
                                        {view.detail && (
                                            <span className="line-clamp-2 text-center text-[10px] leading-tight opacity-80">
                                                {view.detail}
                                            </span>
                                        )}
                                    </button>
                                    {view.badge && (
                                        <div className="pointer-events-none absolute right-1 top-1 rounded bg-ash-800/80 px-1 text-[10px] font-bold text-white">
                                            {view.badge}
                                        </div>
                                    )}
                                    {showMenu && (
                                        <button
                                            type="button"
                                            disabled={!!view.menuDisabled}
                                            title={view.menuTitle}
                                            aria-label="Altre azioni sullo slot"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                if (view.menuDisabled) return
                                                onCellMenu?.(key)
                                            }}
                                            className={`absolute bottom-0.5 right-0.5 rounded px-1 text-[10px] font-bold ${view.menuDisabled ? 'cursor-default bg-white/50 text-ash-300' : 'cursor-pointer bg-white/80 text-ash-500 hover:bg-white hover:text-ash-800'}`}
                                        >
                                            ⋯
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ))}
            </div>
        </div>
    )
}
