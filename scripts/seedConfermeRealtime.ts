import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
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
            phone: `+39333000${hour}${Math.floor(Math.random() * 1000)}`,
            status: 'NEW',
            appointmentDate: d,
            appointmentCreatedAt: new Date(),
            version: 1,
            funnel: 'Meta Ads',
        }).onConflictDoNothing();
        console.log(`Created Lead for ${hour}:00`);
    }

    // Scenario B: NR Badges Test (2 missed calls)
    const nrDate = new Date(appDate);
    nrDate.setHours(16, 30, 0, 0);

    await db.insert(leads).values({
        id: crypto.randomUUID(),
        name: `[TEST_E2E] Lead NR Doppio`,
        email: `test.e2e.nr@example.com`,
        phone: `+3933300099${Math.floor(Math.random() * 1000)}`,
        status: 'NEW',
        appointmentDate: nrDate,
        appointmentCreatedAt: new Date(),
        confCall1At: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
        confCall2At: new Date(Date.now() - 1000 * 60 * 30), // 30 mins ago
        version: 1,
        funnel: 'Google Ads',
    }).onConflictDoNothing();
    console.log(`Created Lead with 2 NR calls`);

    // Scenario C: Snooze Test +1 Minute
    const snoozeDate = new Date(appDate);
    snoozeDate.setHours(17, 30, 0, 0);
    const snoozeAlertTime = new Date(Date.now() + 60000); // +1 min da ora

    await db.insert(leads).values({
        id: crypto.randomUUID(),
        name: `[TEST_E2E] Lead SNOOZE Attivo`,
        email: `test.e2e.snooze@example.com`,
        phone: `+39333${Math.floor(Math.random() * 1000000)}`,
        status: 'NEW',
        appointmentDate: snoozeDate,
        appointmentCreatedAt: new Date(),
        confSnoozeAt: snoozeAlertTime,
        version: 1,
        funnel: 'Snooze Tester',
    }).onConflictDoNothing();
    console.log(`Created Lead with Snooze at +1 minute from now`);

    // Scenario D: Parcheggio Programmato (Richiami)
    await db.insert(leads).values({
        id: crypto.randomUUID(),
        name: `[TEST_E2E] Lead Parcheggiato (Ferito)`,
        email: `test.e2e.park@example.com`,
        phone: `+39333${Math.floor(Math.random() * 1000000)}`,
        status: 'NEW',
        appointmentDate: null,
        appointmentCreatedAt: new Date(),
        confNeedsReschedule: true,
        confRecallNotes: "Da richiamare dopo le ferie estive.",
        recallDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // +30 days
        version: 1,
        funnel: 'Parcheggio Tester',
    }).onConflictDoNothing();
    console.log(`Created Lead for Parcheggio / Richiami tab`);

    console.log("Seeding complete!");
    process.exit(0);
}

seed().catch(console.error);
