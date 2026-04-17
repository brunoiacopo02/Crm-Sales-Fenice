import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getAvailableFunnels, getGdoAggregate, getConfermeAggregate, getSalesAggregate } from "./actions";
import { listSuspiciousSurveys } from "@/app/actions/surveyActions";
import QualitaLeadClient from "./QualitaLeadClient";

export default async function QualitaLeadPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = (user?.user_metadata?.role as string) || "";
    if (!user || !["MANAGER", "ADMIN"].includes(role)) {
        redirect("/");
    }

    // Default: last 30 days, no funnel filter, role = all
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    const defaultFilters = {
        roleScope: "all" as const,
        funnels: [] as string[],
        startDate: toISO(start),
        endDate: toISO(today),
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
            />
        </div>
    );
}
