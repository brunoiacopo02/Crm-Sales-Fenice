import "dotenv/config";
import { db } from '../src/db';
import { leads } from '../src/db/schema';
import crypto from 'crypto';

async function seed() {
    console.log("Seeding Extravaganza per Test Dual Recall...");

    const now = new Date();

    // 6 Appuntamenti sparsi per Oggi
    const today = new Date(now);
    const oreOggi = [15, 16, 17, 18, 19, 20];
    for (const ora of oreOggi) {
        const d = new Date(today);
        d.setHours(ora, 0, 0, 0);

        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: `[NEW_TEST] Utente Oggi ${ora}h`,
            email: `new.test.oggi.${ora}@example.com`,
            phone: `+39333999${ora}${Math.floor(Math.random() * 100)}`,
            status: 'NEW',
            appointmentDate: d,
            appointmentCreatedAt: new Date(Date.now() - 3600 * 1000 * 5),
            version: 1,
            funnel: 'Meta Ads',
        }).onConflictDoNothing();
        console.log(`Creato: Oggi Ore ${ora}:00`);
    }

    // 4 Appuntamenti sparsi per Domani
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const oreDomani = [9, 10, 11, 12];
    for (const ora of oreDomani) {
        const d = new Date(tomorrow);
        d.setHours(ora, 0, 0, 0);

        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: `[NEW_TEST] Utente Domani ${ora}h`,
            email: `new.test.domani.${ora}@example.com`,
            phone: `+39333999${ora}${Math.floor(Math.random() * 100)}`,
            status: 'NEW',
            appointmentDate: d,
            appointmentCreatedAt: new Date(),
            version: 1,
            funnel: 'Google Ads',
        }).onConflictDoNothing();
        console.log(`Creato: Domani Ore ${ora}:00`);
    }

    console.log("Seeding completato!");
    process.exit(0);
}

seed().catch(console.error);
