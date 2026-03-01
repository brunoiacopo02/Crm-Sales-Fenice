import { db } from "../src/db"
import { leads } from "../src/db/schema"
import { eq } from "drizzle-orm"
import { createGoogleCalendarEvent } from "../src/lib/googleCalendar"
import { checkGoogleCalendarConnection } from "../src/app/actions/calendarActions"

async function test() {
    try {
        const lead = (await db.select().from(leads).where(eq(leads.name, 'Test Lead Calendario 1')))[0];
        if (!lead || !lead.salespersonAssigned) {
            console.log('Lead non trovato o venditore non assegnato:', lead);
            process.exit(1);
        }

        console.log('Test Salesperson ID:', lead.salespersonAssigned);

        const isConnected = await checkGoogleCalendarConnection(lead.salespersonAssigned);
        console.log('Calendar Connected?', isConnected);

        console.log('Triggering event creation...');
        const event = await createGoogleCalendarEvent(
            lead.salespersonAssigned,
            {
                summary: 'TEST CRM SCRIPT',
                description: 'Questo e un test diretto',
                startTime: new Date(),
                endTime: new Date(Date.now() + 3600000)
            },
            lead.id,
            'appointment'
        );

        console.log('Event Result:', event ? event.id : 'Nessun evento');
    } catch (e) {
        console.error('ERRORE TEST:', e);
    }
    process.exit(0);
}
test();
