import { getGdoRpgProfile } from '@/app/actions/rpgProfileActions';
import { getUserAchievements } from '@/app/actions/achievementActions';
import { getUnlockedTitles } from '@/app/actions/titleActions';
import ProfileClient from './ProfileClient';
import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"

export default async function ProfiloPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    if (!supabaseUser) {
        redirect('/login');
    }

    try {
        const [profileData, achievementData, titleData] = await Promise.all([
            getGdoRpgProfile(supabaseUser.id),
            getUserAchievements(supabaseUser.id),
            getUnlockedTitles(supabaseUser.id),
        ]);

        return (
            <ProfileClient
                profileData={profileData}
                achievements={achievementData.achievements}
                titleData={titleData}
            />
        );
    } catch (e) {
        console.error(e);
        return <div>Errore caricamento profilo.</div>;
    }
}
