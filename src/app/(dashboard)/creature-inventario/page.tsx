import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getUserCreatures, getAllCreatureDefinitions } from "@/app/actions/creatureActions"
import { getTeamCreatures } from "@/app/actions/teamAdventureActions"
import dynamic from "next/dynamic"

const InventarioCreatureClient = dynamic(() => import("./InventarioCreatureClient"), { loading: () => <div className="animate-pulse space-y-4"><div className="h-10 bg-ash-200 rounded-lg w-1/3" /><div className="grid grid-cols-4 gap-4">{[...Array(8)].map((_, i) => <div key={i} className="h-40 bg-ash-100 rounded-xl" />)}</div></div> })

export default async function CreatureInventarioPage() {
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

    const [allCreatures, ownedCreatures] = await Promise.all([
        getAllCreatureDefinitions(),
        isTeam ? getTeamCreatures() : getUserCreatures(supabaseUser.id),
    ]);

    return (
        <InventarioCreatureClient
            allCreatures={allCreatures}
            ownedCreatures={ownedCreatures}
            isTeam={isTeam}
            userId={supabaseUser.id}
        />
    );
}
