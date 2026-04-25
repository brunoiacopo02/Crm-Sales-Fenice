import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { getLeadOverview, getFunnelOverview, getMetricsOverview } from "@/app/actions/panoramicaActions";
import { PanoramicaClient } from "./PanoramicaClient";
import { SalesManagerSections } from "./SalesManagerSections";

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
                        Sales Manager
                    </h1>
                    <p className="text-sm text-ash-500 mt-0.5">
                        Panoramica completa: caricamento lead, funnel, performance venditori, ROAS, pipeline.
                    </p>
                </div>
            </div>

            <PanoramicaClient
                initialData={overview}
                initialFunnelData={funnelOverview}
                initialMetricsData={metricsOverview}
            />

            <SalesManagerSections />
        </div>
    );
}
