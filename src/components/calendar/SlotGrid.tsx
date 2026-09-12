"use client"

/**
 * Griglia settimanale presentazionale: 7 colonne (ora + 6 giorni) x 13 righe
 * (09:00-21:00, lunedì-sabato). Non conosce server action né regole di
 * dominio: riceve celle già decise (`SlotCellView`) e inoltra solo i click.
 *
 * Gestisce anche la pennellata "premi e trascina" (vedi `useDragPaint`) e le
 * scorciatoie riga/colonna sulle intestazioni, ma resta presentazionale: il
 * verso della pennellata e i toggle di riga/giorno li decide il genitore.
 *
 * Riusata da Task 10 per le altre due schermate (Conferme, direzione): per
 * questo non deve mai importare `salesCalendarActions` o sapere cos'è una multa.
 *
 * `libero` resta lo sfondo NEUTRO usato dalle viste di sola copertura (qui e
 * in `/calendari-venditori`): quelle celle non rappresentano mai una scelta
 * del venditore, solo un contenitore per il semaforo/i nomi. Il default verde
 * (Task 5) introduce uno stato separato, `nondisponibile`, per la scelta
 * esplicita "non disponibile" nella griglia personale: cambiare `libero`
 * stesso in rosso avrebbe tinto di rosso anche le celle neutre di copertura,
 * che non c'entrano — vedi il commento sopra `coverageCells` in
 * `MioCalendarioClient.tsx` e in `CalendariVenditoriClient.tsx`.
 */

import { useEffect, useRef, useState } from "react"
import { Check, Minus } from "lucide-react"
import { toRomeDateStr } from "@/lib/dateUtils"
import { SLOT_HOURS, SLOT_DAYS, weekSlots, slotKey, slotLabel } from "@/lib/venditore/calendarSlots"
import type { CoverageStatus } from "@/lib/venditore/calendarCoverage"
import { useDragPaint } from "./useDragPaint"

export type SlotCellState = 'libero' | 'disponibile' | 'nondisponibile' | 'occupato' | 'bloccato'

/** Le tre voci del menu "⋯": a quale stato porta ciascuna. */
export type SlotMenuOption = 'disponibile' | 'bloccato' | 'nondisponibile'

export interface SlotMenuItemView {
    /** Spento perché è già lo stato attuale, o perché la regola di dominio lo vieta. */
    disabled?: boolean
    /**
     * La spiegazione si legge QUI, non in un `title`: un bottone disabilitato
     * non mostra il `title` in Chrome (difetto noto, spec §4.4). La riga resta
     * comunque visibile.
     */
    reason?: string
}

export interface SlotCellView {
    state: SlotCellState
    /**
     * Glifo al centro della cella: lo stato non si affida al solo colore
     * (daltonismo, stampa in bianco e nero, schermi sbiaditi in ufficio).
     */
    icon?: 'check' | 'minus'
    /** Numero/testo breve mostrato in alto a sinistra sulla cella. */
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
     * Cella non cliccabile anche in una griglia modificabile (es. un'ora gia'
     * iniziata, che il server rifiuta comunque di riscrivere). Il `title` deve
     * spiegare perche': si scopre il divieto leggendo, non sbattendoci contro.
     */
    cellDisabled?: boolean
    /**
     * Presente solo se questa cella ha il bottone "⋯": una voce per ciascuno
     * dei tre stati possibili. Assente = nessun menu (es. una cella occupata
     * da un appuntamento, dove nessuna delle tre scelte ha senso).
     */
    menu?: Record<SlotMenuOption, SlotMenuItemView>
}

