/**
 * FU-024: Migrate creatureDropCounter column on users table
 * Run: node scripts/ralph/migrate-drop-counter.js
 * Calls the local migrate-universe API route which adds the column.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
    console.log('FU-024: Adding creatureDropCounter to users table...');
    console.log(`Calling ${BASE_URL}/api/migrate-universe`);

    try {
        const res = await fetch(`${BASE_URL}/api/migrate-universe`);
        const data = await res.json();

        if (data.success) {
            console.log('Migration successful:', data.message);
        } else {
            console.error('Migration failed:', data.error);
            process.exit(1);
        }
    } catch (error) {
        console.error('Failed to reach migration endpoint:', error.message);
        process.exit(1);
    }
}

main();
