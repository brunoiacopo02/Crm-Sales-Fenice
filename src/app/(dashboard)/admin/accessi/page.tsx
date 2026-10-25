import { redirect } from "next/navigation"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getAccessiTeam } from "@/app/actions/credenzialiActions"
import { PaginaAdmin, TitoloAdmin } from "@/components/diretta/admin/ui"
import { AccessiClient } from "./AccessiClient"

// Accessi del team (PO 25/10/2026): l'email con cui entra ognuno, sempre
// quella attuale anche se il GDO l'ha cambiata, e la password da reimpostare
// quando serve. Solo ADMIN, letto dalla tabella users.
export default async function AccessiPage() {
    if (!(await conRuoloDb(['ADMIN']))) redirect('/')
    const r = await getAccessiTeam()
    if (!r.ok) redirect('/')
    return (
        <PaginaAdmin larga>
            <TitoloAdmin
                prima="Accessi del"
                accento="team"
                sotto="L'email di accesso attuale di ogni account. I GDO possono cambiare email e password dal loro profilo: qui le reimposti quando vuoi, senza conoscere quella vecchia. Le password non si vedono, si reimpostano."
            />
            <AccessiClient righe={r.righe} />
        </PaginaAdmin>
    )
}
