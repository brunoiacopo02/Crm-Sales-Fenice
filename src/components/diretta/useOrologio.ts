"use client"

import { useEffect, useState } from "react"

/**
 * Orologio solo lato client: null al primo render (server e idratazione
 * vedono la stessa cosa), poi l'ora vera, aggiornata ogni `ogniMs`.
 */
export function useOrologio(ogniMs = 10_000): Date | null {
    const [adesso, setAdesso] = useState<Date | null>(null)
    useEffect(() => {
        setAdesso(new Date())
        const id = setInterval(() => setAdesso(new Date()), ogniMs)
        return () => clearInterval(id)
    }, [ogniMs])
    return adesso
}
