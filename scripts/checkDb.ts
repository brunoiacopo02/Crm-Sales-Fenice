import { db } from "../src/db"
import { leads } from "../src/db/schema"
import { eq, and } from "drizzle-orm"

async function run() {
    console.log("Checking leads for GDO 114")
    const res = await db.select({
        id: leads.id,
        name: leads.name,
        assignedToId: leads.assignedToId,
        confirmationsOutcome: leads.confirmationsOutcome,
        confirmationsTimestamp: leads.confirmationsTimestamp
    })
        .from(leads)
        .where(and(
            eq(leads.assignedToId, '5fab6b1b-8bd7-49c7-b088-8a96efac8930'),
            eq(leads.confirmationsOutcome, 'confermato')
        ))

    console.log("Trovati:", res.length)
    res.forEach(r => {
        console.log(`- ${r.name} | Outcome: ${r.confirmationsOutcome} | Timestamp: ${r.confirmationsTimestamp?.toISOString()} | Local: ${r.confirmationsTimestamp?.toLocaleString()}`)
    })

    // Check week scope
    const now = new Date()
    const day = now.getDay()
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1) // adjust when day is sunday
    const weekStart = new Date(now)
    weekStart.setDate(diffToMonday)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)

    console.log("\nServer Week Start:", weekStart.toISOString())
    console.log("Server Week End:", weekEnd.toISOString())

    process.exit(0)
}

run().catch(console.error)
