import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { listGdosForAcIntake, listAcWebhooks, listAcFailures } from "@/app/actions/acIntakeActions";
import LeadAutomaticiClient from "./LeadAutomaticiClient";

export default async function LeadAutomaticiPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = (user?.user_metadata?.role as string) || "";
    if (!user || !["MANAGER", "ADMIN"].includes(role)) {
        redirect("/");
    }

    const [rows, webhooksRes, failures] = await Promise.all([
        listGdosForAcIntake(),
        listAcWebhooks(),
        listAcFailures(true),
    ]);

    return (
        <div className="min-h-screen bg-ash-50/50 p-4 sm:p-6 lg:p-8">
            <LeadAutomaticiClient
                initialRows={rows}
                initialWebhooks={webhooksRes.webhooks || []}
                initialFailures={failures}
            />
        </div>
    );
}
