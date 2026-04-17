import { db } from "./src/db";
import { leads } from "./src/db/schema";
import { updateLeadOutcome } from "./src/app/actions/pipelineActions";

async function test() {
    console.log("Fetching first lead...");
    const all = await db.select().from(leads).limit(1);
    const targetLead = all[0];
    if (!targetLead) {
        console.log("No leads found!");
        return;
    }
    
    console.log(`Targeting lead: ${targetLead.id} - ${targetLead.name}`);
    console.log(`Current call count: ${targetLead.callCount}`);
    
    try {
        console.log("Invoking updateLeadOutcome('NON_RISPOSTO')...");
        // We simulate a non-risposto
        await updateLeadOutcome(
            targetLead.id, 
            'NON_RISPOSTO', 
            '', 
            undefined, 
            undefined, 
            undefined
        );
        console.log("Action complete.");
        
        // Fetch all leads to see if call counts shifted
        const check = await db.select({ id: leads.id, callCount: leads.callCount }).from(leads);
        const shifted = check.filter(l => l.callCount > 0);
        console.log(`Leads with callCount > 0: ${shifted.length}`);
        
    } catch (e) {
        console.error("CRASHED:", e);
    }
}

test().then(() => process.exit(0));
