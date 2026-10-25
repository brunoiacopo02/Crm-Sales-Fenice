import { createClient } from "@/utils/supabase/server"
import { requireRole } from "@/lib/authz"
import dynamic from "next/dynamic"
import { getAdvancedKpi, getGdoCallAttemptMetrics, getGdoTargetsProgress } from "@/app/actions/kpiAdvancedActions"
import { isDirettaOn } from "@/lib/diretta/settings"
import { numeriPeriodo, periodoRisultati, righeAndamento } from "@/lib/diretta/risultati"
import { MieiRisultati } from "@/components/diretta/MieiRisultati"
import { VesteAllineata } from "@/components/diretta/VesteAllineata"

const KpiGdoBoard = dynamic(() => import("@/components/KpiGdoBoard").then(mod => mod.KpiGdoBoard), { loading: () => <div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" /></div> })

export default async function KpiGdoPage({ searchParams }: { searchParams: Promise<{ periodo?: string; turno?: string }> }) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // GDO incluso: questa route è anche "Le mie Performance" della sidebar GDO
    // (il board forza il filtro al proprio id per i GDO operativi).
    await requireRole(session, ['ADMIN', 'MANAGER', 'TL', 'GDO'])

    // Diretta accesa per il GDO (collaudo del 25/10/2026): "I miei risultati"
    // scuri, letti tutti insieme sul server (prima la pagina aspettava il
    // JavaScript, poi l'utente, poi una richiesta dopo l'altra). Stessi numeri
    // di sempre. Admin, manager e TL restano sulla pagina di sempre.
    if (session?.user.role === 'GDO' && await isDirettaOn('GDO')) {
        const sp = await searchParams
        const turno = sp.turno === '1'
        const periodo = periodoRisultati(sp.periodo, new Date())
        const io = session.user.id
        const [kpi, obiettivi, tentativi] = await Promise.all([
            getAdvancedKpi({
                startDate: periodo.start,
                endDate: periodo.end,
                gdoId: io,
                workingHoursOnly: turno,
                trendGranularity: periodo.granularita,
            }).catch((e: unknown) => { console.error('[kpi-gdo Diretta] getAdvancedKpi', e); return null }),
            getGdoTargetsProgress(io).catch((e: unknown) => { console.error('[kpi-gdo Diretta] getGdoTargetsProgress', e); return null }),
            getGdoCallAttemptMetrics({ startDate: periodo.start, endDate: periodo.end, gdoId: io })
                .catch((e: unknown) => { console.error('[kpi-gdo Diretta] getGdoCallAttemptMetrics', e); return null }),
        ])
        return (
            <>
                <VesteAllineata diretta />
                <MieiRisultati
                    periodo={periodo}
                    turno={turno}
                    numeri={kpi ? numeriPeriodo(kpi.gdoStats) : null}
                    andamento={kpi ? righeAndamento(kpi.chartData, periodo.granularita) : null}
                    obiettivi={obiettivi}
                    tentativi={tentativi}
                />
            </>
        )
    }

    return (
        <div className="space-y-6">
            {session?.user.role === 'GDO' && <VesteAllineata diretta={false} />}
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                {/* Per il GDO è "I miei risultati", come nel menu (collaudo del 25/10/2026). */}
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                    {session?.user.role === 'GDO' ? 'I miei risultati' : 'KPI GDO'}
                </h1>
            </div>

            <KpiGdoBoard />

        </div>
    )
}
