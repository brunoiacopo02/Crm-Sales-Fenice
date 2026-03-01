import { db } from "../src/db"
import { leads, users, leadEvents, confirmationsNotes } from "../src/db/schema"
import { eq } from "drizzle-orm"
import crypto from "crypto"

async function runTest() {
    console.log("Starting Conferme backend test...")

    try {
        // 1. Find a test user (MANAGER or ADMIN) to act as Conferme
        const adminUser = (await db.select().from(users).where(eq(users.role, 'MANAGER')).limit(1))[0] ||
            (await db.select().from(users).where(eq(users.role, 'ADMIN')).limit(1))[0] ||
            (await db.select().from(users).where(eq(users.role, 'GDO')).limit(1))[0]

        if (!adminUser) {
            console.log("No user found. Aborting test.")
            return;
        }

        console.log(`Using Actor ID: ${adminUser.id} (${adminUser.role})`)

        // 3. Create a mock Lead
        const dummyLeadId = "test-lead-" + Date.now()
        await db.insert(leads).values({
            id: dummyLeadId,
            name: "Test Conferme Lead",
            email: "testconferme@example.com",
            phone: "+39000111222" + Math.floor(Math.random() * 1000),
            status: "APPOINTMENT",
            assignedToId: adminUser.id,
            appointmentDate: new Date(),
            appointmentNote: "Created by automated test",
            createdAt: new Date(),
            updatedAt: new Date(),
        })
        console.log("Created mock lead with APPOINTMENT status:", dummyLeadId)

        // 5. Test "Set Outcome: Confermato"
        await db.update(leads).set({
            confirmationsOutcome: "confermato",
            confirmationsTimestamp: new Date(),
            confirmationsUserId: adminUser.id,
            salespersonAssigned: "Giacomo",
            salespersonAssignedAt: new Date(),
            updatedAt: new Date()
        }).where(eq(leads.id, dummyLeadId))

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId: dummyLeadId,
            eventType: "conferme_outcome_set",
            userId: adminUser.id,
            timestamp: new Date(),
            metadata: { outcome: "confermato", salespersonAssigned: "Giacomo" }
        })
        console.log("Set Conferme Outcome to Confermato, assigned Giacomo.")

        console.log("All backend database actions succeeded! Cleaning up...")

        // 7. Cleanup
        await db.delete(leadEvents).where(eq(leadEvents.leadId, dummyLeadId))
        await db.delete(leads).where(eq(leads.id, dummyLeadId))

        console.log("Cleanup complete. Test PASSED ✅")

    } catch (e) {
        console.error("Test FAILED ❌")
        console.error(e)
    }
}

runTest()
