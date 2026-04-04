import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

async function nuke114() {
    console.log("Nuking all leads for GDO 114...");
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    
    // Trova GDO 114
    const { data: users, error: uErr } = await supabase.from('users').select('id, name').eq('gdoCode', 114).limit(1);
    if (!users || users.length === 0) {
        console.error("GDO 114 Non Trovato!");
        process.exit(1);
    }
    const gdo = users[0];
    console.log(`Trovato GDO: ${gdo.name} (${gdo.id})`);

    // Fetch all leads by this user just to log what we are deleting
    const { data: leadsToDelete, error: errFetch } = await supabase.from('leads').select('id, name').eq('assignedToId', gdo.id);
    console.log(`Found ${leadsToDelete?.length || 0} leads assigned to GDO 114.`);
    
    if (leadsToDelete && leadsToDelete.length > 0) {
        console.log("Sample names:", leadsToDelete.map(l => l.name).slice(0, 5));
        
        // Nuke them
        const { error: insErr } = await supabase.from('leads').delete().eq('assignedToId', gdo.id);
        if (insErr) { console.error("Cancellazione fallita:", insErr); process.exit(1); }
        console.log("[OK] Eliminati TUTTI i lead assegnati a GDO 114");
    }

    process.exit(0);
}
nuke114();
