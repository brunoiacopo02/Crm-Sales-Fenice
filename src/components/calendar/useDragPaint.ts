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
    const stroke = useRef<{ origin: string; on: boolean; painted: Set<string>; started: boolean } | null>(null)
    const ignoreNextClick = useRef(false)

    const keyAt = (x: number, y: number): string | null => {
        const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-paint-key]')
        return el?.dataset.paintKey ?? null
    }

    const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        if (!enabled) return
        if (e.pointerType === 'touch' || e.button !== 0) return
        const key = (e.target as HTMLElement).closest<HTMLElement>('[data-paint-key]')?.dataset.paintKey
        if (!key || !isPaintable(key)) return
        stroke.current = { origin: key, on: !isOn(key), painted: new Set(), started: false }
        e.currentTarget.setPointerCapture(e.pointerId)
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
            s.painted.add(s.origin)
            onPaint(s.origin, s.on)
        }
        if (s.painted.has(key) || !isPaintable(key)) return
        s.painted.add(key)
        onPaint(key, s.on)
    }, [isPaintable, onPaint])

    const endStroke = useCallback((e: ReactPointerEvent<HTMLElement>) => {
        if (!stroke.current) return
        stroke.current = null
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* già rilasciato */ }
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
