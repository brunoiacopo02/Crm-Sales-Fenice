import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getAdventureProgress, getAllBosses } from "@/app/actions/adventureActions"
import { getTeamAdventureProgress } from "@/app/actions/teamAdventureActions"
import MappaAvventuraClient from "./MappaAvventuraClient"

export default async function MappaAvventuraPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    if (!supabaseUser) {
        redirect('/login');
    }

    const role = supabaseUser.user_metadata?.role;

    // Only GDO and CONFERME have access
    if (role !== 'GDO' && role !== 'CONFERME') {
        redirect('/');
    }

    const isTeam = role === 'CONFERME';

    const [progress, bosses] = await Promise.all([
        isTeam ? getTeamAdventureProgress() : getAdventureProgress(supabaseUser.id),
        getAllBosses(),
    ]);

    return (
        <MappaAvventuraClient
            progress={progress}
            bosses={bosses}
            isTeam={isTeam}
            userId={supabaseUser.id}
        />
    );
}
