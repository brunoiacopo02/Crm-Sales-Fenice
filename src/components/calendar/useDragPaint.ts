"use client"
import { useRef, useCallback, type PointerEvent as ReactPointerEvent } from "react"

/**
 * Pennellata "premi e trascina" su una griglia di celle marcate con
 * `data-paint-key`. Solo mouse/penna: su touch `touch-action: none`
 * impedirebbe di scorrere la pagina col dito, quindi lì resta il tap.
 *
 * Il click singolo NON passa di qui: la pennellata inizia solo quando il
 * puntatore entra in una SECONDA cella. A quel punto l'origine viene
 * dipinta e il `click` che il browser emette al rilascio va ignorato
 * (`shouldIgnoreClick`), altrimenti l'origine cambierebbe due volte.
 *
 * La cattura del puntatore e' PIGRA, e per questo il click normale non passa
 * mai per la cattura: catturare gia' sul `pointerdown` ri-targettizza
 * `mouseup`/`click` sul contenitore, il `<button>` della cella non riceve
 * piu' il suo `onClick` e il click singolo muore. Si cattura solo quando la
 * strisciata parte davvero (seconda cella), dove serve per continuare a
 * ricevere i `pointermove` anche uscendo dalla griglia.
 */
export interface DragPaintOptions {
    enabled: boolean
    /** La cella accetta la pennellata (non occupata/bloccata/passata). */
    isPaintable: (key: string) => boolean
    /** Stato attuale della cella: decide il verso della pennellata dall'origine. */
    isOn: (key: string) => boolean
    onPaint: (key: string, on: boolean) => void
}

export function useDragPaint({ enabled, isPaintable, isOn, onPaint }: DragPaintOptions) {
    const stroke = useRef<{ origin: string; on: boolean; painted: Set<string>; started: boolean; captured: boolean } | null>(null)
    const ignoreNextClick = useRef(false)

    const keyAt = (x: number, y: number): string | null => {
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-paint-key]')
        return el?.dataset.paintKey ?? null
    }

    const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        if (!enabled) return
        if (e.pointerType === 'touch' || e.button !== 0) return
        // Il "⋯" apre un menu: premerlo non deve mai iniziare una strisciata.
        if ((e.target as HTMLElement).closest('button[aria-haspopup="menu"]')) return
        const key = (e.target as HTMLElement).closest<HTMLElement>('[data-paint-key]')?.dataset.paintKey
        if (!key || !isPaintable(key)) return
        stroke.current = { origin: key, on: !isOn(key), painted: new Set(), started: false, captured: false }
    }, [enabled, isPaintable, isOn])

    const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        const s = stroke.current
        if (!s) return
        const key = keyAt(e.clientX, e.clientY)
        if (!key) return
        if (!s.started) {
            if (key === s.origin) return
            s.started = true
            ignoreNextClick.current = true
            // Solo ORA la cattura: `e.currentTarget` e' ancora il contenitore
            // della griglia (vedi il commento in testa al file).
            try {
                e.currentTarget.setPointerCapture(e.pointerId)
                s.captured = true
            } catch { /* puntatore gia' sparito: la strisciata prosegue lo stesso */ }
            s.painted.add(s.origin)
            onPaint(s.origin, s.on)
        }
        if (s.painted.has(key) || !isPaintable(key)) return
        s.painted.add(key)
        onPaint(key, s.on)
    }, [isPaintable, onPaint])

    const endStroke = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        const s = stroke.current
        if (!s) return
        stroke.current = null
        // Si rilascia solo se si era davvero catturato: su un click singolo la
        // cattura non c'e' mai stata.
        if (s.captured && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* già rilasciato */ }
        }
        // Il click arriva DOPO pointerup: il flag si azzera al primo click
        // successivo, o al prossimo giro di event loop se il click non arriva
        // (rilascio fuori dalla griglia).
        setTimeout(() => { ignoreNextClick.current = false }, 0)
    }, [])

    /** Da chiamare all'inizio dell'handler di click della cella: `true` = era la fine di una pennellata. */
    const shouldIgnoreClick = useCallback((): boolean => {
        if (!ignoreNextClick.current) return false
        ignoreNextClick.current = false
        return true
    }, [])

    return {
        containerProps: {
            onPointerDown,
            onPointerMove,
            onPointerUp: endStroke,
            onPointerCancel: endStroke,
        },
        shouldIgnoreClick,
    }
}
