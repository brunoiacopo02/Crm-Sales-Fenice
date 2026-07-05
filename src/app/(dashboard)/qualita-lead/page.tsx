import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getAvailableFunnels, getGdoAggregate, getConfermeAggregate, getSalesAggregate } from "./actions";
import { listSuspiciousSurveys } from "@/app/actions/surveyActions";
import { isConfermeTl } from "@/lib/confermeTl";
import { toRomeDateStr } from "@/lib/dateUtils";
import QualitaLeadClient from "./QualitaLeadClient";

export default async function QualitaLeadPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = (user?.user_metadata?.role as string) || "";
    // MANAGER/ADMIN hanno accesso pieno. Il TL del team Conferme (Alberto, gating
    // per email) può consultare l'intera dashboard ma NON invalidare i sondaggi.
    const isManager = ["MANAGER", "ADMIN"].includes(role);
    const isTlConfermeViewer = role === "CONFERME" && isConfermeTl(user?.email);
    if (!user || (!isManager && !isTlConfermeViewer)) {
        redirect("/");
    }

    // Default: last 30 days (confini Europe/Rome, non UTC), no funnel filter, role = all
    const today = new Date();
    const start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const defaultFilters = {
        roleScope: "all" as const,
        funnels: [] as string[],
        startDate: toRomeDateStr(start),
        endDate: toRomeDateStr(today),
        onlyClosedWon: false,
    };

    const [funnels, gdoAgg, confAgg, salesAgg, closedWonAgg, suspicious] = await Promise.all([
        getAvailableFunnels(),
        getGdoAggregate(defaultFilters),
        getConfermeAggregate(defaultFilters),
        getSalesAggregate(defaultFilters),
        getGdoAggregate({ ...defaultFilters, onlyClosedWon: true }),
        listSuspiciousSurveys(),
    ]);

    return (
        <div className="min-h-screen bg-ash-50/50 p-4 sm:p-6 lg:p-8">
            <QualitaLeadClient
                funnels={funnels}
                initialFilters={defaultFilters}
                initialGdo={gdoAgg}
                initialConferme={confAgg}
                initialSales={salesAgg}
                initialClosedWonGdo={closedWonAgg}
                initialSuspicious={suspicious}
                canInvalidate={isManager}
            />
        </div>
    );
}
