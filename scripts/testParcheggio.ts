import "dotenv/config";
import { db } from '../src/db';
import { leads } from '../src/db/schema';
import { scheduleConfermeRecall, getConfermeAppointments } from '../src/app/actions/confermeActions';
import { eq } from "drizzle-orm";

async function test() {
    // Pick the first lead that is NEW
    const lead = await db.query.leads.findFirst({
        where: eq(leads.status, 'NEW')
    });

    if (!lead) {
        console.log("No leads found.");
        return;
    }

    console.log("Found lead:", lead.name);
    console.log("Before: confNeedsReschedule =", lead.confNeedsReschedule);

    const rDate = new Date();
    // Simulate scheduleConfermeRecall
    console.log("Calling scheduleConfermeRecall...");

    // We will simulate the payload
    const payload = {
        recallDate: rDate,
        vslUnseen: false,
        needsReschedule: true,
        newAppointmentDate: null,
        recallNotes: "Test note"
    };

    // Note: since scheduleConfermeRecall checks auth, we might have to bypass it in the test script or use direct DB updates to test the logic.
    // Let's just do it directly like the action does:
    const toUpdate: any = {
        confNeedsReschedule: payload.needsReschedule || false,
        recallDate: payload.recallDate || null,
        confVslUnseen: payload.vslUnseen || false,
        confRecallNotes: payload.recallNotes || null,
        version: lead.version + 1,
        updatedAt: new Date()
    };
    if (payload.needsReschedule) {
        toUpdate.appointmentDate = null;
    }

    await db.update(leads).set(toUpdate).where(eq(leads.id, lead.id));
    console.log("Updated DB.");

    // Now test getConfermeAppointments logic
    const fetchMode = 'strict_kanban';

    const validStatuses = ["NEW", "IN_PROGRESS"];
    const resultsRaw = await db.select().from(leads).where(
        eq(leads.status, 'NEW')
    );

    const check = resultsRaw.find(r => r.id === lead.id);
    console.log("After fetch: confNeedsReschedule =", check?.confNeedsReschedule);

    // Filter logic
    const kanbanDaDef = resultsRaw.filter(row => row.confNeedsReschedule);
    console.log("In Da Definire Array? ", kanbanDaDef.some(r => r.id === lead.id));

    console.log("Test done.");
    process.exit(0);
}

test().catch(console.error);
