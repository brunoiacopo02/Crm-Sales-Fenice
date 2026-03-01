import { db } from "../src/db"
import { leads, users } from "../src/db/schema"
import crypto from "crypto"
import { eq } from "drizzle-orm"

async function seedDaConfermare() {
    const testGdo = (await db.select().from(users).where(eq(users.role, "GDO")))[0]

    console.log("Creating 3 test leads for CONFERME...")

    for (let i = 1; i <= 3; i++) {
        const leadId = crypto.randomUUID()

        // Crea appuntamenti "Da Lavorare" (confirmationsOutcome = null)
        await db.insert(leads).values({
            id: leadId,
            name: `Lead Da Confermare ${i}`,
            email: `da.confermare${i}@example.com`,
            phone: `+39399${Math.floor(Math.random() * 1000000)}`,
            status: "APPOINTMENT",
            assignedToId: testGdo ? testGdo.id : null,
            appointmentDate: new Date(Date.now() + (24 * 3600000 * (i + 5))), // Date future
            appointmentNote: "Test per il team CONFERME: assegnare a sales001 per testare Google Calendar",
            createdAt: new Date(),
            updatedAt: new Date(),
        })

        console.log(`Created lead: Lead Da Confermare ${i}`)
    }

    console.log("Done!")
    process.exit(0)
}

seedDaConfermare().catch(console.error)
