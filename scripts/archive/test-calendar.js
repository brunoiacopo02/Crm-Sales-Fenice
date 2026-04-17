require('dotenv').config();
const { db } = require('./src/db');
const { createGoogleCalendarEvent, checkGoogleCalendarConnection } = require('./src/lib/googleCalendar');
const { users } = require('./src/db/schema');
const { eq } = require('drizzle-orm');

async function test() {
    try {
        const user = await db.select().from(users).where(eq(users.email, 'sales001@fenice.com')).get();
        if (!user) {
            console.log('User non trovato');
            return;
        }

        console.log('User trovato:', user.id);
        const connection = await checkGoogleCalendarConnection(user.id);
        console.log('Calendar Connected?', connection);

        const event = await createGoogleCalendarEvent(
            user.id,
            {
                summary: 'TEST CRM SCRIPT',
                description: 'Questo e un test',
                startTime: new Date(),
                endTime: new Date(Date.now() + 3600000)
            },
            'fake_lead_id',
            'appointment'
        );
        
        console.log('Event Result:', event ? event.id : 'Nessun evento');
    } catch(e) {
        console.error('ERRORE TEST:', e);
    }
}
test();
