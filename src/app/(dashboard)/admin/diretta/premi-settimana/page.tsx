import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { appSettings } from "@/db/schema"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { readGamificationTargets } from "@/lib/diretta/settings"
import { CONFERME_BONUS_KEY, parseConfermeBonus } from "@/lib/conferme/bonus"
import { readEconomyRules } from "@/lib/economy/awards"
import { getPremiSettimane } from "@/app/actions/premiSettimanaActions"
import { PremiSettimanaClient } from "./PremiSettimanaClient"

export const dynamic = "force-dynamic"

/**
 * Premi in euro della settimana lun-sab (PO 25/10/2026): classifica dei primi
 * tre, bonus presenze dei GDO e bonus di squadra delle Conferme. Si calcolano
 * e si registrano a settimana chiusa; lo storico dice chi pagare e quanto.
 * Solo ADMIN, letto dalla tabella users.
 */
export default async function PremiSettimanaPage() {
    if (!(await conRuoloDb(["ADMIN"]))) redirect("/unauthorized")

    const [settimane, economia, obiettivi, confermeRow] = await Promise.all([
        getPremiSettimane(),
        readEconomyRules(),
        readGamificationTargets(),
        db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CONFERME_BONUS_KEY)).limit(1),
    ])
    const conferme = parseConfermeBonus(confermeRow[0]?.value)

    return (
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
            <Link href="/admin/diretta" className="inline-flex items-center gap-1 text-sm text-ash-500 transition-colors hover:text-brand-charcoal">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Diretta
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-brand-charcoal">Premi della settimana</h1>
                <p className="mt-1 text-sm text-ash-500">
                    La settimana va da lunedì a sabato. Dalla domenica si registra: i numeri restano quelli, anche se dopo cambia qualcosa sui lead.
                </p>
            </div>
            <PremiSettimanaClient
                settimane={settimane}
                regole={{
                    classifica: economia.classifica.premiEuro,
                    minPresenze: economia.classifica.minPresenze,
                    sogliaPresenze: obiettivi.presenzeSogliaEuro,
                    euroPresenza: obiettivi.euroPerPresenza,
                    conferme: { unita: conferme.unita, periodo: conferme.periodo, soglia: conferme.soglia, euro: conferme.euroPerUnita },
                }}
            />
        </div>
    )
}
