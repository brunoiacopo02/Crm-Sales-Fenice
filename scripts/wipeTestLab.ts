import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

async function wipeTestLab() {
    try {
        console.log("Inizia l'annientamento dei Test Leads storici via REST API...");
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        
        // Unfortunately standard REST API 'ilike' can only accept one at a time, or we can use `or` with `ilike`.
        const { data, error } = await supabase
            .from('leads')
            .delete()
            .or('name.ilike.%Test%,name.ilike.%Da Chiamare%,name.ilike.%DB%,name.ilike.%Generico%,name.ilike.%Parcheggiato%');
            
        if (error) throw error;

        console.log(`[BOMBA SGANCIATA] Eliminati con successo i vecchi test leads.`);
    } catch (e) {
        console.error('ERRORE CRITICO:', e);
    }
    process.exit(0);
}
wipeTestLab();
