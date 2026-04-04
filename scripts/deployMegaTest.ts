import "dotenv/config"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

async function run() {
    console.log("Inizia il Deployment dei Lead GDO 114 e Conferme...");
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    
    // Trova GDO 114
    const { data: users, error: uErr } = await supabase.from('users').select('id, name').eq('gdoCode', 114).limit(1);
    if (!users || users.length === 0) {
        console.error("GDO 114 Non Trovato!");
        process.exit(1);
    }
    const gdo = users[0];
    console.log(`Trovato GDO: ${gdo.name} (${gdo.id})`);

    const now = new Date();
    
    const today15 = new Date(); today15.setHours(15, 0, 0, 0);
    const today17 = new Date(); today17.setHours(17, 0, 0, 0);
    // Un richiamo appena sfasato così è subito testabile!
    const inUnMinuto = new Date(); inUnMinuto.setMinutes(inUnMinuto.getMinutes() + 1);
    
    const recordsToInsert: any[] = [];
    
    for (let i = 1; i <= 5; i++) {
        recordsToInsert.push({
            id: crypto.randomUUID(), name: `Test Generico ${i}`, phone: `+39399GEN000${i}${Date.now()}`.slice(0,14),
            funnel: 'Facebook Ads', status: 'NEW', assignedToId: gdo.id, createdAt: now, updatedAt: now, callCount: 0,
            confNeedsReschedule: false
        });
    }
    
    const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 30);
    for (let i = 1; i <= 5; i++) {
        recordsToInsert.push({
            id: crypto.randomUUID(), name: `Test Database ${i}`, phone: `+39399DB0000${i}${Date.now()}`.slice(0,14),
            funnel: 'Database', status: 'NEW', assignedToId: gdo.id, createdAt: oldDate, updatedAt: oldDate, callCount: 0,
            confNeedsReschedule: false
        });
    }
    
    recordsToInsert.push({
        id: crypto.randomUUID(), name: "[CONF TEST] Da Chiamare Oggi H15", phone: "+39300000015",
        assignedToId: gdo.id, status: "APPOINTMENT", appointmentDate: today15, appointmentCreatedAt: now,
        callCount: 1, createdAt: now, updatedAt: now, confNeedsReschedule: false
    });
    recordsToInsert.push({
        id: crypto.randomUUID(), name: "[CONF TEST] Da Chiamare Oggi H17", phone: "+39300000017",
        assignedToId: gdo.id, status: "APPOINTMENT", appointmentDate: today17, appointmentCreatedAt: now,
        callCount: 1, createdAt: now, updatedAt: now, confNeedsReschedule: false
    });
    recordsToInsert.push({
        id: crypto.randomUUID(), name: "[CONF TEST] Parcheggiato (Richiamo)", phone: "+39300000088",
        assignedToId: gdo.id, status: "APPOINTMENT", appointmentDate: null, recallDate: inUnMinuto, appointmentCreatedAt: now, confSnoozeAt: inUnMinuto,
        callCount: 1, createdAt: now, updatedAt: now, confNeedsReschedule: true
    });
    
    const { error: insErr } = await supabase.from('leads').insert(recordsToInsert);
    if (insErr) { console.error("Inserimento fallito:", insErr); process.exit(1); }
    
    console.log("[OK] Completato con successo inserimento 13 lead.");
    process.exit(0);
}
run();
