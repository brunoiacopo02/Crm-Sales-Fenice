import { getManagerGdoTables, getAllGdoScriptRates } from '@/app/actions/gdoPerformanceActions';
import ManagerGdoClient from './ManagerGdoClient';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"
import { toRomeDateStr } from '@/lib/dateUtils';

export default async function ManagerGdoPerformancePage({
    searchParams
}: {
    searchParams: Promise<{ month?: string }>
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || !['MANAGER', 'ADMIN', 'TL'].includes(role)) {
        redirect('/unauthorized');
    }

    const sp = await searchParams;
    // Mese Europe/Rome: toISOString() (UTC) fra 00:00 e 02:00 del 1° darebbe il mese prima.
    const currentMonthStr = toRomeDateStr(new Date()).slice(0, 7);
    const selectedMonth = sp.month || currentMonthStr;

    const [data, scriptRates] = await Promise.all([
        getManagerGdoTables(selectedMonth),
        getAllGdoScriptRates().catch(() => ({})),
    ]);

    return (
        <ManagerGdoClient
            initialData={data}
            selectedMonth={selectedMonth}
            role={role}
            scriptRates={scriptRates}
        />
    );
}
