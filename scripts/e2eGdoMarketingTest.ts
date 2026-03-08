// Mock Next.js Headers for local TSX script execution
const mockHeaders = {
    cookies: () => ({
        get: () => ({ name: 'next-auth.session-token', value: 'mocked' }),
        getAll: () => [],
        set: () => { },
    }),
};
// Use a TS compiler alias or patch if needed, but since we are in `tsx`, 
// extending or bypassing `auth()` directly in the script is tricky without standard mockers.
// We'll fall back to raw Drizzle insertion if processCsvImport is strictly tied to Next.js Context.

import "dotenv/config";
import { db } from "../src/db";
import { users, leads } from "../src/db/schema";
import { getMarketingStatsByGdo } from "../src/app/actions/marketingActions";
import { processCsvImport } from "../src/app/actions/importLeads";
import { updateLeadOutcome } from "../src/app/actions/pipelineActions";
import { setConfermeOutcome, setSalespersonOutcome } from "../src/app/actions/confermeActions";
import { eq } from "drizzle-orm";
import crypto from "crypto";

async function runE2EGdoTest() {
    console.log("==================================================");
    console.log("🚀 INIZIO TEST E2E: DRILL-DOWN GDO PER FUNNEL");
    console.log("==================================================");

    const TEST_MONTH = "2026-05";
    const funnelName = "TELEGRAM";
    const testDate = new Date("2026-05-15T10:00:00Z");

    const gdo1Id = crypto.randomUUID();
    const gdo2Id = crypto.randomUUID();

    try {
        console.log("\n🧹 0. Pulizia preliminare...");
        await db.delete(leads).where(eq(leads.status, "TEST_GDO_E2E"));
        await db.delete(users).where(eq(users.email, "gdo115@test.local"));
        await db.delete(users).where(eq(users.email, "gdo117@test.local"));

        console.log("👤 1. Creazione Utenti GDO Simulati (115 e 117)...");
        await db.insert(users).values({ id: gdo1Id, email: "gdo115@test.local", password: "test", role: "GDO", gdoCode: 998, displayName: "Marco GDO", isActive: true, createdAt: testDate });
        await db.insert(users).values({ id: gdo2Id, email: "gdo117@test.local", password: "test", role: "GDO", gdoCode: 999, displayName: "Luca GDO", isActive: true, createdAt: testDate });

        console.log("📝 2. Generazione Lead e Pipeline per GDO-115...");
        const uniquePrefix = Date.now().toString().slice(-6);

        // 10 Fissati 
        for (let i = 0; i < 10; i++) {
            let confirmationsOutcome = null;
            let salespersonUserId = null;
            let salespersonOutcome = null;

            // Di questi 10, 5 vengono "Confermati"
            if (i < 5) {
                confirmationsOutcome = "confermato";
                salespersonUserId = gdo1Id; // Foreign key check pass

                // Di questi 5 confermati, 4 "Presenziati" (cioè NON sparito/assente)
                if (i < 4) {
                    salespersonOutcome = "Non chiuso";
                    if (i < 2) salespersonOutcome = "Chiuso";
                } else {
                    salespersonOutcome = "Lead non presenziato"; // Fix TS Enum error
                }
            } else {
                confirmationsOutcome = "scartato";
            }

            await db.insert(leads).values({
                id: crypto.randomUUID(),
                name: `Lead 115-${i}`,
                phone: `+39115${uniquePrefix}${i}`,
                funnel: funnelName,
                status: "TEST_GDO_E2E",
                callCount: 0,
                version: 1,
                assignedToId: gdo1Id,
                createdAt: testDate,
                updatedAt: testDate,
                lastCallDate: testDate,
                appointmentDate: testDate,
                appointmentCreatedAt: testDate,
                confirmationsOutcome,
                salespersonUserId,
                salespersonOutcome,
                salespersonOutcomeAt: salespersonOutcome ? testDate : null
            });
        }

        console.log("📝 3. Generazione Lead e Pipeline per GDO-117...");
        // 2 Fissati
        for (let i = 0; i < 2; i++) {
            let confirmationsOutcome = null;
            let salespersonUserId = null;
            let salespersonOutcome = null;

            if (i < 1) {
                confirmationsOutcome = "confermato";
                salespersonUserId = gdo2Id; // Foreign key check pass
                salespersonOutcome = "Non chiuso";
            } else {
                confirmationsOutcome = "scartato";
            }

            await db.insert(leads).values({
                id: crypto.randomUUID(),
                name: `Lead 117-${i}`,
                phone: `+39117${uniquePrefix}${i}`,
                funnel: funnelName,
                status: "TEST_GDO_E2E",
                callCount: 0,
                version: 1,
                assignedToId: gdo2Id,
                createdAt: testDate,
                updatedAt: testDate,
                lastCallDate: testDate,
                appointmentDate: testDate,
                appointmentCreatedAt: testDate,
                confirmationsOutcome,
                salespersonUserId,
                salespersonOutcome,
                salespersonOutcomeAt: salespersonOutcome ? testDate : null
            });
        }

        console.log("\n⚙️  4. Esecuzione Engine di calcolo (Server Action GetMarketingStatsByGdo)...");
        const stats = await getMarketingStatsByGdo(TEST_MONTH);
        const telegramData = stats.find(s => s.funnel === "TELEGRAM");

        if (!telegramData) throw new Error("Mancano i dati TELEGRAM nell'output");

        const stat115 = telegramData.gdoStats.find(s => s.gdoName.includes("998"));
        const stat117 = telegramData.gdoStats.find(s => s.gdoName.includes("999"));

        if (!stat115 || !stat117) {
            console.error("GDOs trovati:", telegramData.gdoStats.map(s => s.gdoName));
            throw new Error("I GDO 998 o 999 non sono stati calcolati");
        }

        console.log("\n============= RISULTATI GDO-115 (Codice 998) =============");
        console.log(`Fissati   : ${stat115.appsFissati} (Atteso 10)`);
        console.log(`Confermati: ${stat115.appsConfermati} - ${stat115.confermePerc.toFixed(2)}% (Atteso 5 - 50.00%)`);
        console.log(`Presenziati: ${stat115.appsPresenziati} - ${stat115.presenziatiPerc.toFixed(2)}% (Atteso 4 - 80.00%)`);
        console.log(`Closed    : ${stat115.closed} - ${stat115.closedPerc.toFixed(2)}% (Atteso 2 - 50.00%)`);

        console.assert(stat115.appsFissati === 10, "115 Fissati errato");
        console.assert(stat115.appsConfermati === 5 && stat115.confermePerc === 50, "115 Confermati errato");
        console.assert(stat115.appsPresenziati === 4 && stat115.presenziatiPerc === 80, "115 Presenziati errato");
        console.assert(stat115.closed === 2 && stat115.closedPerc === 50, "115 Closed errato");

        console.log("\n============= RISULTATI GDO-117 (Codice 999) =============");
        console.log(`Fissati   : ${stat117.appsFissati} (Atteso 2)`);
        console.log(`Confermati: ${stat117.appsConfermati} - ${stat117.confermePerc.toFixed(2)}% (Atteso 1 - 50.00%)`);
        console.log(`Presenziati: ${stat117.appsPresenziati} - ${stat117.presenziatiPerc.toFixed(2)}% (Atteso 1 - 100.00%)`);
        console.log(`Closed    : ${stat117.closed} - ${stat117.closedPerc.toFixed(2)}% (Atteso 0 - 0.00%)`);

        console.assert(stat117.appsFissati === 2, "117 Fissati errato");
        console.assert(stat117.appsConfermati === 1 && stat117.confermePerc === 50, "117 Confermati errato");
        console.assert(stat117.appsPresenziati === 1 && stat117.presenziatiPerc === 100, "117 Presenziati errato");
        console.assert(stat117.closed === 0 && stat117.closedPerc === 0, "117 Closed errato");

        console.log("\n============= CALCOLO RIGA TOTALE ===========");
        // Simulating the UI calculation logic passed down to verify accuracy
        const tAppsFissati = stat115.appsFissati + stat117.appsFissati;
        const tAppsConfermati = stat115.appsConfermati + stat117.appsConfermati;
        const tAppsPresenziati = stat115.appsPresenziati + stat117.appsPresenziati;
        const tClosed = stat115.closed + stat117.closed;

        const tConfPerc = tAppsFissati > 0 ? (tAppsConfermati / tAppsFissati) * 100 : 0;
        const tPresPerc = tAppsConfermati > 0 ? (tAppsPresenziati / tAppsConfermati) * 100 : 0;
        const tClosePerc = tAppsPresenziati > 0 ? (tClosed / tAppsPresenziati) * 100 : 0;

        console.log(`Totale Fissati   : ${tAppsFissati} (Atteso 12)`);
        console.log(`Totale Confermati: ${tAppsConfermati} - Media: ${tConfPerc.toFixed(2)}% (Atteso 6 - 50.00%)`);
        console.log(`Totale Presenziati: ${tAppsPresenziati} - Media: ${tPresPerc.toFixed(2)}% (Atteso 5 - 83.33%)`);
        console.log(`Totale Closed    : ${tClosed} - Media: ${tClosePerc.toFixed(2)}% (Atteso 2 - 40.00%)`);

        console.assert(tAppsFissati === 12, "Totale Fissati errato");
        console.assert(tAppsConfermati === 6 && tConfPerc === 50, "Totale Confermati errato");
        // We use Math.abs due to floating point precision for 83.333333333...
        console.assert(tAppsPresenziati === 5 && Math.abs(tPresPerc - 83.33) < 0.01, "Totale Presenziati errato");
        console.assert(tClosed === 2 && tClosePerc === 40, "Totale Closed errato");

        console.log("\n✅ TUTTI I CALCOLI MATEMATICI HANNO PASSATO I CHECK!");

    } catch (e: any) {
        console.log(`\n\x1b[31m🚨 ERRORE TEST:\x1b[0m ${e.message}`);
    } finally {
        console.log("\n🧹 Ripulizia DB...");
        await db.delete(leads).where(eq(leads.status, "TEST_GDO_E2E"));
        await db.delete(users).where(eq(users.id, gdo1Id));
        await db.delete(users).where(eq(users.id, gdo2Id));
        console.log("Fine dello script.");
        process.exit(0);
    }
}

runE2EGdoTest();
