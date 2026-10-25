import { redirect } from "next/navigation"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getDirettaAdmin } from "@/app/actions/direttaActions"
import { Indietro, PaginaAdmin, TitoloAdmin } from "@/components/diretta/admin/ui"
import { ObiettiviForm } from "./ObiettiviForm"

export const dynamic = "force-dynamic"

// Obiettivi della Diretta (PO 25/10/2026): scalini, orari, pause e presenze.
// Ci si arriva dal centro di controllo. Solo ADMIN, letto dalla tabella users.
export default async function ObiettiviDirettaPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const stato = await getDirettaAdmin()
    if (!stato) redirect("/unauthorized")

    return (
        <PaginaAdmin>
            <Indietro href="/admin/diretta">Centro di controllo</Indietro>
            <TitoloAdmin
                prima="Gli"
                accento="obiettivi"
                dopo="della Diretta"
                sotto="Le modifiche arrivano a GDO e Conferme entro un minuto."
            />
            <div className="mt-8">
                <ObiettiviForm obiettivi={stato.obiettivi} />
            </div>
        </PaginaAdmin>
    )
}
