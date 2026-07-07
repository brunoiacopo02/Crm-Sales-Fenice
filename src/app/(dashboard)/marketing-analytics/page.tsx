import { createClient } from "@/utils/supabase/server"
import { requireRole } from "@/lib/authz"
import { getMarketingStats, getMarketingStatsByGdo } from "@/app/actions/marketingActions";
import MarketingAnalyticsClient from "./MarketingAnalyticsClient";

export default async function MarketingAnalyticsPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    // Eccezione: l'account marketing dedicato accede senza avere uno dei ruoli standard
    if (session?.user?.email !== 'marketing@fenice.local') {
        await requireRole(session, ['ADMIN', 'MANAGER'])
    }

    // Compute current month in Europe/Rome timezone (Vercel runs UTC — around midnight IT this matters)
    const romeToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }); // "YYYY-MM-DD"
    const currentMonthStr = romeToday.substring(0, 7); // "YYYY-MM"

    const initialStats = await getMarketingStats(currentMonthStr);
    const initialStatsByGdo = await getMarketingStatsByGdo(currentMonthStr);

    return (
        <div className="flex flex-col min-h-screen md:h-screen md:overflow-hidden bg-gray-50/50">
            <MarketingAnalyticsClient
                initialStats={initialStats}
                initialStatsByGdo={initialStatsByGdo}
                initialMonth={currentMonthStr}
            />
        </div>
    );
}
