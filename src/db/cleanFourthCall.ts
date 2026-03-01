import { db } from "./index"
import { leads, callLogs } from "./schema"
import { eq, or, inArray } from "drizzle-orm"

async function cleanFourthCallData() {
    console.log("Inizio pulizia dei dati di simulazione Quarta Chiamata...")
    try {
        // Recupera gli ID dei lead fasulli
        const testLeads = await db.select({ id: leads.id }).from(leads)
                    .where(or(eq(leads.funnel, 'TestFourthCall'), eq(leads.funnel, 'TestTarget')))
            

        if (testLeads.length > 0) {
            const leadIds = testLeads.map(l => l.id)

            // Elimina CallLogs associati a questi lead
            const logsResult = await db.delete(callLogs).where(inArray(callLogs.leadId, leadIds))
            console.log(`Eliminati ${logsResult.rowCount} Call Logs fasulli.`)

            // Elimina i Lead stessi
            const leadsResult = await db.delete(leads).where(inArray(leads.id, leadIds))
            console.log(`Eliminati ${leadsResult.rowCount} Lead fasulli.`)
        } else {
            console.log("Nessun record da eliminare trovato.")
        }

        console.log("✅ Database perfettamente pulito!")
    } catch (err: any) {
        console.error("Errore durante la pulizia:", err.message)
    }
}

cleanFourthCallData()
