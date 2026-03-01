import { db } from "../src/db"
import { leads } from "../src/db/schema"
import { like, or } from "drizzle-orm"

async function deleteTestLeads() {
    try {
        console.log("Deleting test leads...");
        const result = await db.delete(leads).where(
            or(
                like(leads.name, "%Test%"),
                like(leads.name, "%Da Confermare%")
            )
        );
        console.log(`Deleted ${result.rowCount} test leads.`);
    } catch (e) {
        console.error('ERRORE:', e);
    }
    process.exit(0);
}
deleteTestLeads();
