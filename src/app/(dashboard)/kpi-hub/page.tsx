import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import {
    LayoutDashboard,
    Trophy,
    Database,
    Search,
    Users,
    TrendingUp,
    BarChart3,
    ArrowRight,
} from "lucide-react"

const kpiSections = [
    {
        title: "KPI Team",
        description: "Panoramica aggregata delle performance del team, grafici flussi chiamate/appuntamenti e ranking operatori.",
        href: "/kpi-team",
        icon: Users,
        color: "from-blue-500/20 to-blue-600/10",
        iconColor: "text-blue-400",
        borderColor: "border-blue-500/20",
    },
    {
        title: "KPI GDO",
        description: "Metriche dettagliate per ogni operatore GDO: chiamate, appuntamenti, conversion rate e produttività.",
        href: "/kpi-gdo",
        icon: LayoutDashboard,
        color: "from-emerald-500/20 to-emerald-600/10",
        iconColor: "text-emerald-400",
        borderColor: "border-emerald-500/20",
    },
    {
        title: "KPI Venditori",
        description: "Monitoraggio fatturato, closing rate e performance del team di Closer.",
        href: "/kpi-venditori",
        icon: Trophy,
        color: "from-amber-500/20 to-amber-600/10",
        iconColor: "text-amber-400",
        borderColor: "border-amber-500/20",
    },
    {
        title: "KPI Conferme",
        description: "Tassi di conferma appuntamenti, follow-up e qualità del lavoro del team Conferme.",
        href: "/kpi-conferme",
        icon: BarChart3,
        color: "from-purple-500/20 to-purple-600/10",
        iconColor: "text-purple-400",
        borderColor: "border-purple-500/20",
    },
    {
        title: "Marketing Analytics",
        description: "Analisi dei canali di acquisizione, costo per lead e ROI delle campagne marketing.",
        href: "/marketing-analytics",
        icon: Database,
        color: "from-pink-500/20 to-pink-600/10",
        iconColor: "text-pink-400",
        borderColor: "border-pink-500/20",
    },
    {
        title: "Analisi Qualità",
        description: "Reportistica avanzata sui funnel, ranking scarti e analisi colli di bottiglia del team.",
        href: "/analisi-qualita",
        icon: Search,
        color: "from-cyan-500/20 to-cyan-600/10",
        iconColor: "text-cyan-400",
        borderColor: "border-cyan-500/20",
    },
    {
        title: "Performance GDO",
        description: "Confronto performance mensili tra operatori GDO con trend e obiettivi raggiunti.",
        href: "/manager-gdo-performance",
        icon: TrendingUp,
        color: "from-orange-500/20 to-orange-600/10",
        iconColor: "text-orange-400",
        borderColor: "border-orange-500/20",
    },
]

export default async function KpiHubPage() {
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const session = supabaseUser
        ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } }
        : null

    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "MANAGER")) {
        redirect("/")
    }

    if (session.user.email === "marketing@fenice.local" || session.user.name === "Marketing") {
        redirect("/marketing-analytics")
    }

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold text-white">Centro KPI</h1>
                <p className="text-sm text-ash-400 mt-1">
                    Hub centrale per accedere rapidamente a tutte le metriche e analytics del CRM.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {kpiSections.map((section) => {
                    const Icon = section.icon
                    return (
                        <Link
                            key={section.href}
                            href={section.href}
                            className={`group relative overflow-hidden rounded-xl border ${section.borderColor} bg-gradient-to-br ${section.color} backdrop-blur-sm p-5 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/20`}
                        >
                            <div className="flex items-start gap-4">
                                <div className={`rounded-lg bg-white/5 p-2.5 ${section.iconColor}`}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-white group-hover:text-brand-orange transition-colors">
                                        {section.title}
                                    </h3>
                                    <p className="text-xs text-ash-400 mt-1 line-clamp-2">
                                        {section.description}
                                    </p>
                                </div>
                                <ArrowRight className="h-4 w-4 text-ash-500 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 shrink-0 mt-1" />
                            </div>
                        </Link>
                    )
                })}
            </div>
        </div>
    )
}
