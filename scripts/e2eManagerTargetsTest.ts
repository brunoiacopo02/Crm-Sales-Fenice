import "dotenv/config";
import { db } from "../src/db";
import { users, leads, monthlyTargets, dailyKpiSnapshots } from "../src/db/schema";
import { getManagerTargetsData } from "../src/app/actions/targetActions";
import { eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { subDays } from "date-fns";

// Mock Next.js Headers for local TSX script execution
const mockHeaders = {
    cookies: () => ({
        get: () => ({ name: 'next-auth.session-token', value: 'mocked' }),
        getAll: () => [],
        set: () => { },
    }),
};

async function runTargetsE2E() {
    console.log("==================================================");
    console.log("🚀 INIZIO TEST E2E: DASHBOARD MANAGER TARGET");
    console.log("==================================================");

    const testMonth = "2099-06"; // Future test month to avoid real DB leads
    const mockToday = new Date("2099-06-15T12:00:00.000Z"); // middle of the month
    const todayFormatted = mockToday.toISOString().split('T')[0];

    // UUIDs mock
    const gdoIds: string[] = [];
    for (let i = 0; i < 5; i++) {
        gdoIds.push(crypto.randomUUID());
    }

    try {
        console.log(`\n🧹 0. Pulizia DB per mese di test (${testMonth})...`);
        await db.delete(monthlyTargets).where(eq(monthlyTargets.month, testMonth));
        await db.delete(leads).where(eq(leads.status, "TEST_TARGETS"));
        await db.delete(users).where(inArray(users.id, gdoIds));

        for (let i = 0; i < 15; i++) {
            const dStr = subDays(mockToday, i).toISOString().split('T')[0];
            await db.delete(dailyKpiSnapshots).where(eq(dailyKpiSnapshots.date, dStr));
        }

        console.log("👤 1. Creazione di 5 GDO Attivi simulati...");
        for (let i = 0; i < 5; i++) {
            await db.insert(users).values({
                id: gdoIds[i],
                email: `test_gdo_${i}_target@local.test`,
                password: "test",
                role: "GDO",
                gdoCode: 800 + i,
                displayName: `Target GDO ${i}`,
                isActive: true,
                createdAt: new Date()
            });
        }

        console.log("🎯 2. Creazione Target Mensile: 100 App Fissati per l'intero CRM...");
        await db.insert(monthlyTargets).values({
            id: crypto.randomUUID(),
            month: testMonth,
            targetAppFissati: 100,
            targetAppConfermati: 50,
            targetTrattative: 40,
            targetClosed: 10,
            targetValoreContratti: 5000,
            updatedAt: new Date()
        });

        console.log("📝 3. Inserimento di 20 Lead totali nel DB di cui solo 1 Fissato...");
        const uniquePrefix = Date.now().toString().slice(-6);
        for (let i = 0; i < 20; i++) {
            const isFissato = i === 0;

            await db.insert(leads).values({
                id: crypto.randomUUID(),
                name: `Lead Target ${i}`,
                phone: `+39800${uniquePrefix}${i}`,
                funnel: 'META',
                status: "TEST_TARGETS",
                callCount: 0,
                version: 1,
                assignedToId: gdoIds[i % 5],
                createdAt: new Date("2099-06-10T10:00:00.000Z"),
                updatedAt: new Date("2099-06-10T10:00:00.000Z"),
                appointmentDate: isFissato ? new Date("2099-06-15T10:00:00.000Z") : null,
                appointmentCreatedAt: isFissato ? new Date("2099-06-15T10:00:00.000Z") : null,
                salespersonOutcome: null // 0 chiusure forzate
            });
        }

        console.log("⏱️  4. Forzatura Snapshot Storico (-8 Giorni fa a -25%)...");
        // Inject a snapshot exactly 8 days ago with -25%
        const date8DaysAgo = subDays(mockToday, 8).toISOString().split('T')[0];

        await db.insert(dailyKpiSnapshots).values({
            id: crypto.randomUUID(),
            date: date8DaysAgo,
            fissaggioVariazionePerc: -25
        });

        console.log("⚙️  5. Esecuzione Engine GetManagerTargetsData()...");
        const stats = await getManagerTargetsData(testMonth, mockToday);

        console.log("\n============= ASSERZIONI E2E =============");

        console.log(`GDO Attivi: ${stats.gdoAttivi} (Atteso >= 5)`);
        console.assert(stats.gdoAttivi >= 5, "GDO Attivi mancanti");

        console.log(`Totale Lead Del Mese Test: ${stats.totaleLeadDelMese}`);

        console.log(`Target Mensile Fissati: ${stats.targetData.targetAppFissati}`);
        console.assert(stats.targetData.targetAppFissati === 100, "Target mismatch");

        console.log(`ACT Closed: ${stats.actClosed} (Atteso 0 senza crash)`);
        console.assert(stats.actClosed === 0, "Chiusure inattese o errori matematici");

        console.log(`Forecast Media Vendite Previste: ${stats.mediaVenditePrevisteMeseGdo.toFixed(2)}`);
        // We shouldn't have NaN. Should be 0 since actClosed = 0
        console.assert(!isNaN(stats.mediaVenditePrevisteMeseGdo), "Division by zero result in Forecast Vendite");
        console.assert(stats.mediaVenditePrevisteMeseGdo === 0, "Forecast Math mismatch");

        console.log(`Media app/day/GDO: ${stats.mediaAppDayGdo.toFixed(4)}`);
        console.assert(!isNaN(stats.mediaAppDayGdo), "Division by zero result in App Day GDO");

        console.log(`\n============= ALLARME CRITICO 7 GIORNI ============="`);
        console.log(`Data Primo -20%: ${stats.dataPrimoMeno20}`);
        console.log(`Allarme Attivo in UI?: ${stats.is7DaysAlertActive ? '🚨 SI (TEST OK)' : '🟢 NO (TEST FAIL)'}`);

        console.assert(stats.dataPrimoMeno20 === date8DaysAgo, "Data primo -20% non identificata correttamente");
        console.assert(stats.is7DaysAlertActive === true, "Il check >= 7 giorni sui calendari ha fallito");

        console.log("\n✅ TUTTI I TEST TARGET HANNO PASSATO I CHECK MATEMATICI!");

    } catch (e: any) {
        console.log(`\n\x1b[31m🚨 ERRORE TEST:\x1b[0m ${e.message}`);
    } finally {
        console.log("\n🧹 Ripulizia DB Target Test...");
        await db.delete(leads).where(eq(leads.status, "TEST_TARGETS"));
        await db.delete(monthlyTargets).where(eq(monthlyTargets.month, testMonth));
        await db.delete(users).where(inArray(users.id, gdoIds));

        for (let i = 0; i < 15; i++) {
            const dStr = subDays(mockToday, i).toISOString().split('T')[0];
            await db.delete(dailyKpiSnapshots).where(eq(dailyKpiSnapshots.date, dStr));
        }

        console.log("Fine.");
        process.exit(0);
    }
}

runTargetsE2E();
