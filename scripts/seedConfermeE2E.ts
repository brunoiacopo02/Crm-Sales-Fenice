import { db } from "../src/db";
import { leads, users } from "../src/db/schema";
import { eq, like } from "drizzle-orm";
import crypto from "crypto";
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
    console.log("🌱 Inizio iniezione Seed E2E per Conferme...");

    // Find an active GDO user and Conferme user for assignment
    const gdoUsers = await db.select().from(users).where(eq(users.role, "GDO")).limit(1);
    const confermeUsers = await db.select().from(users).where(eq(users.role, "CONFERME")).limit(1);

    if (gdoUsers.length === 0) {
        console.error("❌ Nessun utente GDO trovato. Crea prima un GDO.");
        return;
    }

    const gdoId = gdoUsers[0].id;
    const confermeId = confermeUsers.length > 0 ? confermeUsers[0].id : null;

    // Pulizia vecchi TEST
    console.log("🧹 Pulizia vecchi TEST_E2E in corso...");
    await db.delete(leads).where(like(leads.name, '[TEST_E2E]%'));

    const todayLocal = new Date();

    // Funzione helper per creare date corrette nel fuso locale
    const createDate = (dayOffset: number, hours: number) => {
        const d = new Date(todayLocal);
        d.setDate(d.getDate() + dayOffset);
        d.setHours(hours, 0, 0, 0);
        return d;
    };

    const mockLeads = [
        // Scenario 1: "App Pomeriggio"
        {
            name: "[TEST_E2E] Mario Rossi (Oggi 15)",
            email: "test.e2e.1@example.com",
            phone: "+393999990001",
            status: "APPOINTMENT",
            assignedToId: gdoId,
            appointmentDate: createDate(0, 15),
            appointmentCreatedAt: new Date(),
        },
        {
            name: "[TEST_E2E] Luigi Verdi (Oggi 16)",
            email: "test.e2e.2@example.com",
            phone: "+393999990002",
            status: "APPOINTMENT",
            assignedToId: gdoId,
            appointmentDate: createDate(0, 16),
            appointmentCreatedAt: new Date(),
        },
        {
            name: "[TEST_E2E] Giulia Bianchi (Oggi 20)",
            email: "test.e2e.3@example.com",
            phone: "+393999990003",
            status: "APPOINTMENT",
            assignedToId: gdoId,
            appointmentDate: createDate(0, 20),
            appointmentCreatedAt: new Date(),
        },

        // Scenario 2: "App Mattina" (Domani)
        {
            name: "[TEST_E2E] Anna Neri (Domani 09)",
            email: "test.e2e.4@example.com",
            phone: "+393999990004",
            status: "APPOINTMENT",
            assignedToId: gdoId,
            appointmentDate: createDate(1, 9),
            appointmentCreatedAt: new Date(),
        },
        {
            name: "[TEST_E2E] Paolo Gialli (Domani 11)",
            email: "test.e2e.5@example.com",
            phone: "+393999990005",
            status: "APPOINTMENT",
            assignedToId: gdoId,
            appointmentDate: createDate(1, 11),
            appointmentCreatedAt: new Date(),
        },

        // Scenario 3: Paradosso Sabato (Forziamo le date come se fossimo a Venerdì/Sabato)
        // Se oggi è venerdÃ¬, dayOffset = +1. Altrimenti forziamo al prossimo sabato.
        ...(() => {
            const nextSaturday = new Date(todayLocal);
            nextSaturday.setDate(todayLocal.getDate() + ((6 - todayLocal.getDay() + 7) % 7 || 7)); // Next Saturday

            const sat13 = new Date(nextSaturday);
            sat13.setHours(13, 0, 0, 0);

            const sat14 = new Date(nextSaturday);
            sat14.setHours(14, 0, 0, 0);

            // Creiamo un createdAt > 12h fa e uno "ora"
            const over12hAgo = new Date(todayLocal);
            over12hAgo.setHours(over12hAgo.getHours() - 14);

            return [
                {
                    name: "[TEST_E2E] Sabato 13:00 (Fissato >12h fa)",
                    email: "test.e2e.6@example.com",
                    phone: "+393999990006",
                    status: "APPOINTMENT",
                    assignedToId: gdoId,
                    appointmentDate: sat13,
                    appointmentCreatedAt: over12hAgo,
                },
                {
                    name: "[TEST_E2E] Sabato 14:00 (Fissato ORA)",
                    email: "test.e2e.7@example.com",
                    phone: "+393999990007",
                    status: "APPOINTMENT",
                    assignedToId: gdoId,
                    appointmentDate: sat14,
                    appointmentCreatedAt: new Date(),
                }
            ];
        })(),

        // Scenario 4: Richiamo con 3 Tentativi Semafori
        {
            name: "[TEST_E2E] Chiamato 3 Volte (Oggi 18:00)",
            email: "test.e2e.8@example.com",
            phone: "+393999990008",
            status: "APPOINTMENT",
            assignedToId: gdoId,
            appointmentDate: createDate(0, 18),
            appointmentCreatedAt: new Date(),
            confCall1At: createDate(0, 10),
            confCall2At: createDate(0, 12),
            confCall3At: createDate(0, 14),
        },

        // Scenario 5: Da Definire
        {
            name: "[TEST_E2E] Da Riprogrammare",
            email: "test.e2e.9@example.com",
            phone: "+393999990009",
            status: "APPOINTMENT",
            assignedToId: gdoId,
            appointmentDate: null,
            appointmentCreatedAt: new Date(),
            confNeedsReschedule: true,
        }
    ];

    console.log("Inserimento in corso...");

    for (const leadData of mockLeads) {
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            ...leadData,
            createdAt: new Date(),
            updatedAt: new Date(),
        } as any);
    }

    console.log("✅ Seed E2E per Conferme completato con successo!");
    process.exit(0);
}

main().catch((e) => {
    console.error("❌ Errore durante il seed:", e);
    process.exit(1);
});
