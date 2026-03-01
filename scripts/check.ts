import { db } from "../src/db"
import { leads } from "../src/db/schema"
import { eq } from "drizzle-orm"

async function check() {
    const list = await db.select().from(leads).where(eq(leads.confirmationsOutcome, 'confermato'))
    console.log(list.map(l => ({ name: l.name, salesperson: l.salespersonAssigned, date: l.appointmentDate })))
    process.exit(0)
}
check()
