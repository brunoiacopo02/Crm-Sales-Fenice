import { db } from "../src/db"
import { calendarConnections, users } from "../src/db/schema"
import { eq } from "drizzle-orm"

async function test() {
    try {
        const testSales = (await db.select().from(users).where(eq(users.email, 'sales001@fenice.com')))[0];
        if(!testSales) return console.log('user non trovato');
        
        const conn = (await db.select().from(calendarConnections).where(eq(calendarConnections.userId, testSales.id)))[0];
        console.log('CONNESSIONE CALENDARIO:', conn ? 'PRESENTE' : 'ASSENTE');
        if(conn) {
            console.log('Scadenza Token:', conn.tokenExpiry);
            console.log('Access Token exists?', !!conn.accessToken);
        }
        process.exit(0);
    } catch(e) {
        console.error('ERRORE:', e);
        process.exit(1);
    }
}
test();
