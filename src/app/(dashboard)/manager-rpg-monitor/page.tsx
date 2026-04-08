import { fetchAllTeamRpgProfiles, getTeamGamificationOverview } from '@/app/actions/managerRpgActions';
import { getActiveBossBattle } from '@/app/actions/bossBattleActions';
import { getActiveEvent } from '@/app/actions/seasonalEventActions';
import ManagerRpgClient from './ManagerRpgClient';
import { SafeWrapper } from '@/components/SafeWrapper';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"

export default async function ManagerRpgPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || (role !== 'MANAGER' && role !== 'ADMIN')) {
        redirect('/unauthorized');
    }

    const [profiles, teamOverview, activeBoss, activeEvent] = await Promise.all([
        fetchAllTeamRpgProfiles(),
        getTeamGamificationOverview(),
        getActiveBossBattle(),
        getActiveEvent(),
    ]);

    return (
        <SafeWrapper>
            <ManagerRpgClient
                initialProfiles={profiles}
                teamOverview={teamOverview}
                managerId={supabaseUser.id}
                activeBoss={activeBoss}
                activeEvent={activeEvent}
            />
        </SafeWrapper>
    );
}
