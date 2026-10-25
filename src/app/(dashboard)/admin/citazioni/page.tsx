import { redirect } from "next/navigation"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getQuoteCalendar } from "@/app/actions/quoteActions"
import { Indietro, PaginaAdmin, TitoloAdmin } from "@/components/diretta/admin/ui"
import { CitazioniAdminClient } from "./CitazioniAdminClient"

export const dynamic = "force-dynamic"

// Calendario della citazione del giorno e del consiglio di vendita (PO 25/10/2026):
// l'admin controlla le fonti, approva, modifica o riscrive riflessioni e consigli
// e, se serve, cambia la frase di un giorno. Solo ADMIN, letto dalla tabella users.
export default async function CitazioniAdminPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const data = await getQuoteCalendar(14)

    return (
        <PaginaAdmin>
            <Indietro href="/admin/diretta">Centro di controllo</Indietro>
            <TitoloAdmin
                prima="Citazioni del"
                accento="giorno"
                sotto="I prossimi 14 giorni lavorativi. Riflessioni e consigli si vedono solo dopo l'approvazione: si approvano così come sono, si modificano o si riscrivono da zero, al massimo 10 righe."
            />
            {data.ok ? (
                <CitazioniAdminClient days={data.days} closedDays={data.closedDays} />
            ) : (
                <div role="alert" className="mt-8 rounded-[16px] bg-[#262626] px-5 py-4 text-[15px] font-semibold text-[#FF9330]">{data.error}</div>
            )}
        </PaginaAdmin>
    )
}
