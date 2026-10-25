"use client"

// Allinea la cornice alla pagina quando l'interruttore della Diretta cambia a
// sessione aperta (regola in src/lib/diretta/veste.ts). Va messa nelle pagine
// che scelgono la veste leggendo l'interruttore: se la cornice (data-ui del div
// radice del layout) dice altro, un router.refresh() ridisegna layout e pagina
// insieme. Non disegna niente.

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { RADICE_DASHBOARD, serveRiallineare } from "@/lib/diretta/veste"

let ultimoRefresh = 0

export function VesteAllineata({ diretta }: { diretta: boolean }) {
    const router = useRouter()
    useEffect(() => {
        const radice = document.querySelector(`[${RADICE_DASHBOARD}]`)
        if (!radice) return
        const adesso = Date.now()
        if (!serveRiallineare({ uiLayout: radice.getAttribute('data-ui'), paginaDiretta: diretta, ultimoRefresh, adesso })) return
        ultimoRefresh = adesso
        router.refresh()
    }, [diretta, router])
    return null
}
