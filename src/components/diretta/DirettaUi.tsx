"use client"

// Contesto della Diretta per i componenti riusati dalla board (LeadCard,
// GdoQuickActions): sotto il provider prendono la veste scura, fuori (per
// esempio nel ContactDrawer della ricerca) restano come sono. `aperto` segna
// il lead in cima alla coda, quello da chiamare adesso.

import { createContext, useContext, useMemo } from "react"

type DirettaUi = { attiva: boolean; aperto: boolean }

const Ctx = createContext<DirettaUi>({ attiva: false, aperto: false })

export function DirettaUiProvider({ aperto = false, children }: { aperto?: boolean; children: React.ReactNode }) {
    const valore = useMemo(() => ({ attiva: true, aperto }), [aperto])
    return <Ctx.Provider value={valore}>{children}</Ctx.Provider>
}

export function useDirettaUi(): DirettaUi {
    return useContext(Ctx)
}
