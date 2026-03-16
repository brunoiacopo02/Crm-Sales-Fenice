import { db } from "../src/db"
import { users, leads } from "../src/db/schema"
import crypto from "crypto"
import dns from 'node:dns'

dns.setDefaultResultOrder('ipv4first')

export async function seedConfermeKpiData() {
    console.log("Seeding Conferme KPI Data...")

    // 1. Create or Find CONFERME user
    const confermeUsername = "andrea_conferme@fenice.local"
    let confermeUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.email, confermeUsername)
    })

    if (!confermeUser) {
        const newId = crypto.randomUUID()
        await db.insert(users).values({
            id: newId,
            name: "Andrea (Conferme)",
            displayName: "Andrea",
            email: confermeUsername,
            password: crypto.createHash('sha256').update("Fenice2026!").digest('hex'),
            role: "CONFERME",
            confermeTargetTier1: 19,
            confermeTargetTier2: 24,
            isActive: true,
        })
        confermeUser = { id: newId, role: "CONFERME" } as any
    }

    // 2. Create 3 Vendors
    const vendorIds = []
    for (let i = 1; i <= 3; i++) {
        const vEmail = `sales00${i}@fenice.local`
        let vendor = await db.query.users.findFirst({
            where: (users, { eq }) => eq(users.email, vEmail)
        })
        if (!vendor) {
            const vId = crypto.randomUUID()
            await db.insert(users).values({
                id: vId,
                name: `Closer 00${i}`,
                displayName: `C${i}`,
                email: vEmail,
                password: crypto.createHash('sha256').update("Fenice2026!").digest('hex'),
                role: "VENDITORE",
                isActive: true,
            })
            vendorIds.push(vId)
        } else {
            vendorIds.push(vendor.id)
        }
    }

    // 3. Insert 30 confirmed leads spread across the current month
    const currentMonth = new Date().getMonth()
    const currentYear = new Date().getFullYear()

    for (let i = 0; i < 30; i++) {
        // Random day in the current month (1 to 28)
        const day = Math.floor(Math.random() * 28) + 1
        const date = new Date(currentYear, currentMonth, day, 10, 0, 0)

        // Randomly assign to one of the 3 vendors
        const assignedSalespersonId = vendorIds[Math.floor(Math.random() * vendorIds.length)]

        const leadId = crypto.randomUUID()
        await db.insert(leads).values({
            id: leadId,
            name: `Confermato Fake ${i + 1}`,
            email: `fake${i + 1}@example.com`,
            phone: `+39 333000${i.toString().padStart(4, '0')}`,
            status: "APPOINTMENT",
            appointmentDate: date,
            appointmentCreatedAt: new Date(date.getTime() - 86400000), // Fixed 1 day before

            // Conferme fields
            confirmationsOutcome: "confermato",
            confirmationsUserId: confermeUser!.id,
            confirmationsTimestamp: date,

            // Salesperson assignment
            salespersonUserId: assignedSalespersonId,
            salespersonAssignedAt: date
        })
    }

    console.log("Seeding completed successfully! 🎉")
    return true
}
