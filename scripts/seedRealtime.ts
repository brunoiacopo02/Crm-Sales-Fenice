import { db } from "../src/db/index"
import { leads } from "../src/db/schema"
import crypto from "crypto"

async function run() {
    const gdo105 = 'ef3988b2-d15e-4169-88a5-7516e6ddd146'
    const gdo114 = '5fab6b1b-8bd7-49c7-b088-8a96efac8930'

    console.log("Seeding 3 fake appointments for Realtime E2E Test...")

    const appts = [
        {
            id: crypto.randomUUID(),
            name: "Test E2E GDO114 - Alpha",
            phone: "+393000000001",
            status: "APPOINTMENT",
            assignedToId: gdo114,
            appointmentDate: new Date(),
            appointmentCreatedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: crypto.randomUUID(),
            name: "Test E2E GDO114 - Beta",
            phone: "+393000000002",
            status: "APPOINTMENT",
            assignedToId: gdo114,
            appointmentDate: new Date(),
            appointmentCreatedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: crypto.randomUUID(),
            name: "Test E2E GDO105 - Gamma",
            phone: "+393000000003",
            status: "APPOINTMENT",
            assignedToId: gdo105,
            appointmentDate: new Date(),
            appointmentCreatedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        }
    ]

    for (const a of appts) {
        await db.insert(leads).values(a)
    }

    console.log("Seed completato:", appts.map(a => a.id))
}

run().catch(console.error)
