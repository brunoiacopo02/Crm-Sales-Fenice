import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getConfermeAnalytics, listActiveConfermeUsers } from "@/app/actions/confermeAnalyticsActions"
import { AnalyticsFilters } from "@/components/conferme-analytics/AnalyticsFilters"
import { HeroSaturationCard } from "@/components/conferme-analytics/HeroSaturationCard"
import { LoadCard } from "@/components/conferme-analytics/LoadCard"
import { TimesCard } from "@/components/conferme-analytics/TimesCard"
import { ResponseDistributionCard } from "@/components/conferme-analytics/ResponseDistributionCard"
import { RecallLoadCard } from "@/components/conferme-analytics/RecallLoadCard"
import { HourlyBarChart } from "@/components/conferme-analytics/HourlyBarChart"

export const dynamic = 'force-dynamic';

const VALID_PERIODS = [7, 14, 30, 90] as const;
type Period = typeof VALID_PERIODS[number];

interface PageProps {
    searchParams: Promise<{ period?: string; user?: string; ops?: string }>;
}

const DEFAULT_OPS = 2;

export default async function ConfermeAnalyticsPage({ searchParams }: PageProps) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const role = supabaseUser?.user_metadata?.role as string | undefined;
    if (!supabaseUser || !role || !["CONFERME", "MANAGER", "ADMIN"].includes(role)) {
        redirect("/");
    }

    const sp = await searchParams;
    const periodNum = parseInt(sp.period ?? "30", 10);
    const period: Period = (VALID_PERIODS as readonly number[]).includes(periodNum) ? (periodNum as Period) : 30;
    const userParam = sp.user ?? "all";
    const opsNum = parseInt(sp.ops ?? String(DEFAULT_OPS), 10);
    const ops = (Number.isFinite(opsNum) && opsNum >= 1 && opsNum <= 4) ? opsNum : DEFAULT_OPS;

    const [data, operatori] = await Promise.all([
        getConfermeAnalytics({
            periodDays: period,
            userId: userParam === "all" ? null : userParam,
            nOperatoriOverride: ops,
        }),
        listActiveConfermeUsers(),
    ]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">Analytics Conferme</h1>
                    <p className="text-sm text-ash-500 mt-1">
                        Carico, tempi e staffing del team Conferme — media giornaliera su {data.meta.daysWorked} giorni lavorativi
                    </p>
                </div>
                <AnalyticsFilters
                    operatori={operatori}
                    currentPeriod={period}
                    currentUser={userParam}
                    currentOps={ops}
                />
            </div>

            <HeroSaturationCard data={data} />

            <div className="grid md:grid-cols-2 gap-4">
                <LoadCard data={data} />
                <TimesCard data={data} />
            </div>

            <ResponseDistributionCard data={data} />

            <RecallLoadCard data={data} />

            <HourlyBarChart data={data} />
        </div>
    );
}
