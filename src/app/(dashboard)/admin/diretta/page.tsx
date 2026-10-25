import { redirect } from "next/navigation"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { getDirettaAdmin } from "@/app/actions/direttaActions"
import { getCentroDiretta } from "@/app/actions/centroDirettaActions"
import { getQuoteCalendar } from "@/app/actions/quoteActions"
import { getConfermeBonusSettings } from "@/app/actions/confermeDirettaActions"
import { maiuscola } from "@/lib/diretta/centro"
import { PaginaAdmin, Sezione, TitoloAdmin, oraDi } from "@/components/diretta/admin/ui"
import { InterruttoriDiretta } from "./InterruttoriDiretta"
import { AggiornaCentro } from "./AggiornaCentro"
import {
    LinkPremiSettimana, SezioneBonusConferme, SezioneCitazioni, SezioneControlli, SezioneNegozio,
    SezioneObiettivi, SezioneOggi, SezioneRegistro,
} from "./sezioni"

export const dynamic = "force-dynamic"

// Centro di controllo della Diretta (PO 25/10/2026): in un colpo d'occhio
// interruttori e obiettivi, la giornata della squadra, citazioni da approvare,
// richieste del negozio, bonus Conferme, registro delle monete e controlli
// anti-imbroglio, con i link alle pagine di dettaglio. Solo ADMIN, letto
// dalla tabella users; ogni action lo ricontrolla.
export default async function CentroDirettaPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const [stato, centro, calendario, bonus] = await Promise.all([
        getDirettaAdmin(),
        getCentroDiretta(),
        getQuoteCalendar(14).catch(() => ({ ok: false as const, error: "Calendario non disponibile." })),
        getConfermeBonusSettings().catch((e: unknown) => {
            console.error("[centro diretta] bonus Conferme", e)
            return null
        }),
    ])
    if (!stato || !centro) redirect("/unauthorized")

    const adesso = new Date(centro.calcolatoAlle)
    const giornoLungo = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" }).format(adesso)

    return (
        <PaginaAdmin larga>
            <AggiornaCentro />
            <TitoloAdmin
                prima="Centro di"
                accento="controllo"
                sotto={<>{maiuscola(giornoLungo)}, aggiornato alle {oraDi(centro.calcolatoAlle)}.</>}
            />

            <div className="mt-8 grid items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                    <SezioneOggi centro={centro} />
                    <SezioneControlli controlli={centro.controlli} oggi={centro.giorno} />
                    <SezioneRegistro registro={centro.registro} oggi={centro.giorno} />
                    <SezioneObiettivi o={stato.obiettivi} />
                </div>

                <div className="flex min-w-0 flex-col gap-4">
                    <Sezione titolo="Interruttori">
                        <InterruttoriDiretta flags={stato.flags} />
                    </Sezione>
                    <SezioneNegozio negozio={centro.negozio} oggi={centro.giorno} />
                    <SezioneCitazioni calendario={calendario} />
                    <LinkPremiSettimana />
                    <SezioneBonusConferme bonus={bonus} adesso={adesso} />
                </div>
            </div>
        </PaginaAdmin>
    )
}
