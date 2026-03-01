import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './src/db/schema';
import * as dotenv from 'dotenv';
dotenv.config();

// 1. Apriamo il database SQLite vecchio in memoria/solo-lettura
const sqliteDb = new Database('dev.db', { readonly: true });

// 2. Connettiamoci a Supabase PostgreSQL via Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const pgDb = drizzle(pool, { schema });

async function migrateData() {
    console.log("Iniziando migrazione da SQLite a Supabase PostgreSQL...");

    const tablesToMigrate: any = [
        { name: 'appointmentPresence', pgSchema: schema.appointmentPresence },
        { name: 'calendarEvents', pgSchema: schema.calendarEvents } // we can run this again using ON CONFLICT DO NOTHING or simply skip if it's already done
    ];

    for (const tableDef of tablesToMigrate) {
        try {
            const rows = sqliteDb.prepare(`SELECT * FROM ${tableDef.name}`).all();

            if (rows.length === 0) {
                console.log(`[SKIP] Tabella ${tableDef.name} vuota.`);
                continue;
            }

            console.log(`[START] Migrazione tabella ${tableDef.name} (${rows.length} righe)...`);

            // Trasforma booleani e timestamp UNIX (ms) per Postgres (Date object)
            // JSON da string a object se necessario
            const mappedRows = rows.map((row: any) => {
                const newRow: any = { ...row };
                for (const key in newRow) {
                    // Booleani
                    if (typeof newRow[key] === 'number' && (key === 'isActive' || key === 'overrideFlag')) {
                        newRow[key] = newRow[key] === 1;
                    }
                    // Timestamp conversion (sqlite Drizzle timestamp mode uses numbers (milliseconds))
                    // Timestamp conversion
                    if ((typeof newRow[key] === 'number' || typeof newRow[key] === 'string') && (
                        key.includes('At') || key.includes('Date') || key.includes('Time') || key.includes('timestamp') || key.includes('deadline') || key.includes('tokenExpiry')
                    ) &&
                        !key.includes('Count') && !key.includes('Target') && !key.includes('Amount') && !key.includes('Index') && !key.includes('Seconds')
                    ) {
                        if (typeof newRow[key] === 'number') {
                            const val = newRow[key] < 10000000000 ? newRow[key] * 1000 : newRow[key];
                            newRow[key] = new Date(val);
                        } else {
                            newRow[key] = new Date(newRow[key]);
                        }
                    }
                    // JSON parsing per Postgres jsonb
                    if (typeof newRow[key] === 'string' && (key === 'metadata' || key === 'settings' || key === 'perGdoAssigned')) {
                        try {
                            newRow[key] = JSON.parse(newRow[key]);
                        } catch (e) { }
                    }
                }
                return newRow;
            });

            // Insert batch data with conflict ignore (just in case)
            await pgDb.insert(tableDef.pgSchema).values(mappedRows).onConflictDoNothing();

            console.log(`[OK] Tabella ${tableDef.name} completata.`);

        } catch (e: any) {
            if (e.message.includes("no such table")) {
                console.log(`[SKIP] Tabella ${tableDef.name} non trovata in SQLite.`);
            } else {
                console.error(`[ERRORE] Fallita migrazione ${tableDef.name}:`, e.message);
            }
        }
    }

    console.log("Migrazione completata con successo!");
    pool.end();
}

migrateData().catch(e => {
    console.error("Fatal Error: ", e);
    process.exit(1);
});
