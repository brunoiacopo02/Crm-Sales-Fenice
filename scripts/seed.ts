import { db } from '../src/db';
import { users } from '../src/db/schema';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

async function main() {
    const adminPassword = await bcrypt.hash('admin123', 10);
    const gdoPassword = await bcrypt.hash('gdo123', 10);

    // Upsert pattern in Drizzle SQLite
    const adminExist = (await db.select().from(users).where(eq(users.email, 'admin@fenice.com')))[0];
    if (!adminExist) {
        await db.insert(users).values({
                    id: crypto.randomUUID(),
                    name: 'Admin Fenice',
                    email: 'admin@fenice.com',
                    password: adminPassword,
                    role: 'ADMIN',
                    createdAt: new Date(),
                });
        console.log('Created Admin user.');
    }

    const gdoExist = (await db.select().from(users).where(eq(users.email, 'gdo@fenice.com')))[0];
    if (!gdoExist) {
        await db.insert(users).values({
                    id: crypto.randomUUID(),
                    name: 'Mario GDO',
                    email: 'gdo@fenice.com',
                    password: gdoPassword,
                    role: 'GDO',
                    createdAt: new Date(),
                });
        console.log('Created GDO user.');
    }

    console.log('Seed completed successfully.');
}

main().catch(console.error);
