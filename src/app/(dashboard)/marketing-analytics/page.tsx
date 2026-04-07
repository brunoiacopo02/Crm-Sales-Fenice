import { getMarketingStats, getMarketingStatsByGdo } from "@/app/actions/marketingActions";
import MarketingAnalyticsClient from "./MarketingAnalyticsClient";

export default async function MarketingAnalyticsPage() {
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
