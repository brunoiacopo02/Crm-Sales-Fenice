import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { currentTenant } from "@/lib/tenancy";
import { getSalesPipelineOverview } from "@/app/actions/salesPipelineActions";
import { listVenditori } from "@/app/actions/salesWeeklyFocusActions";
import PipelineVenditoreClient from "./PipelineVenditoreClient";

export default async function PipelineVenditorePage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = (user?.user_metadata?.role as string) || "";
    if (!user || !["ADMIN", "MANAGER"].includes(role)) {
        redirect("/");
    }

    // "Tutte le aziende" non e' un'azienda: `currentTenant` lascia `companyId`
    // su una azienda vera e alza `isAllCompanies`, quindi la pagina mostrerebbe
    // i numeri di UNA azienda dichiarando "tutte". E qui non e' solo una
    // lettura sbagliata: la config della pipeline sta in `appSettings`, che
    // non ha companyId, e l'assegnazione dei ridati e' una SCRITTURA (che
    // infatti `assertSingleCompany` rifiuta). Meglio dirlo prima.
    const ctx = await currentTenant();
    if (ctx.isAllCompanies) {
        return (
            <div className="min-h-screen bg-ash-50/50 p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-4xl rounded-2xl border border-amber-200 bg-amber-50 p-6">
                    <h1 className="text-lg font-bold text-ash-900">Pipeline autonoma venditore</h1>
                    <p className="mt-2 text-sm text-ash-700">
                        Stai guardando <strong>Tutte le aziende</strong>. Questa pagina lavora su
                        una sola azienda alla volta: scegline una dal selettore in alto per vedere
                        la configurazione e assegnare i lead.
                    </p>
                </div>
            </div>
        );
    }

    const [overview, venditori] = await Promise.all([
        getSalesPipelineOverview(),
        listVenditori(),
    ]);

    return (
        <div className="min-h-screen bg-ash-50/50 p-4 sm:p-6 lg:p-8">
            <PipelineVenditoreClient
                initialOverview={overview}
                venditori={venditori}
            />
        </div>
    );
}
