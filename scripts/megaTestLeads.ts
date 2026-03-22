import { db } from "../src/db"
import { leads, users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

async function runSeed() {
    console.log("Creazione Lead per Mega Test Olistico...")

    try {
        // Prendi il primo GDO disponibile
        const gdoList = await db.select().from(users).where(eq(users.role, "GDO"));
        const gdo = gdoList[0];
        if (!gdo) throw new Error("Nessun GDO trovato nel DB");

        const now = new Date();

        // Lead 1: GDO Pipeline (In Progress, 0 calls)
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: "[TEST] Nuovo GDO",
            phone: "+393330001234",
            email: "test.nuovo@esempio.com",
            gdoId: gdo.id,
            status: "IN_PROGRESS",
            callCount: 0,
            createdAt: now,
            updatedAt: now,
        });

        // Lead 2: GDO Pipeline (In Progress, 1 call)
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: "[TEST] Richiamo GDO",
            phone: "+393330005555",
            email: "test.richiamo@esempio.com",
            gdoId: gdo.id,
            status: "IN_PROGRESS",
            callCount: 1,
            lastCallDate: new Date(now.getTime() - 1000 * 60 * 60 * 2), // 2 hours ago
            recallDate: new Date(now.getTime() + 1000 * 60 * 60 * 24), // tomorrow
            recallNotes: "Richiamo di test da GDO",
            createdAt: now,
            updatedAt: now,
        });

        // Lead 3: Appuntamento (Senza Esito Conferme o Venditore)
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: "[TEST] App Fissato (Puro)",
            phone: "+393330007777",
            email: "test.app@esempio.com",
            gdoId: gdo.id,
            status: "APPOINTMENT",
            callCount: 2,
            appointmentDate: new Date(now.getTime() + 1000 * 60 * 60 * 24), // tomorrow
            appointmentCreatedAt: now,
            appointmentNote: "Testato per appuntamento GDO puro",
            createdAt: now,
            updatedAt: now,
        });

        // Lead 4: Appuntamento (Confermato e Chiuso)
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: "[TEST] App Confermato (Chiuso)",
            phone: "+393330008888",
            email: "test.closed@esempio.com",
            gdoId: gdo.id,
            status: "APPOINTMENT",
            callCount: 1,
            appointmentDate: new Date(now.getTime() - 1000 * 60 * 60 * 24), // yesterday
            appointmentCreatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 48),
            confirmationsOutcome: "confermato",
            salespersonAssigned: "Venditore Uno",
            salespersonOutcome: "Chiuso",
            salespersonOutcomeNotes: "Vendita conclusa con successo!",
            createdAt: now,
            updatedAt: now,
        });

        // Lead 5: Appuntamento (Scartato Conferme)
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: "[TEST] App Scartato (Conferme)",
            phone: "+393330009999",
            gdoId: gdo.id,
            status: "APPOINTMENT",
            callCount: 1,
            appointmentDate: new Date(now.getTime() - 1000 * 60 * 60 * 2),
            appointmentCreatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24),
            confirmationsOutcome: "scartato",
            confirmationsDiscardReason: "disoccupato",
            createdAt: now,
            updatedAt: now,
        });

        // Lead 6: Solo per Conferme (Snooze Overdue)
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: "[TEST] Conferme Snooze SCADUTO",
            phone: "+393331112222",
            gdoId: gdo.id,
            status: "APPOINTMENT",
            appointmentDate: new Date(now.getTime() + 1000 * 60 * 60 * 48), // in 2 days
            appointmentCreatedAt: now,
            confSnoozeAt: new Date(now.getTime() - 1000 * 60 * 30), // 30 minutes ago
            createdAt: now,
            updatedAt: now,
        });

        // Lead 7: Solo per Conferme (Richiamo cassetto originario)
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: "[TEST] Conferme Richiamo Cassetto",
            phone: "+393332223333",
            gdoId: gdo.id,
            status: "APPOINTMENT",
            appointmentDate: new Date(now.getTime() + 1000 * 60 * 60 * 72), // in 3 days
            appointmentCreatedAt: now,
            confNeedsReschedule: true,
            recallDate: new Date(now.getTime() + 1000 * 60 * 60 * 24),
            createdAt: now,
            updatedAt: now,
        });

        console.log("✅ 7 Leads di Test Inseriti Correttamente!");
    } catch (e) {
        console.error("Errore durante la creazione:", e)
    }
}

runSeed()
