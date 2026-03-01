import { db } from "../src/db";
import { leads, users, leadEvents } from "../src/db/schema";
import { eq, like } from "drizzle-orm";
import crypto from "crypto";
import { addHours } from "date-fns";

async function main() {
    const leadToConfirm = (await db.select().from(leads).where(like(leads.name, "Target 114 4")))[0];

    if (!leadToConfirm) {
        console.log("Nessun appuntamento da confermare");
        return;
    }

    const leadId = leadToConfirm.id;
    console.log(`Confermo appuntamento per ID: ${leadId} versione in DB: ${leadToConfirm.version}`);

    const andreaUser = (await db.select().from(users).where(eq(users.email, "andrea@fenice.local")))[0] || (await db.select().from(users))[0]!;

    try {
        console.log("Simulating setConfermeOutcome action...");

        let oldLead = leadToConfirm;
        let currentVersion = leadToConfirm.version;

        if (oldLead.version !== currentVersion) {
            console.error("CONCURRENCY_ERROR - THIS SHOULD NEVER HAPPEN HERE");
        }
        await db.update(leads).set({
            confirmationsOutcome: "confermato",
            confirmationsUserId: andreaUser.id,
            confirmationsTimestamp: new Date(),
            salespersonAssigned: "sales-001",
            salespersonAssignedAt: new Date(),
            version: leadToConfirm.version + 1,
            updatedAt: new Date()
        }).where(eq(leads.id, leadId))

        console.log("UPDATE leads SUCCESS");

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: "conferme_outcome_set",
            userId: andreaUser.id,
            timestamp: new Date(),
            metadata: { outcome: "confermato" }
        });

        console.log("INSERT leadEvents SUCCESS");

    } catch (e: any) {
        console.error("DB ERROR:");
        console.error(e.stack);
    }
}

main().catch(console.error);
