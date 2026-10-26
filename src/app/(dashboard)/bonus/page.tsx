import Link from "next/link"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { Headphones, PhoneCall, Briefcase, Trophy } from "lucide-react"
import { db } from "@/db"
import { appSettings } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { BONUS_GDO } from "@/lib/bonus/soglie"
import { CONFERME_BONUS_KEY, parseConfermeBonus } from "@/lib/conferme/bonus"
import { readEconomyRules } from "@/lib/economy/awards"
import { isBonusUnlocked } from "@/app/actions/bonusPinActions"
import BonusLock from "./BonusLock"

export const dynamic = "force-dynamic"

const eur = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 })

/**
 * Regole dei bonus da comunicare (PO 25/10/2026): soglie fisse, settimana da
 * lunedì a sabato. GDO e classifica dalla configurazione della Diretta e
 * dell'economia, Conferme da /admin/diretta/conferme. Chi ha maturato cosa,
 * settimana per settimana, sta in /admin/diretta/premi-settimana.
 */
export default async function BonusPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") redirect("/unauthorized")
    if (!(await isBonusUnlocked())) return <BonusLock />

    const [economia, confermeRow] = await Promise.all([
        readEconomyRules(),
        db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CONFERME_BONUS_KEY)).limit(1),
    ])
    const conferme = parseConfermeBonus(confermeRow[0]?.value)
    const [primo, secondo, terzo] = economia.classifica.premiEuro
    const unita = conferme.unita === "chiusure" ? { una: "chiusura", tante: "chiusure" } : { una: "presenza", tante: "presenze" }
    const periodo = conferme.periodo === "settimana" ? "della settimana" : "del mese"

    return (
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
            <div>
                <h1 className="text-2xl font-bold text-brand-charcoal">Bonus</h1>
                <p className="mt-1 text-sm text-ash-500">
                    Soglie fisse, la settimana va da lunedì a sabato. Importi lordi.
                    Chi ha maturato cosa si registra a settimana chiusa in{" "}
                    <Link href="/admin/diretta/premi-settimana" className="font-semibold text-brand-orange underline">Premi della settimana</Link>.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <BonusCard
                    icon={<PhoneCall className="h-5 w-5" />}
                    titolo="GDO"
                    valore={`${BONUS_GDO.soglia} presenze`}
                    sotto="a settimana, per persona"
                    testo={`Dalla ${BONUS_GDO.soglia + 1}ª presenza della settimana in poi prendi ${eur(BONUS_GDO.euro)} per ogni presenza, senza tetto. Contano solo gli appuntamenti confermati dalle Conferme e presentati.`}
                />
                <BonusCard
                    icon={<Trophy className="h-5 w-5" />}
                    titolo="Classifica"
                    etichetta="Premi"
                    valore={`${eur(primo)} · ${eur(secondo)} · ${eur(terzo)}`}
                    sotto="ai primi tre della settimana"
                    testo="Si guarda chi ha più presenze da lunedì a sabato. A pari presenze si è pari merito: i premi dei posti occupati si sommano e si dividono in parti uguali. Si vedono solo i primi tre; il lunedì si riparte da zero."
                />
                <BonusCard
                    icon={<Headphones className="h-5 w-5" />}
                    titolo="Conferme"
                    valore={`${conferme.soglia} ${unita.tante}`}
                    sotto={`${periodo}, di squadra`}
                    testo={`Bonus di squadra: dalla ${conferme.soglia + 1}ª ${unita.una} ${periodo} in poi ognuno di voi prende ${eur(conferme.euroPerUnita)} per ogni ${unita.una}, senza tetto. Contano i lead che avete confermato voi.`}
                />
                <BonusCard
                    icon={<Briefcase className="h-5 w-5" />}
                    titolo="Venditori"
                    valore="+0,5% / +1%"
                    sotto="sull'incasso, uguale ogni mese"
                    testo="Se almeno l'85% di chi firma nel mese paga entro lo stesso mese, +0,5% di provvigione su quei contratti. Se almeno il 90%, +1%."
                />
            </div>
        </div>
    )
}

function BonusCard({ icon, titolo, etichetta = "Soglia", valore, sotto, testo }: {
    icon: React.ReactNode
    titolo: string
    etichetta?: string
    valore: string
    sotto: string
    testo: string
}) {
    return (
        <div className="flex flex-col rounded-2xl border border-ash-200/60 bg-white p-5 shadow-soft">
            <div className="flex items-center gap-2 text-brand-orange">
                {icon}
                <span className="text-sm font-bold uppercase tracking-wide text-brand-charcoal">{titolo}</span>
            </div>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-ash-500">{etichetta}</div>
            <div className="text-2xl font-bold text-brand-charcoal">{valore}</div>
            <div className="text-sm text-ash-500">{sotto}</div>
            <div className="mt-4 rounded-xl bg-ash-50/80 p-3 text-sm leading-relaxed text-ash-700">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ash-500">Da comunicare</div>
                {testo}
            </div>
        </div>
    )
}
