import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getDirettaAdmin } from "@/app/actions/direttaActions"
import { DirettaAdminClient } from "./DirettaAdminClient"

export const dynamic = "force-dynamic"

// Pagina admin della Diretta (PO 25/10/2026): interruttori per ruolo e
// obiettivi della nuova gamification. Solo ADMIN, letto dalla tabella users.
export default async function DirettaAdminPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const stato = await getDirettaAdmin()
    if (!stato) redirect("/unauthorized")

    return (
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
            <div>
                <h1 className="text-2xl font-semibold text-brand-charcoal">Diretta</h1>
                <p className="mt-1 text-sm text-ash-500">
                    Interruttori della nuova grafica e obiettivi della gamification. Le modifiche arrivano a tutti entro un minuto.
                </p>
            </div>
            <Link
                href="/admin/diretta/conferme"
                className="flex items-center justify-between gap-4 rounded-2xl border border-ash-200 bg-white p-5 transition-colors hover:border-ash-400"
            >
                <div>
                    <div className="text-base font-semibold text-brand-charcoal">Conferme: bonus e obiettivi</div>
                    <div className="mt-1 text-sm text-ash-500">Bonus di squadra e obiettivi individuali della colonna arancione delle Conferme.</div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-ash-400" aria-hidden="true" />
            </Link>
            <DirettaAdminClient flags={stato.flags} obiettivi={stato.obiettivi} />
        </div>
    )
}
