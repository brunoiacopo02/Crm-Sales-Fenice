import { redirect } from "next/navigation"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { leggiPanoramica, leggiPersone, leggiStorico } from "@/lib/diretta/regiaDb"
import { Indietro, NonDisponibile, PaginaAdmin, TitoloAdmin, oraDi } from "@/components/diretta/admin/ui"
import { AggiornaRegia } from "./AggiornaRegia"
import { RegiaClient } from "./RegiaClient"

export const dynamic = "force-dynamic"
// "Dai al bot" spinge i lead a 30 al minuto: fino a 60 lead in un'operazione.
export const maxDuration = 300

/**
 * Regia dei lead (PO 09/11/2026): la panoramica dei lead di tutti i GDO, del
 * bot e dei senza assegnatario, e le operazioni che prima il PO chiedeva a
 * Claude (sposta, dai al bot, togli dal bot, accantona, in cima, scarta,
 * doppione, togli appuntamento, interruttori del GDO). Ogni operazione ha
 * l'anteprima e si annulla dallo storico. Solo ADMIN, dalla tabella users.
 * Panoramica in cache 45 secondi, pagina riletta ogni minuto a scheda visibile.
 */
export default async function RegiaLeadPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const [panoramica, storico, persone] = await Promise.all([
        leggiPanoramica().catch((e: unknown) => { console.error("[regia lead] panoramica", e); return null }),
        leggiStorico().catch((e: unknown) => { console.error("[regia lead] storico", e); return [] }),
        leggiPersone().catch((e: unknown) => { console.error("[regia lead] persone", e); return [] }),
    ])

    return (
        <PaginaAdmin larga>
            <Indietro href="/admin/diretta">Centro di controllo</Indietro>
            <TitoloAdmin
                prima="Regia dei"
                accento="lead"
                sotto={<>I lead aperti di ogni GDO, del bot e senza assegnatario. Tocca una riga per vedere i suoi lead e spostarli. Ogni operazione mostra prima l&apos;anteprima e si può annullare dallo storico in fondo.</>}
            />
            <AggiornaRegia oraDati={panoramica ? oraDi(panoramica.calcolatoAlle) : "—"} />
            {!panoramica ? (
                <div className="mt-6 rounded-[16px] bg-[#262626] p-5"><NonDisponibile /></div>
            ) : (
                <RegiaClient panoramica={panoramica} storico={storico} persone={persone} />
            )}
        </PaginaAdmin>
    )
}
