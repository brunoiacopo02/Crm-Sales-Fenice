import { db } from "./index"
import { leads, importLogs, callLogs, leadEvents } from "./schema"

async function cleanAllLeadsData() {
    console.log("Inizio pulizia globale dei Lead e log di importazione...")
    try {
        // Elimina i Lead stessi (i callLogs e leadEvents verranno eliminati a cascata via SQLite)
        const leadsResult = await db.delete(leads)
        console.log(`Eliminati ${leadsResult.rowCount} Lead. Tutti i record relazionali (chiamate ed eventi) sono stati rimossi.`)

        const importsResult = await db.delete(importLogs)
        console.log(`Eliminati ${importsResult.rowCount} log temporali di importazioni CSV (Report tabelle).`)

        console.log("✅ Database purificato! Tutti i Lead sono stati rimossi.")
    } catch (err: any) {
        console.error("Errore durante la pulizia globale:", err.message)
    }
}

cleanAllLeadsData()
