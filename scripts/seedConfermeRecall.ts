import "dotenv/config";
import { db } from '../src/db';
import { leads } from '../src/db/schema';
import crypto from 'crypto';

async function seed() {
    console.log("Seeding E2E Conferme Recall Data (Phase 3)...");

    const now = new Date();

    // 1. Appuntamenti Pomeriggio Oggi
    const today = new Date(now);
    const afternoonHours = [15, 16, 17, 18, 19];
    for (const hour of afternoonHours) {
        const d = new Date(today);
        d.setHours(hour, 0, 0, 0);

        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: `[TEST] Pomeriggio Ore ${hour}`,
            email: `test.recall.pomeriggio.${hour}@example.com`,
            phone: `+39333000${hour}${Math.floor(Math.random() * 1000)}`,
            status: 'NEW',
            appointmentDate: d,
            appointmentCreatedAt: new Date(),
            version: 1,
            funnel: 'Meta Ads',
        }).onConflictDoNothing();
        console.log(`Created Lead for Today ${hour}:00`);
    }

    // 2. Appuntamenti Mattina Domani
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const morningHours = [9, 10, 11];
    for (const hour of morningHours) {
        const d = new Date(tomorrow);
        d.setHours(hour, 0, 0, 0);

        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: `[TEST] Mattina Ore ${hour}`,
            email: `test.recall.mattina.${hour}@example.com`,
            phone: `+39333111${hour}${Math.floor(Math.random() * 1000)}`,
            status: 'NEW',
            appointmentDate: d,
            appointmentCreatedAt: new Date(),
            version: 1,
            funnel: 'Google Ads',
        }).onConflictDoNothing();
        console.log(`Created Lead for Tomorrow ${hour}:00`);
    }

    // 3. Snooze (+5 minuti)
    for (let i = 1; i <= 2; i++) {
        const snoozeTime = new Date(now.getTime() + 5 * 60000); // +5 min
        const d = new Date(today);
        d.setHours(16, 0, 0, 0); // Put them in 16:00 bucket today

        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: `[TEST] Snooze Alert ${i}`,
            email: `test.recall.snooze.${i}@example.com`,
            phone: `+39333222000${i}`,
            status: 'NEW',
            appointmentDate: d,
            appointmentCreatedAt: new Date(),
            confSnoozeAt: snoozeTime,
            version: 1,
            funnel: 'Snooze Tester',
        }).onConflictDoNothing();
        console.log(`Created Lead with Snooze at +5 mins (${i})`);
    }

    // 4. Parcheggiati (Richiami)
    for (let i = 1; i <= 2; i++) {
        await db.insert(leads).values({
            id: crypto.randomUUID(),
            name: `[TEST] Parcheggiato ${i}`,
            email: `test.recall.park.${i}@example.com`,
            phone: `+39333333000${i}`,
            status: 'NEW',
            appointmentDate: null,
            appointmentCreatedAt: new Date(),
            confNeedsReschedule: true,
            confRecallNotes: `Test nota parcheggio veloce ${i}`,
            version: 1,
            funnel: 'Park Tester',
        }).onConflictDoNothing();
        console.log(`Created Lead Parcheggiato (${i})`);
    }

    console.log("Seeding complete!");
    process.exit(0);
}

seed().catch(console.error);
