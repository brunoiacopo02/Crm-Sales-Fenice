require('dotenv').config();
const { db } = require('./src/db');
const { leads } = require('./src/db/schema');
const { eq } = require('drizzle-orm');

async function test() {
    try {
        const lead = await db.select().from(leads).where(eq(leads.name, 'Lead Da Confermare 1')).get();
        if (lead) {
            console.log('Lead 1 Data: ', { appDate: lead.appointmentDate, outcome: lead.confirmationsOutcome, sp: lead.salespersonAssigned });
        }
    } catch(e) {
        console.error('ERRORE:', e);
    }
}
test();