export interface SlotGridProps {
    weekStartIso: string
    cells: Map<string, SlotCellView>
    onCellClick?: (slotKey: string) => void
    onCellMenu?: (slotKey: string, option: SlotMenuOption) => void
    /**
     * Chiamata per OGNI cella attraversata da una pennellata, origine
     * compresa. Il verso lo decide la griglia guardando l'origine
     * (`on = stato origine !== 'disponibile'`): il genitore applica e basta.
     */
    onCellPaint?: (slotKey: string, on: boolean) => void
    /** Scorciatoia di riga: click sull'etichetta dell'ora (9..21). */
    onHourToggle?: (hour: number) => void
    /** Scorciatoia di colonna: click sull'intestazione del giorno (0=lun … 5=sab). */
    onDayToggle?: (dayIndex: number) => void
    readOnly?: boolean
}

const DAY_ABBR_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']

const STATE_STYLES: Record<SlotCellState, string> = {
    libero: 'bg-white border-ash-200 text-ash-400',
    disponibile: 'bg-emerald-100 border-emerald-300 text-emerald-900',
    nondisponibile: 'bg-rose-100/70 border-rose-200 text-rose-800',
    occupato: 'bg-sky-100 border-sky-300 text-sky-900',
    bloccato: 'bg-ash-100 border-ash-300 text-ash-500 line-through',
}

/**
 * Righe diagonali sottili per le ore già iniziate: la cella si legge come
 * "fuori gioco" senza spegnerne il colore e senza l'attributo `disabled`,
 * che in Chrome nasconderebbe anche il `title` con la spiegazione.
 */
const PAST_CELL_HATCH = 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(0,0,0,0.05)_6px_8px)]'

const TONE_STYLES: Record<CoverageStatus, string> = {
    rosso: 'bg-rose-500',
    ambra: 'bg-amber-400',
    verde: 'bg-emerald-500',
    neutro: 'bg-transparent',
}

const STATE_LABEL_IT: Record<SlotCellState, string> = {
    libero: 'libero',
    disponibile: 'disponibile',
    nondisponibile: 'non disponibile',
    occupato: 'occupato',
    bloccato: 'bloccato',
}

const MENU_OPTION_ORDER: SlotMenuOption[] = ['disponibile', 'bloccato', 'nondisponibile']

const MENU_OPTION_LABEL_IT: Record<SlotMenuOption, string> = {
    disponibile: 'Disponibile',
    bloccato: 'Imprevisto',
    nondisponibile: 'Non disponibile',
}

const MENU_OPTION_HINT_IT: Record<SlotMenuOption, string> = {
    disponibile: 'Rende la cella verde.',
    bloccato: "Blocca lo slot per un imprevisto (niente multa se c'era un appuntamento).",
    nondisponibile: 'Rende la cella rossa.',
}

const MENU_WIDTH = 224
const MENU_MARGIN = 8
const MENU_APPROX_HEIGHT = 160

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

