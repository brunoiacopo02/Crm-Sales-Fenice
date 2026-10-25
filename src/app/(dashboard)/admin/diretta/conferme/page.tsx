import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getConfermeBonusSettings } from "@/app/actions/confermeDirettaActions"
import { ConfermeBonusForm } from "./ConfermeBonusForm"

export const dynamic = "force-dynamic"

/**
 * Configurazione del bonus Conferme e degli obiettivi individuali (PO 25/10/2026),
 * mostrati nella colonna arancione della pagina Conferme in Diretta. Solo ADMIN,
 * letto dalla tabella users. Ci si arriva da /admin/diretta e dalla Sidebar admin.
 */
export default async function ConfermeDirettaAdminPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const settings = await getConfermeBonusSettings()

    return (
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
            <Link href="/admin/diretta" className="inline-flex items-center gap-1 text-sm text-ash-500 transition-colors hover:text-brand-charcoal">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Diretta
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-brand-charcoal">Conferme in Diretta</h1>
                <p className="mt-1 text-sm text-ash-500">
                    Bonus di squadra e obiettivi individuali che le Conferme vedono nella colonna arancione della loro pagina.
                </p>
            </div>
            <ConfermeBonusForm initial={settings} />
        </div>
    )
}
