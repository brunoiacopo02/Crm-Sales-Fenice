import Link from "next/link"
import { redirect } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { Headphones, PhoneCall, Briefcase, Target } from "lucide-react"
import { db } from "@/db"
import { monthlyLeadTargets } from "@/db/schema"
import { createClient } from "@/utils/supabase/server"
import { currentTenant } from "@/lib/tenancy"
import { currentYearMonthRome } from "@/lib/workingDaysUtils"
import { calcolaSoglieBonus, ANCORA_FATTURATO_EUR, ANCORA_MESE } from "@/lib/bonus/soglie"
import { isBonusUnlocked } from "@/app/actions/bonusPinActions"
import BonusLock from "./BonusLock"

export const dynamic = "force-dynamic"

const MONTH_RE = /^\d{4}-\d{2}$/

function shiftMonth(ym: string, delta: number): string {
    const [y, m] = ym.split("-").map(Number)
    const d = new Date(Date.UTC(y, m - 1 + delta, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Dal mese dell'ancora fino al mese prossimo (le soglie si preparano prima di comunicarle). */
function monthOptions(current: string): string[] {
    const out: string[] = []
    for (let ym = shiftMonth(current, 1); ym >= ANCORA_MESE; ym = shiftMonth(ym, -1)) out.push(ym)
    return out
}

const eur = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number)
    const s = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" })
    return s.charAt(0).toUpperCase() + s.slice(1)
}

export default async function BonusPage({ searchParams }: { searchParams: Promise<{ mese?: string }> }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.user_metadata?.role !== "ADMIN") redirect("/unauthorized")
    if (!(await isBonusUnlocked())) return <BonusLock />

    const current = currentYearMonthRome()
    const months = monthOptions(current)
    const raw = (await searchParams).mese
    const mese = raw && MONTH_RE.test(raw) && months.includes(raw) ? raw : current

    const ctx = await currentTenant()
    const [cfg] = await db.select({ obiettivo: monthlyLeadTargets.targetFatturatoMonthly })
        .from(monthlyLeadTargets)
        .where(and(eq(monthlyLeadTargets.companyId, ctx.companyId), eq(monthlyLeadTargets.yearMonth, mese)))
    const obiettivo = cfg?.obiettivo ?? 0
    const soglie = calcolaSoglieBonus(obiettivo)

    return (
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-brand-charcoal">Bonus</h1>
                    <p className="mt-1 text-sm text-ash-500">
                        Le soglie di GDO e Conferme si ricalcolano dall&apos;obiettivo di fatturato del mese.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {months.map(ym => (
                        <Link
                            key={ym}
                            href={`/bonus?mese=${ym}`}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${ym === mese
                                ? "border-brand-orange bg-brand-orange text-brand-charcoal"
                                : "border-ash-200 bg-white text-ash-600 hover:border-brand-orange"}`}
                        >
                            {monthLabel(ym)}
                        </Link>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-ash-200/60 bg-white p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-orange/10 text-brand-orange">
                        <Target className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide text-ash-500">Obiettivo di fatturato · {monthLabel(mese)}</div>
                        <div className="text-2xl font-bold text-brand-charcoal">{obiettivo > 0 ? eur(obiettivo) : "Non impostato"}</div>
                    </div>
                </div>
                <div className="text-sm text-ash-500 sm:text-right">
                    {soglie
                        ? <>Rispetto all&apos;ancora di ottobre 2026 ({eur(ANCORA_FATTURATO_EUR)}): <span className="font-semibold text-brand-charcoal">×{soglie.fattore.toLocaleString("it-IT", { maximumFractionDigits: 2 })}</span></>
                        : <>Impostalo in <Link href="/panoramica-generale" className="font-semibold text-brand-orange underline">Sales Manager → Numeri mensili</Link>: le soglie compaiono qui da sole.</>}
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <BonusCard
                    icon={<PhoneCall className="h-5 w-5" />}
                    titolo="GDO"
                    valore={soglie ? `${soglie.gdo.soglia} presenze` : "—"}
                    sotto="a settimana, per persona"
                    testo={soglie
                        ? `Dalla ${soglie.gdo.soglia + 1}ª presenza della settimana in poi prendi ${eur(soglie.gdo.euro)} per ogni presenza, senza tetto. Contano solo gli appuntamenti confermati dalle Conferme e presentati.`
                        : null}
                />
                <BonusCard
                    icon={<Headphones className="h-5 w-5" />}
                    titolo="Conferme"
                    valore={soglie ? `${soglie.conferme.soglia} chiusure` : "—"}
                    sotto="a settimana, di squadra"
                    testo={soglie
                        ? `Bonus di squadra: dalla ${soglie.conferme.soglia + 1}ª chiusura della settimana in poi ognuno di voi prende ${eur(soglie.conferme.euro)} per ogni chiusura, senza tetto. Contano le chiusure di lead che avete confermato voi.`
                        : null}
                />
                <BonusCard
                    icon={<Briefcase className="h-5 w-5" />}
                    titolo="Venditori"
                    valore="+0,5% / +1%"
                    sotto="sull'incasso, uguale ogni mese"
                    testo="Se almeno l'85% di chi firma nel mese paga entro lo stesso mese, +0,5% di provvigione su quei contratti. Se almeno il 90%, +1%."
                />
            </div>

            <p className="text-xs leading-relaxed text-ash-500">
                Formula: soglia = arrotondamento di (soglia di ottobre 2026 × obiettivo del mese ÷ {eur(ANCORA_FATTURATO_EUR)}).
                A ottobre 2026 GDO 5 e Conferme 20; gli importi ({eur(12)} e {eur(15)}) non cambiano.
            </p>
        </div>
    )
}

function BonusCard({ icon, titolo, valore, sotto, testo }: {
    icon: React.ReactNode
    titolo: string
    valore: string
    sotto: string
    testo: string | null
}) {
    return (
        <div className="flex flex-col rounded-2xl border border-ash-200/60 bg-white p-5 shadow-soft">
            <div className="flex items-center gap-2 text-brand-orange">
                {icon}
                <span className="text-sm font-bold uppercase tracking-wide text-brand-charcoal">{titolo}</span>
            </div>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-ash-500">Soglia</div>
            <div className="text-2xl font-bold text-brand-charcoal">{valore}</div>
            <div className="text-sm text-ash-500">{sotto}</div>
            <div className="mt-4 rounded-xl bg-ash-50/80 p-3 text-sm leading-relaxed text-ash-700">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ash-500">Da comunicare</div>
                {testo ?? "Imposta l'obiettivo di fatturato del mese per vedere il bonus."}
            </div>
        </div>
    )
}
