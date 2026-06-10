import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { getLeadOverview, getFunnelOverview, getMetricsOverview } from "@/app/actions/panoramicaActions";
import { tryCurrentTenant } from "@/lib/tenancy";
import { PanoramicaClient } from "./PanoramicaClient";

export default async function PanoramicaGeneralePage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    const role = user.user_metadata?.role;
    if (role !== 'ADMIN') {
        redirect('/');
    }

    const tctx = await tryCurrentTenant();
    const isAllCompanies = !!tctx?.isAllCompanies;

    const [overview, funnelOverview, metricsOverview] = await Promise.all([
        getLeadOverview(),
        getFunnelOverview(),
        getMetricsOverview(),
    ]);

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                        {isAllCompanies ? 'Sales Manager — Tutte le aziende' : 'Sales Manager'}
                    </h1>
                    <p className="text-sm text-ash-500 mt-0.5">
                        {isAllCompanies
                            ? 'KPI aggregati di tutte le aziende del gruppo (mese in corso).'
                            : 'Previsioni lead e numeri mensili del mese in corso.'}
                    </p>
                </div>
            </div>

            <PanoramicaClient
                initialData={overview}
                initialFunnelData={funnelOverview}
                initialMetricsData={metricsOverview}
                readOnly={isAllCompanies}
            />
        </div>
    );
}
