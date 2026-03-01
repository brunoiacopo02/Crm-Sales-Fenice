import { db } from "../src/db";
import { leads } from "../src/db/schema";
import { isNotNull, eq } from "drizzle-orm";

async function main() {
    const appts = await db.select().from(leads).where(isNotNull(leads.appointmentDate));
    console.log(`Trovati ${appts.length} lead con appuntamento fissato.`);
    for (const l of appts) {
        console.log(`- Lead: ${l.name} | GDO: ${l.assignedToId} | Appt Date: ${l.appointmentDate} | Conferme Outcome: ${l.confirmationsOutcome || 'NULL (Da conferred)'}`);
    }

    const discarded = await db.select().from(leads).where(isNotNull(leads.discardReason));
    console.log(`\nTrovati ${discarded.length} lead scartati.`);
    for (const l of discarded) {
        console.log(`- Lead: ${l.name} | GDO: ${l.assignedToId} | Motivo: ${l.discardReason}`);
    }
}

main().catch(console.error);
