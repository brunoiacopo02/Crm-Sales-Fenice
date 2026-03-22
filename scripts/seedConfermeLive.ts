import "dotenv/config";
import { db } from "../src/db";
import { leads, users } from "../src/db/schema";
import crypto from "crypto";

async function main() {
    console.log("Seeding Conferme test leads per Domenica -> visualizzazione Lunedì Mattina...");

    const allGdo = await db.select().from(users).limit(1);
    const gdo = allGdo[0];
    if (!gdo) {
        console.error("Nessun utente trovato!");
        return;
    }

    console.log("Cancello vecchi lead test...");
    await db.execute(require("drizzle-orm").sql`DELETE FROM leads WHERE phone LIKE '+39300000000%'`);

    const now = new Date();
    // Monday at 10:00 (Tomorrow)
    const monday10 = new Date(now);
    monday10.setDate(monday10.getDate() + 1); // Tomorrow
    monday10.setHours(10, 0, 0, 0);
    
    // Monday at 12:00
    const monday12 = new Date(now);
    monday12.setDate(monday12.getDate() + 1); // Tomorrow
    monday12.setHours(12, 0, 0, 0);

    const testLeads = [
        {
            id: crypto.randomUUID(),
            name: "[CONF TEST] Da Chiamare Lunedì H10",
            phone: "+393000000001",
            assignedToId: gdo.id,
            status: "APPOINTMENT" as const,
            appointmentDate: monday10,
            appointmentCreatedAt: now,
            callCount: 1,
            confirmationsOutcome: null,
            createdAt: now,
            updatedAt: now,
            confNeedsReschedule: false,
        },
        {
            id: crypto.randomUUID(),
            name: "[CONF TEST] Da Chiamare Lunedì H12",
            phone: "+393000000002",
            assignedToId: gdo.id,
            status: "APPOINTMENT" as const,
            appointmentDate: monday12,
            appointmentCreatedAt: now,
            callCount: 1,
            confirmationsOutcome: null,
            createdAt: now,
            updatedAt: now,
            confNeedsReschedule: false,
        },
        {
            id: crypto.randomUUID(),
            name: "[CONF TEST] Parcheggiato (Richiamo)",
            phone: "+393000000003",
            assignedToId: gdo.id,
            status: "APPOINTMENT" as const,
            appointmentDate: null, // Parcheggiato
            recallDate: now,
            appointmentCreatedAt: now,
            callCount: 1,
            confirmationsOutcome: null,
            createdAt: now,
            updatedAt: now,
            confNeedsReschedule: true,
        }
    ];

    for (const lead of testLeads) {
        await db.insert(leads).values(lead);
        console.log(`Inserted: ${lead.name}`);
    }

    console.log("Fatto! I lead saranno visibili nella tab 'App Mattina' (Lunedì 10/12) e 'Richiami' della Dashboard Conferme.");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
}).then(() => process.exit(0));
