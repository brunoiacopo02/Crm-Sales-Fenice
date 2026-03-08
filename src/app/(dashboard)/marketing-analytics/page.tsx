import { getMarketingStats, getMarketingStatsByGdo } from "@/app/actions/marketingActions";
import MarketingAnalyticsClient from "./MarketingAnalyticsClient";

export default async function MarketingAnalyticsPage() {
    // By default, grab current month "YYYY-MM"
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const initialStats = await getMarketingStats(currentMonthStr);
    const initialStatsByGdo = await getMarketingStatsByGdo(currentMonthStr);

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-gray-50/50">
            <MarketingAnalyticsClient
                initialStats={initialStats}
                initialStatsByGdo={initialStatsByGdo}
                initialMonth={currentMonthStr}
            />
        </div>
    );
}
