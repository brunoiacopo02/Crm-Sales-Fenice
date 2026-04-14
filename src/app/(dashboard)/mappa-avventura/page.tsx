import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getAdventureProgress, getAllBosses } from "@/app/actions/adventureActions"
import { getTeamAdventureProgress } from "@/app/actions/teamAdventureActions"
import dynamic from "next/dynamic"

const MappaAvventuraClient = dynamic(() => import("./MappaAvventuraClient"), { loading: () => <div className="animate-pulse space-y-4"><div className="h-10 bg-ash-200 rounded-lg w-1/3" /><div className="h-96 bg-ash-100 rounded-xl" /></div> })

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

    // Unified gamification: CONFERME now has individual adventure progress like GDO.
    const isTeam = false;

    const [progress, bosses] = await Promise.all([
        getAdventureProgress(supabaseUser.id),
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
