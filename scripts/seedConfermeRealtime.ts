import "dotenv/config";
import { db } from '../src/db';
import { leads } from '../src/db/schema';
import crypto from 'crypto';

async function seed() {
    console.log("Seeding E2E Conferme Realtime Data...");

    // Find the next working day afternoon (Simulate "App Pomeriggio")
    const now = new Date();
    const appDate = new Date(now);

    // Scenarios A: 6 Leads afternoon
    const afternoonHours = [15, 16, 17, 18, 19, 20];
    for (const hour of afternoonHours) {
        const d = new Date(appDate);
        d.setHours(hour, 0, 0, 0);

        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: `[TEST_E2E] Lead Pomeriggio Ore ${hour}`,
            email: `test.e2e.${hour}@example.com`,
            phone: `+39333000${hour}00`,
            status: 'NEW',
            appointmentDate: d,
            appointmentCreatedAt: new Date(),
            version: 1,
            funnel: 'Meta Ads',
        });
        console.log(`Created Lead for ${hour}:00`);
    }

    // Scenario B: NR Badges Test (2 missed calls)
    const nrDate = new Date(appDate);
    nrDate.setHours(16, 30, 0, 0);

    await db.insert(leads).values({
        id: crypto.randomUUID(),
        name: `[TEST_E2E] Lead NR Doppio`,
        email: `test.e2e.nr@example.com`,
        phone: `+393330009999`,
        status: 'NEW',
        appointmentDate: nrDate,
        appointmentCreatedAt: new Date(),
        confCall1At: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
        confCall2At: new Date(Date.now() - 1000 * 60 * 30), // 30 mins ago
        version: 1,
        funnel: 'Google Ads',
    });
    console.log(`Created Lead with 2 NR calls`);

    console.log("Seeding complete!");
    process.exit(0);
}

seed().catch(console.error);
