import { fetchAllGdoRpgProfiles } from '@/app/actions/managerRpgActions';
import ManagerRpgClient from './ManagerRpgClient';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"

export default async function ManagerRpgPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || (role !== 'MANAGER' && role !== 'ADMIN')) {
        redirect('/unauthorized');
    }

    const profiles = await fetchAllGdoRpgProfiles();

    return (
        <ManagerRpgClient initialProfiles={profiles} />
    );
}
