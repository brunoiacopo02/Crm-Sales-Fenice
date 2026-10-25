// Variante per le pagine server (GDO, Conferme, venditori, admin): legge in
// cache sul server e passa i dati al componente, senza un secondo giro dal
// browser. Se oggi non c'è niente da mostrare non occupa spazio.

import { Suspense } from "react"
import { readTodayQuotes } from "@/lib/quotes/today"
import { DailyQuoteSlot } from "./DailyQuoteSlot"

interface Props {
    role: string | null | undefined
    className?: string
}

async function Loaded({ role, className }: Props) {
    const data = await readTodayQuotes(role)
    if (!data.citazione && !data.vendita) return null
    return (
        <DailyQuoteSlot
            initial={data}
            className={className}
            manageHref={role === "ADMIN" ? "/admin/citazioni" : undefined}
        />
    )
}

export function DailyQuoteSlotServer(props: Props) {
    return (
        <Suspense fallback={null}>
            <Loaded {...props} />
        </Suspense>
    )
}
