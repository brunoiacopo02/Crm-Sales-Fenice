import { db } from "../src/db"
import { leads, users } from "../src/db/schema"
import crypto from "crypto"
import { eq } from "drizzle-orm"

async function seedDaConfermare() {
    const testGdo = (await db.select().from(users).where(eq(users.role, "GDO")))[0]

    console.log("Creating 2 test leads for CONFERME without Email...")

    for (let i = 1; i <= 2; i++) {
        const leadId = crypto.randomUUID()

        await db.insert(leads).values({
            id: leadId,
            name: `Test Email Obbligatoria ${i}`,
            email: null, // NO EMAIL TO TEST CONSTRAINT
            phone: `+39399${Math.floor(Math.random() * 1000000)}`,
            status: "APPOINTMENT",
            assignedToId: testGdo ? testGdo.id : null,
            appointmentDate: new Date(Date.now() + (24 * 3600000 * Math.floor(Math.random() * 10))), // Date future casuali
            appointmentNote: "Test per provare il blocco assegnazione senza email",
            createdAt: new Date(),
            updatedAt: new Date(),
        })

        console.log(`Created lead: Test Email Obbligatoria ${i}`)
    }

    console.log("Done!")
    process.exit(0)
}

seedDaConfermare().catch(console.error)
