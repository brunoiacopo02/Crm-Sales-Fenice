import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
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
