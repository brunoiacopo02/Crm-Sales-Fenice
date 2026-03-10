import { getManagerTargetsData } from '@/app/actions/targetActions';
import ManagerTargetsClient from './ManagerTargetsClient';
import { redirect } from 'next/navigation';
import { getServerSession } from "next-auth";
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export default async function ManagerTargetsPage({
    searchParams
}: {
    searchParams: { month?: string }
}) {
    const session = await getServerSession(authOptions);

    // Sicurezza: Limita a MANAGER o ADMIN
    if (!session || (session.user.role !== 'MANAGER' && session.user.role !== 'ADMIN')) {
        redirect('/unauthorized');
    }

    // Default al mese corrente 'YYYY-MM'
    const currentMonthStr = new Date().toISOString().slice(0, 7);
    const selectedMonth = searchParams.month || currentMonthStr;

    // Fetch in server component per la math geniale
    const data = await getManagerTargetsData(selectedMonth);

    return (
        <ManagerTargetsClient
            initialData={data}
            selectedMonth={selectedMonth}
            role={session.user.role}
        />
    );
}
