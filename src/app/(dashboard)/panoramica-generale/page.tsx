import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { getLeadOverview, getFunnelOverview, getMetricsOverview } from "@/app/actions/panoramicaActions";
import { tryCurrentTenant } from "@/lib/tenancy";
import { SalesAlertStrip } from "./SalesAlertStrip";
import { ManagerParamsStrip } from "./ManagerParamsStrip";
import { isConfermeTl } from "@/lib/confermeTl";
import { SalesManagerView } from "./SalesManagerView";
import { currentYearMonthRome } from "@/lib/workingDaysUtils";

export default async function PanoramicaGeneralePage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    const role = user.user_metadata?.role;
    // Il TL del team Conferme (Alberto, gating per email) può vedere la dashboard
    // Sales Manager in SOLA LETTURA. Il TL GDO (role TL) ha invece accesso PIENO
    // (decisione PO 2026-07-05). Tutti gli altri ruoli restano esclusi.
    const isTlConfermeViewer = role === 'CONFERME' && isConfermeTl(user.email);
    if (role !== 'ADMIN' && role !== 'TL' && !isTlConfermeViewer) {
        redirect('/');
    }

    const tctx = await tryCurrentTenant();
    const isAllCompanies = !!tctx?.isAllCompanies;
    // Sola lettura per il TL Conferme: vede KPI/alert ma non modifica i target
    // né i parametri manager (la strip parametri viene nascosta).
    const readOnly = isAllCompanies || isTlConfermeViewer;
    // Controlli di modifica target/funnel/metriche: SOLO admin su una singola
    // azienda (decisione PO 2026-07-06). Il TL GDO vede la dashboard piena
    // (readOnly=false) ma le mutation restano ADMIN-only lato server, quindi
    // i bottoni di modifica devono restare nascosti anche per lui.
    const canEditTargets = role === 'ADMIN' && !isAllCompanies;

    const [overview, funnelOverview, metricsOverview] = await Promise.all([
        getLeadOverview(),
        getFunnelOverview(),
        getMetricsOverview(),
    ]);

    const currentYearMonth = currentYearMonthRome();

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

            <SalesManagerView
                initialData={overview}
                initialFunnelData={funnelOverview}
                initialMetricsData={metricsOverview}
                readOnly={readOnly}
                readOnlyVariant={isAllCompanies ? 'all-companies' : 'viewer'}
                canEditTargets={canEditTargets}
                currentYearMonth={currentYearMonth}
                strips={
                    <>
                        <SalesAlertStrip />
                        {!isAllCompanies && !isTlConfermeViewer && <ManagerParamsStrip />}
                    </>
                }
            />
        </div>
    );
}
