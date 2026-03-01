import { db } from "../src/db"
import { leads, users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"
import { addDays, subDays } from "date-fns"

async function runSeedAppointments() {
    console.log("Seeding test appointments...")

    try {
        // Find a GDO to assign leads to 
        let gdoUser = (await db.select().from(users).where(eq(users.role, 'GDO')).limit(1))[0]

        if (!gdoUser) {
            console.log("No GDO user found for assignment. Please create a GDO first.")
            return
        }

        const now = new Date()

        const testAppointments = [
            {
                id: crypto.randomUUID(),
                name: "Mario Rossi (Test Conferme)",
                email: "mario.rossi@test.com",
                phone: "+393330000001",
                status: "APPOINTMENT",
                assignedToId: gdoUser.id,
                appointmentDate: addDays(new Date(now.setHours(10, 30, 0, 0)), 1), // Tomorrow morning
                appointmentNote: "GDO Note: Cliente molto interessato al pacchetto completo.",
                appointmentCreatedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                version: 1,
            },
            {
                id: crypto.randomUUID(),
                name: "Giulia Bianchi (Test Conferme)",
                email: "giulia.bianchi@test.com",
                phone: "+393330000002",
                status: "APPOINTMENT",
                assignedToId: gdoUser.id,
                appointmentDate: new Date(now.setHours(15, 0, 0, 0)), // Today afternoon
                appointmentNote: "GDO Note: Richiede info sui costi prima della call vera e propria.",
                appointmentCreatedAt: subDays(new Date(), 1), // Booked yesterday
                createdAt: subDays(new Date(), 1),
                updatedAt: subDays(new Date(), 1),
                version: 1,
            },
            {
                id: crypto.randomUUID(),
                name: "Luca Verdi (Test Conferme)",
                email: "luca.verdi@test.com",
                phone: "+393330000003",
                status: "APPOINTMENT",
                assignedToId: gdoUser.id,
                appointmentDate: new Date(now.setHours(11, 15, 0, 0)), // Today morning
                appointmentNote: "GDO Note: Appuntamento fissato rapidamente.",
                appointmentCreatedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                version: 1,
            },
            {
                // GIA SCARTATO
                id: crypto.randomUUID(),
                name: "Elena Neri (Scartato Test)",
                email: "elena.neri@test.com",
                phone: "+393330000004",
                status: "APPOINTMENT",
                assignedToId: gdoUser.id,
                appointmentDate: new Date(now.setHours(9, 0, 0, 0)),
                appointmentNote: "GDO Note: Da verificare.",
                appointmentCreatedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                version: 1,
                confirmationsOutcome: "scartato",
                confirmationsDiscardReason: "non interessato",
                confirmationsTimestamp: new Date(),
            },
            {
                // GIA CONFERMATO
                id: crypto.randomUUID(),
                name: "Paolo Gialli (Confermato Test)",
                email: "paolo.gialli@test.com",
                phone: "+393330000005",
                status: "APPOINTMENT",
                assignedToId: gdoUser.id,
                appointmentDate: addDays(new Date(now.setHours(16, 30, 0, 0)), 2),
                appointmentNote: "GDO Note: Ottimo cliente.",
                appointmentCreatedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                version: 1,
                confirmationsOutcome: "confermato",
                salespersonAssigned: "Marco",
                salespersonAssignedAt: new Date(),
                confirmationsTimestamp: new Date(),
            }
        ]

        for (const appt of testAppointments) {
            await db.insert(leads).values(appt as any)
            console.log(`- Inserted test appointment for: ${appt.name}`)
        }

        console.log("Successfully seeded test appointments!")

    } catch (e) {
        console.error("Error generating appointments:", e)
    }
}

runSeedAppointments()
