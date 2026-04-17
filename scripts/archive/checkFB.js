require('dotenv').config();
const { db } = require('./src/db');
const { users, calendarConnections } = require('./src/db/schema');
const { eq } = require('drizzle-orm');
const calendar = require('./src/lib/googleCalendar');

async function test() {
    try {
        const testSales = await db.select().from(users).where(eq(users.email, 'sales001@fenice.com')).get();
        if(!testSales) return console.log('user non trovato');
        
        console.log('Testing FreeBusy check...');
        const isFree = await calendar.checkFreeBusy(testSales.id, new Date(), new Date(Date.now() + 3600000));
        console.log('Is Free?', isFree);
    } catch(e) {
        console.error('ERRORE:', e);
    }
}
test();
