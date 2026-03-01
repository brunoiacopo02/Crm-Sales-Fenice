require('dotenv').config();
const { db } = require('./src/db');
const { leads } = require('./src/db/schema');
const { eq } = require('drizzle-orm');
const { createGoogleCalendarEvent, checkGoogleCalendarConnection } = require('./src/lib/googleCalendar');

async function test() {
    try {
        const lead = await db.select().from(leads).where(eq(leads.name, 'Test Lead Calendario 1')).get();
        if (!lead || !lead.salespersonAssigned) {
            console.log('Lead non trovato o venditore non assegnato');
            return;
        }

        console.log('Test Salesperson ID:', lead.salespersonAssigned);
        console.log('Connected?', await checkGoogleCalendarConnection(lead.salespersonAssigned));
        
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
    } catch(e) {
        console.error('ERRORE TEST:', e);
    }
}
test();
