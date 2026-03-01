import { db } from "../src/db"
import { leads, users } from "../src/db/schema"
import crypto from "crypto"
import { eq } from "drizzle-orm"

async function insertTestLeads() {
    const testSales = (await db.select().from(users).where(eq(users.email, "sales001@fenice.com")))[0]

    if (!testSales) {
        console.error("Sales001 not found!")
        process.exit(1)
    }

    const testGdo = (await db.select().from(users).where(eq(users.role, "GDO")))[0]

    console.log("Creating 3 test leads assigned to sales001...")

    for (let i = 1; i <= 3; i++) {
        const leadId = crypto.randomUUID()

        // Crea appuntamenti confermati e assegnati
        await db.insert(leads).values({
            id: leadId,
            name: `Test Lead Calendario ${i}`,
            email: `test.calendar${i}@example.com`,
            phone: `+39399${Math.floor(Math.random() * 1000000)}`,
            status: "APPOINTMENT",
            assignedToId: testGdo ? testGdo.id : null,
            appointmentDate: new Date(Date.now() + (24 * 3600000 * i)), // Domani, Dopodomani...
            appointmentNote: "Test da inserire a calendario",
            confirmationsOutcome: "confermato",
            confirmationsTimestamp: new Date(),
            salespersonAssigned: testSales.id,
            salespersonAssignedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
        })

        console.log(`Created lead: Test Lead Calendario ${i}`)
    }

    console.log("Done!")
    process.exit(0)
}

insertTestLeads().catch(console.error)
