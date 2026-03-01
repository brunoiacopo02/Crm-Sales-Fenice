import { db } from "./index"
import { leads } from "./schema"
import { eq } from "drizzle-orm"

async function cleanTestLeads() {
    try {
        const result = await db.delete(leads).where(eq(leads.funnel, 'TestPipeline'))
        console.log(`Pulizia completata. Sono stati rimossi ${result.rowCount} Lead di prova appartenenti al funnel "TestPipeline".`)
        console.log("I relativi Event Log (leadEvents) e CallLogs sono stati rimossi a cascata dal database SQLite (ON DELETE CASCADE).")
    } catch (err: any) {
        console.error("Errore durante la pulizia:", err.message)
    }
}

cleanTestLeads()