export function SlotGrid({
    weekStartIso,
    cells,
    onCellClick,
    onCellMenu,
    onCellPaint,
    onHourToggle,
    onDayToggle,
    readOnly,
}: SlotGridProps) {
    const weekStart = new Date(weekStartIso)
    const slots = weekSlots(weekStart)
    const hoursPerDay = SLOT_HOURS.length
    const days: Date[][] = []
    for (let d = 0; d < SLOT_DAYS; d++) {
        days.push(slots.slice(d * hoursPerDay, (d + 1) * hoursPerDay))
    }

    // Pennellata: entrano nel gesto solo le celle che l'utente può davvero
    // ri-dichiarare. Occupate, bloccate e ore già iniziate restano fuori, così
    // passarci sopra col mouse non le tocca (e non interrompe la strisciata).
    const paintable = (key: string) => {
        const v = cells.get(key)
        return !!v && !v.cellDisabled && (v.state === 'disponibile' || v.state === 'nondisponibile' || v.state === 'libero')
    }
    const { containerProps, shouldIgnoreClick } = useDragPaint({
        enabled: !readOnly && !!onCellPaint,
        isPaintable: paintable,
        isOn: key => cells.get(key)?.state === 'disponibile',
        onPaint: (k, on) => onCellPaint?.(k, on),
    })

    // Il menu "⋯" e' un pannello a `position: fixed`, ancorato al bottone che
    // lo apre ma calcolato fuori dal flusso della griglia: la griglia scorre
    // in orizzontale (`overflow-x-auto`), e un pannello posizionato dentro
    // quel contenitore verrebbe tagliato in verticale (le due direzioni di
    // overflow non si possono separare via CSS quando una sola e' "auto").
    const [openKey, setOpenKey] = useState<string | null>(null)
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
    const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>())
    const popoverRef = useRef<HTMLDivElement>(null)
    const menuItemRefs = useRef(new Map<SlotMenuOption, HTMLButtonElement>())

    // Il popover e' reso una volta sola in fondo al contenitore, non accanto
    // al bottone che lo apre (vedi il commento sopra `menuPos`): senza questo
    // aiuto esplicito, da tastiera il focus resterebbe sul "⋯" all'apertura
    // (bisognerebbe attraversare con Tab tutte le celle rimanenti della
    // griglia per raggiungere le tre voci) e non tornerebbe da nessuna parte
    // alla chiusura. Il menu esiste PROPRIO per risolvere un problema di
    // accessibilita' (il `title` invisibile sui bottoni disabilitati in
    // Chrome): consegnarlo cosi' l'avrebbe risolto solo per chi usa il mouse.
    const closeMenu = (restoreFocus: boolean) => {
        const keyToRestore = openKey
        setOpenKey(null)
        if (restoreFocus && keyToRestore) {
            menuButtonRefs.current.get(keyToRestore)?.focus()
        }
    }

    useEffect(() => {
        if (!openKey) return
        function handlePointerDown(e: MouseEvent) {
            const target = e.target as Node
            if (popoverRef.current?.contains(target)) return
            if (menuButtonRefs.current.get(openKey!)?.contains(target)) return
            closeMenu(true)
        }
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') closeMenu(true)
        }
        function handleScrollOrResize() {
            // Chiusura "di cortesia" per non lasciare un pannello ancorato a
            // una posizione ormai sbagliata: nessun ripristino del focus, per
            // non far scattare lo scroll-into-view del browser proprio
            // mentre l'utente sta scorrendo.
            setOpenKey(null)
        }
        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('scroll', handleScrollOrResize, true)
        window.addEventListener('resize', handleScrollOrResize)
        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('scroll', handleScrollOrResize, true)
            window.removeEventListener('resize', handleScrollOrResize)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openKey])

    // All'apertura, il focus si sposta sulla prima voce ABILITATA del menu
    // (Tab la trova subito, senza attraversare il resto della griglia). Se
    // sono spente tutte e tre (es. follow-up non tuo), il focus va sul
    // contenitore: niente da azionare, ma uno screen reader deve poter
    // comunque leggere le tre ragioni.
    useEffect(() => {
        if (!openKey) return
        const menu = cells.get(openKey)?.menu
        if (!menu) return
        const firstEnabled = MENU_OPTION_ORDER.find(opt => !menu[opt].disabled)
        if (firstEnabled) {
            menuItemRefs.current.get(firstEnabled)?.focus()
        } else {
            popoverRef.current?.focus()
        }
        // Solo all'apertura: `cells` cambia riferimento ad ogni tick del
        // countdown nel genitore, e se fosse in dipendenza il focus verrebbe
        // strappato via da sotto le dita a chi ha gia' spostato l'attenzione
        // con Tab.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openKey])

    const toggleMenu = (key: string) => {
        if (openKey === key) {
            setOpenKey(null)
            return
        }
        const btn = menuButtonRefs.current.get(key)
        if (btn) {
            const rect = btn.getBoundingClientRect()
            let left = rect.right - MENU_WIDTH
            left = Math.max(MENU_MARGIN, Math.min(left, window.innerWidth - MENU_WIDTH - MENU_MARGIN))
            let top = rect.bottom + 4
            if (top + MENU_APPROX_HEIGHT > window.innerHeight - MENU_MARGIN) {
                top = Math.max(MENU_MARGIN, rect.top - MENU_APPROX_HEIGHT - 4)
            }
            setMenuPos({ top, left })
        }
        setOpenKey(key)
    }

    const headerLabel = (dayIndex: number): string => {
        const first = days[dayIndex][0]
        const [, month, dayNum] = toRomeDateStr(first).split('-')
        return `${DAY_ABBR_IT[dayIndex]} ${dayNum}/${month}`
    }

    const openView = openKey ? cells.get(openKey) : undefined

    // La colonna delle ore resta ferma mentre la griglia scorre verso sabato:
    // il contenitore e' `overflow-x-auto` con `min-w-[720px]`, e sul telefono
    // le ore uscivano dallo schermo proprio mentre servivano per orientarsi.
    const hourCellClasses = 'sticky left-0 z-10 flex items-center border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-xs font-semibold text-ash-500'
    const dayHeadClasses = 'border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-center text-[11px] font-bold text-ash-700 last:border-r-0'

    return (
        <div className="overflow-x-auto rounded-xl border border-ash-200 bg-white">
            <div
                className="grid min-w-[720px] select-none"
                style={{ gridTemplateColumns: '64px repeat(6, minmax(96px, 1fr))' }}
                {...containerProps}
            >
                <div className="sticky left-0 z-10 border-b border-r border-ash-200 bg-ash-50 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-ash-400">
                    Ora
                </div>
                {days.map((_, d) => (
                    !readOnly && onDayToggle ? (
                        <button
                            key={d}
                            type="button"
                            onClick={() => onDayToggle(d)}
                            aria-label={`Seleziona o deseleziona tutte le ore di ${headerLabel(d)}`}
                            title="Tutto il giorno"
                            className={`${dayHeadClasses} cursor-pointer transition-colors hover:bg-ash-100`}
                        >
                            {headerLabel(d)}
                        </button>
                    ) : (
                        <div key={d} className={dayHeadClasses}>
                            {headerLabel(d)}
                        </div>
                    )
                ))}

                {SLOT_HOURS.map((hour, row) => (
                    <div key={hour} className="contents">
                        {!readOnly && onHourToggle ? (
                            <button
                                type="button"
                                onClick={() => onHourToggle(hour)}
                                aria-label={`Seleziona o deseleziona le ${String(hour).padStart(2, '0')}:00 su tutti i giorni`}
                                title="Tutta la riga"
                                className={`${hourCellClasses} cursor-pointer transition-colors hover:bg-ash-100`}
                            >
                                {String(hour).padStart(2, '0')}:00
                            </button>
                        ) : (
                            <div className={hourCellClasses}>
                                {String(hour).padStart(2, '0')}:00
                            </div>
                        )}
                        {days.map((daySlots, d) => {
                            const instant = daySlots[row]
                            const key = slotKey(instant)
                            const view = cells.get(key) ?? { state: 'libero' as const }
                            // In sola lettura il `disabled` nativo va benissimo:
                            // non c'e' niente da spiegare. In una griglia
                            // modificabile invece l'ora gia' iniziata resta un
                            // bottone abilitato ma inerte: Chrome non mostra il
                            // `title` sui bottoni disabilitati, e la spiegazione
                            // sparirebbe proprio dove serve.
                            const pastCell = !readOnly && !!view.cellDisabled
                            const canPaint = !readOnly && !!onCellPaint && paintable(key)
                            // Il menu dipende da `readOnly` e dalla presenza di
                            // `view.menu`, non da `cellDisabled`: una cella
                            // passata non si ri-dichiara, ma un blocco si
                            // toglie sempre (spec §4.4, "lo sblocco è sempre
                            // consentito").
                            const showMenu = !readOnly && !!onCellMenu && !!view.menu
                            const badgeText = view.badge && /^\d+$/.test(view.badge) ? `+${view.badge}` : view.badge

                            return (
                                <div key={key} className="group relative border-b border-r border-ash-200 last:border-r-0">
                                    <button
                                        type="button"
                                        disabled={!!readOnly}
                                        aria-disabled={pastCell || undefined}
                                        data-paint-key={canPaint ? key : undefined}
                                        title={view.title}
                                        aria-label={ariaLabelFor(instant, view)}
                                        onClick={() => {
                                            if (shouldIgnoreClick()) return
                                            if (view.cellDisabled) return
                                            onCellClick?.(key)
                                        }}
                                        onContextMenu={(e) => {
                                            if (!showMenu) return
                                            e.preventDefault()
                                            toggleMenu(key)
                                        }}
                                        className={`flex min-h-11 w-full flex-col items-center justify-center gap-0.5 border-2 border-transparent px-1 py-1 text-[10px] transition-colors ${STATE_STYLES[view.state]} ${pastCell ? `cursor-not-allowed ${PAST_CELL_HATCH}` : readOnly ? 'cursor-default' : 'cursor-pointer hover:brightness-95'}`}
                                    >
                                        {view.tone && (
                                            <div className={`absolute inset-x-0 top-0 h-[3px] ${TONE_STYLES[view.tone]}`} />
                                        )}
                                        {view.icon === 'check' && <Check className="h-3.5 w-3.5" aria-hidden />}
                                        {view.icon === 'minus' && <Minus className="h-3.5 w-3.5 opacity-60" aria-hidden />}
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
                                    {badgeText && (
                                        <div className="pointer-events-none absolute left-1 top-1 text-[9px] font-semibold leading-none text-ash-500">
                                            {badgeText}
                                        </div>
                                    )}
                                    {showMenu && (
                                        <button
                                            type="button"
                                            ref={(el) => {
                                                if (el) menuButtonRefs.current.set(key, el)
                                                else menuButtonRefs.current.delete(key)
                                            }}
                                            aria-label="Altre azioni sullo slot"
                                            aria-haspopup="menu"
                                            aria-expanded={openKey === key}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                toggleMenu(key)
                                            }}
                                            className={`absolute bottom-0.5 right-0.5 cursor-pointer rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-bold leading-none text-ash-500 transition-opacity hover:bg-white hover:text-ash-800 pointer-coarse:opacity-100 ${openKey === key ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}
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

            {openKey && openView?.menu && menuPos && (
                <div
                    ref={popoverRef}
                    role="menu"
                    aria-label="Scegli lo stato dello slot"
                    // Programmaticamente focalizzabile (vedi l'effetto sopra)
                    // ma fuori dall'ordine di tabulazione: serve solo quando
                    // tutte e tre le voci sono spente, per dare comunque un
                    // punto d'appoggio a chi legge con uno screen reader.
                    tabIndex={-1}
                    style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
                    className="z-50 rounded-lg border border-ash-200 bg-white p-1 shadow-lg focus:outline-none"
                >
                    {MENU_OPTION_ORDER.map(option => {
                        const item = openView.menu![option]
                        return (
                            <button
                                key={option}
                                type="button"
                                role="menuitem"
                                disabled={!!item.disabled}
                                ref={(el) => {
                                    if (el) menuItemRefs.current.set(option, el)
                                    else menuItemRefs.current.delete(option)
                                }}
                                onClick={() => {
                                    onCellMenu?.(openKey, option)
                                    // Chi ha scelto una voce torna al bottone
                                    // "⋯" che aveva aperto il menu: da
                                    // tastiera non si riparte mai da capo.
                                    closeMenu(true)
                                }}
                                className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${item.disabled ? 'cursor-default text-ash-300' : 'cursor-pointer text-ash-800 hover:bg-ash-50'}`}
                            >
                                <span className="text-xs font-semibold">{MENU_OPTION_LABEL_IT[option]}</span>
                                <span className="text-[10px] leading-tight text-ash-400">
                                    {item.reason ?? MENU_OPTION_HINT_IT[option]}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
