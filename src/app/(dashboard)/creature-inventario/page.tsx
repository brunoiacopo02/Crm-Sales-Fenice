import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { getUserCreatures, getAllCreatureDefinitions } from "@/app/actions/creatureActions"
import { getTeamCreatures } from "@/app/actions/teamAdventureActions"
import InventarioCreatureClient from "./InventarioCreatureClient"

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
