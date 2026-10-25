"use client"

// Il centro di controllo si ridisegna da solo: una volta al minuto e solo a
// scheda visibile; tornando sulla scheda, subito se l'ultimo giro è vecchio.
// I numeri lato server hanno cache di 15-30 secondi: più spesso non servirebbe.

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

const OGNI_MS = 60_000

export function AggiornaCentro() {
    const router = useRouter()
    const ultimo = useRef(0)

    useEffect(() => {
        ultimo.current = Date.now()
        const giro = () => {
            if (document.hidden) return
            if (Date.now() - ultimo.current < OGNI_MS) return
            ultimo.current = Date.now()
            router.refresh()
        }
        const id = setInterval(giro, 15_000)
        document.addEventListener('visibilitychange', giro)
        return () => {
            clearInterval(id)
            document.removeEventListener('visibilitychange', giro)
        }
    }, [router])

    return null
}
