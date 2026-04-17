import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './src/db/schema';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const pgDb = drizzle(pool, { schema });

async function checkCounts() {
    const tables = [
        { name: 'users', pgSchema: schema.users },
        { name: 'shopItems', pgSchema: schema.shopItems },
        { name: 'sprints', pgSchema: schema.sprints },
        { name: 'teamGoals', pgSchema: schema.teamGoals },
        { name: 'calendarConnections', pgSchema: schema.calendarConnections },
        { name: 'leads', pgSchema: schema.leads },
        { name: 'callLogs', pgSchema: schema.callLogs },
        { name: 'leadEvents', pgSchema: schema.leadEvents },
        { name: 'breakSessions', pgSchema: schema.breakSessions },
        { name: 'notifications', pgSchema: schema.notifications },
        { name: 'assignmentSettings', pgSchema: schema.assignmentSettings },
        { name: 'importLogs', pgSchema: schema.importLogs },
        { name: 'userPurchases', pgSchema: schema.userPurchases },
        { name: 'coinTransactions', pgSchema: schema.coinTransactions },
        { name: 'calendarEvents', pgSchema: schema.calendarEvents }
    ];

    console.log("PostgreSQL Row Counts:");
    for (const tableDef of tables) {
        const result = await pgDb.$client.query(`SELECT COUNT(*) FROM "${tableDef.name}"`);
        console.log(`${tableDef.name}:`, result.rows[0].count);
    }
    pool.end();
}

checkCounts();
