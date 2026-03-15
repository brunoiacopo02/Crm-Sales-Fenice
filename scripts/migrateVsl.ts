import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

async function run() {
    console.log("Adding confVslSeen...");
    await db.execute(sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "confVslSeen" boolean DEFAULT false NOT NULL;`);
    console.log("Dropping confVslUnseen...");
    await db.execute(sql`ALTER TABLE leads DROP COLUMN IF EXISTS "confVslUnseen";`);
    console.log('Migration complete');
    process.exit(0);
}
run().catch(e => {
    console.error(e);
    process.exit(1);
});
