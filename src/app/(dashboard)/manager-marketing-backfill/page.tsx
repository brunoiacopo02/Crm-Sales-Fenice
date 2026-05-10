import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import BackfillClient from './BackfillClient';

export default async function ManagerMarketingBackfillPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = user?.user_metadata?.role;
    if (!user || (role !== 'MANAGER' && role !== 'ADMIN')) {
        redirect('/unauthorized');
    }
    return <BackfillClient />;
}
