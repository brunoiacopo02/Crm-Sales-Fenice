import { getManagerTargetsData } from '@/app/actions/targetActions';
import { getVenditoriWithTargets } from '@/app/actions/managerRpgActions';
import ManagerTargetsClient from './ManagerTargetsClient';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"
import { ManagerOperativaBoard } from "@/components/ManagerOperativaBoard"
import { ManualAdjustmentPanel } from "@/components/ManualAdjustmentPanel"

export default async function ManagerTargetsPage({
    searchParams
}: {
    searchParams: { month?: string }
}) {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    // Sicurezza: Limita a MANAGER o ADMIN
    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || (role !== 'MANAGER' && role !== 'ADMIN')) {
        redirect('/unauthorized');
    }

    // Default al mese corrente 'YYYY-MM'
    const currentMonthStr = new Date().toISOString().slice(0, 7);
    const selectedMonth = searchParams.month || currentMonthStr;

    // Fetch in server component per la math geniale
    const [data, venditori] = await Promise.all([
        getManagerTargetsData(selectedMonth),
        getVenditoriWithTargets(),
    ]);

    return (
        <div className="space-y-8">
            <ManagerTargetsClient
                initialData={data}
                selectedMonth={selectedMonth}
                role={role}
                venditori={venditori}
            />

            <div className="max-w-7xl mx-auto mb-8 px-4 sm:px-6 lg:px-8 space-y-6">
                <ManualAdjustmentPanel />
                <ManagerOperativaBoard />
            </div>
        </div>
    );
}
