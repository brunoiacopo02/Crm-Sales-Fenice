import "dotenv/config";
import { db } from "../src/db";
import { leads, marketingBudgets, users } from "../src/db/schema";
import { eq, gte, lte } from "drizzle-orm";
import { getMarketingStats, saveMarketingBudget } from "../src/app/actions/marketingActions";
import crypto from "crypto";

async function runDebug() {
    console.log("=========================================");
    console.log("Inizio TEST Debug Marketing Analytics...");
    console.log("=========================================");

    // We use a future test month to isolate our testing data
    const TEST_MONTH = "2099-01";
    // We manually pick dates in 2099-01
    const createdAt = new Date("2099-01-15T10:00:00Z");

    try {
        console.log(`\n1. Pulizia dei vecchi dati di test per il mese ${TEST_MONTH}...`);
        await db.delete(marketingBudgets).where(eq(marketingBudgets.month, TEST_MONTH));
        await db.delete(leads).where(
            eq(leads.status, "TEST_DEBUG")
        );

        console.log("\n2. Inserimento Spesa Budget (200€) per TELEGRAM...");
        await saveMarketingBudget("TELEGRAM", TEST_MONTH, 200);

        console.log("\n3. Creazione di 10 TEST LEAD per il funnel TELEGRAM...");

        // Fetch a valid user ID for fake assignment
        const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
        const validUserId = existingUsers.length > 0 ? existingUsers[0].id : null;

        const testLeadsToInsert = [];

        // - 5 NO appuntamento
        for (let i = 0; i < 5; i++) {
            testLeadsToInsert.push({
                id: crypto.randomUUID(),
                name: `Test Lead NoApp ${i}`,
                phone: `+39999000${i}`,
                funnel: "TELEGRAM",
                status: "TEST_DEBUG",
                createdAt: createdAt,
                updatedAt: createdAt,
            });
        }

        // - 5 SI appuntamento
        //    Di questi 5, 2 non confermati
        for (let i = 5; i < 7; i++) {
            testLeadsToInsert.push({
                id: crypto.randomUUID(),
                name: `Test Lead AppNoConf ${i}`,
                phone: `+39999000${i}`,
                funnel: "TELEGRAM",
                status: "TEST_DEBUG",
                appointmentDate: createdAt,
                confirmationsOutcome: "Scartato", // Non confermato
                createdAt: createdAt,
                updatedAt: createdAt,
            });
        }

        //    Di questi 5, 3 confermati
        //       Di questi 3 confermati: 1 'Sparito'
        testLeadsToInsert.push({
            id: crypto.randomUUID(),
            name: `Test Lead ConfSparito 7`,
            phone: `+399990007`,
            funnel: "TELEGRAM",
            status: "TEST_DEBUG",
            appointmentDate: createdAt,
            confirmationsOutcome: "Confermato",
            salespersonUserId: validUserId, // Simuliamo assegnazione legittima o null
            salespersonOutcome: "Sparito", // Sparito, NO Trattativa
            createdAt: createdAt,
            updatedAt: createdAt,
        });

        //       Di questi 3 confermati: 2 fan 'Trattativa'
        //          Di queste 2 trattative: 1 KO
        testLeadsToInsert.push({
            id: crypto.randomUUID(),
            name: `Test Lead TrattativaKO 8`,
            phone: `+399990008`,
            funnel: "TELEGRAM",
            status: "TEST_DEBUG",
            appointmentDate: createdAt,
            confirmationsOutcome: "Confermato",
            salespersonUserId: validUserId,
            salespersonOutcome: "Non chiuso", // Show-up effettuato, non KO-Assente
            createdAt: createdAt,
            updatedAt: createdAt,
        });

        //          Di queste 2 trattative: 1 'Chiuso' a 1000€
        testLeadsToInsert.push({
            id: crypto.randomUUID(),
            name: `Test Lead TrattativaOK 9`,
            phone: `+399990009`,
            funnel: "TELEGRAM",
            status: "TEST_DEBUG",
            appointmentDate: createdAt,
            confirmationsOutcome: "Confermato",
            salespersonUserId: validUserId,
            salespersonOutcome: "Chiuso", // Show-up effettuato e CHIUSO
            closeAmountEur: 1000,
            createdAt: createdAt,
            updatedAt: createdAt,
        });

        await db.insert(leads).values(testLeadsToInsert);

        console.log("\n4. Esecuzione del calcolo Statistiche (Server Action)...");
        const stats = await getMarketingStats(TEST_MONTH);

        console.log("\n---------------------------------------------------------");
        console.log("RISULTATI OTTENUTI (Solo TELEGRAM mostrato o con dati):");
        console.table(
            stats
                .filter(s => s.leads > 0 || s.funnel === "TELEGRAM")
                .map(s => ({
                    Funnel: s.funnel,
                    Lead: s.leads,
                    App: s.apps,
                    "App %": s.appsPerc + "%",
                    Conferme: s.conferme,
                    "Conf %": s.confermePerc + "%",
                    Trattative: s.trattative,
                    "Tratt %": s.trattativePerc + "%",
                    Chiuse: s.close,
                    "Chiuse %": s.closePerc + "%",
                    Spesa: s.spentAmountEur + "€",
                    Fatturato: s.fatturato + "€",
                    "ROAS %": s.roas + "%"
                }))
        );
        console.log("---------------------------------------------------------");

        // Verifica finale Automatica
        const telegramStats = stats.find(s => s.funnel === "TELEGRAM");
        if (telegramStats) {
            let passed = true;
            if (telegramStats.leads !== 10) { console.error("❌ ERRORE: Lead totali dovrebbero essere 10"); passed = false; }
            if (telegramStats.apps !== 5) { console.error("❌ ERRORE: App totali dovrebbero essere 5"); passed = false; }
            if (telegramStats.conferme !== 3) { console.error("❌ ERRORE: Conferme totali dovrebbero essere 3"); passed = false; }
            if (telegramStats.trattative !== 2) { console.error("❌ ERRORE: Trattative totali dovrebbero essere 2"); passed = false; }
            if (telegramStats.close !== 1) { console.error("❌ ERRORE: Chiusure totali dovrebbero essere 1"); passed = false; }
            if (telegramStats.fatturato !== 1000) { console.error("❌ ERRORE: Fatturato dovrebbe essere 1000"); passed = false; }
            if (telegramStats.spentAmountEur !== 200) { console.error("❌ ERRORE: Spesa dovrebbe essere 200"); passed = false; }

            // ROAS = ((1000 - 200) / 200) * 100 = 800 / 200 * 100 = 400%
            if (telegramStats.roas !== 400) { console.error("❌ ERRORE MATEMATICO: Il ROAS calcolato non è 400%. Ricevuto:", telegramStats.roas); passed = false; }

            if (passed) {
                console.log("✅ TEST SUPERATO (ROAS AL 400% e tutte le casistiche verificate)");
            } else {
                console.log("🚨 TEST FALLITO, guarda gli errori sopra.");
            }
        }

    } catch (e) {
        console.error("Errore fatale nel runDebug:", e);
    } finally {
        // Cleanup test data
        console.log("\n5. Pulizia ed eliminazione dati di test...");
        await db.delete(marketingBudgets).where(eq(marketingBudgets.month, TEST_MONTH));
        await db.delete(leads).where(eq(leads.status, "TEST_DEBUG"));
        console.log("Finito!");
        process.exit(0);
    }
}

runDebug();
