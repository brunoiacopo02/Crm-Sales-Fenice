import { getManagerGdoTables } from '@/app/actions/gdoPerformanceActions';
import ManagerGdoClient from './ManagerGdoClient';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"

export default async function ManagerGdoPerformancePage({
    searchParams
}: {
    searchParams: { month?: string }
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || (role !== 'MANAGER' && role !== 'ADMIN')) {
        redirect('/unauthorized');
    }

    const currentMonthStr = new Date().toISOString().slice(0, 7);
    const selectedMonth = searchParams.month || currentMonthStr;

    const data = await getManagerGdoTables(selectedMonth);

    return (
        <ManagerGdoClient
            initialData={data}
            selectedMonth={selectedMonth}
            role={role}
        />
    );
}
