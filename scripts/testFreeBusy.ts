import * as dotenv from 'dotenv';
dotenv.config();

import { db } from "../src/db"
import { users } from "../src/db/schema"
import { eq } from "drizzle-orm"
import { checkFreeBusy, createGoogleCalendarEvent } from "../src/lib/googleCalendar"

async function runTest() {
    try {
        const testSales = (await db.select().from(users).where(eq(users.email, 'sales001@fenice.com')))[0];
        if (!testSales) return console.log('user non trovato');

        console.log('Testing FreeBusy check...');
        const isFree = await checkFreeBusy(testSales.id, new Date(), new Date(Date.now() + 3600000));
        console.log('Is Free?', isFree);

        console.log('Testing event creation with attendee...');
        const res = await createGoogleCalendarEvent(testSales.id, {
            summary: 'Test Attendee + FreeBusy CRM',
            description: 'Test automatico',
            startTime: new Date(Date.now() + 86400000), // Domani
            endTime: new Date(Date.now() + 86400000 + 3600000),
            attendees: [{ email: 'brunoiacopo02@gmail.com' }]
        }, "fake_lead", "appointment");

        console.log('Risultato evento id:', res?.id || 'fallito');
    } catch (e) {
        console.error('ERRORE:', e);
    }
}

runTest().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
