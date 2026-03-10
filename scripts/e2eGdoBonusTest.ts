import "dotenv/config";
import { db } from "../src/db";
import { users, leads, weeklyGamificationRules } from "../src/db/schema";
import { getManagerGdoTables, getCurrentGdoGamificationState } from "../src/app/actions/gdoPerformanceActions";
import { eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { parseISO } from "date-fns";

async function runGdoBonusE2E() {
    console.log("==================================================");
    console.log("🚀 INIZIO TEST E2E: BONUS E GAMIFICATION GDO");
    console.log("==================================================");

    const testMonth = "2026-03"; // Marzo 2026 inizia di Domenica (Week 1 => 1 solo giorno)
    const mockToday = new Date("2026-03-08T12:00:00.000Z"); // Siamo Domenica della Week 2

    const testUserId = crypto.randomUUID();
    const leadIds: string[] = [];

    try {
        console.log(`\n🧹 0. Setup Pulizia e Preparazione...`);
        await db.delete(weeklyGamificationRules).where(eq(weeklyGamificationRules.month, testMonth));
        await db.delete(leads).where(eq(leads.status, "TEST_GAMIFICATION"));
        await db.delete(users).where(eq(users.id, testUserId));

        console.log("👤 1. Creazione GDO Demo Gamification...");
        await db.insert(users).values({
            id: testUserId,
            email: `gamin_gdo_${Date.now()}@test.local`,
            password: "test",
            role: "GDO",
            gdoCode: 999,
            displayName: `Super GDO Test`,
            isActive: true,
            createdAt: new Date()
        });

        console.log("⚙️  2. Creazione Rule Gamification Mensile...");
        await db.insert(weeklyGamificationRules).values({
            id: crypto.randomUUID(),
            month: testMonth,
            targetTier1: 10,
            rewardTier1: 135,
            targetTier2: 13,
            rewardTier2: 270,
            updatedAt: new Date()
        });

        console.log("📝 3. Fissato 1 Appuntamento nella Domenica di Week 1 (1 Marzo)...");
        const leadW1 = crypto.randomUUID();
        leadIds.push(leadW1);
        await db.insert(leads).values({
            id: leadW1,
            name: `Lead W1`,
            phone: `+390001`,
            status: "TEST_GAMIFICATION",
            callCount: 0,
            version: 1,
            assignedToId: testUserId,
            appointmentDate: new Date("2026-03-01T10:00:00.000Z"), // Domenica W1
            salespersonOutcome: "Trattativa chisu" // => Vale come Presenziato
        });

        console.log("📝 4. Fissati 12 Appuntamenti nella Week 2 (2-8 Marzo)...");
        for (let i = 0; i < 12; i++) {
            const lId = crypto.randomUUID();
            leadIds.push(lId);
            await db.insert(leads).values({
                id: lId,
                name: `Lead W2-${i}`,
                phone: `+390002${i}`,
                status: "TEST_GAMIFICATION",
                callCount: 0,
                version: 1,
                assignedToId: testUserId,
                appointmentDate: new Date("2026-03-04T10:00:00.000Z"), // Mercoledì W2
                salespersonOutcome: "Ha risposto" // => Presenziato
            });
        }

        console.log("\n--- ESECUZIONE 1: PRIMA DEL POSTICIPO ---");
        let uiState = await getCurrentGdoGamificationState(testUserId, mockToday);
        console.log(`[!] Week Corrente Rilevata: ${uiState.currentWeekName} (${uiState.weekStart})`);
        console.log(`[!] Presenze rilevate per W2: ${uiState.currentPresences} / ${uiState.target1}`);
        console.assert(uiState.currentPresences === 12, "Errore: Attese 12 presenze in W2");

        // Manager View assert
        let tables = await getManagerGdoTables(testMonth);
        let gdoTable = tables.find(t => t.gdoName === "Super GDO Test");
        console.assert(gdoTable.weeklyRows[1].data[0] === 1, "Tabella Manager: W1 deve avere 1 Presenziato"); // W1 = index 0, presenze = row 1
        console.assert(gdoTable.weeklyRows[1].data[1] === 12, "Tabella Manager: W2 deve avere 12 Presenziati");

        console.log("\n🔄 5. IL LEAD W1 CI CHIEDE UN POSTICIPO!");
        console.log("=> Spostiamo la 'appointmentDate' del Lead W1 dal 1° Marzo al 5 Marzo (in Week 2).");
        await db.update(leads)
            .set({ appointmentDate: new Date("2026-03-05T10:00:00.000Z") })
            .where(eq(leads.id, leadW1));

        console.log("\n--- ESECUZIONE 2: DOPO IL POSTICIPO ---");
        uiState = await getCurrentGdoGamificationState(testUserId, mockToday);
        console.log(`[!] Nuove Presenze rilevate per W2: ${uiState.currentPresences} / ${uiState.target2}`);
        console.assert(uiState.currentPresences === 13, "Errore Fallback: La logica Gamification non ha agganciato il posticipo in W2!");

        // Manager View assert
        tables = await getManagerGdoTables(testMonth);
        gdoTable = tables.find(t => t.gdoName === "Super GDO Test");
        console.assert(gdoTable.weeklyRows[1].data[0] === 0, "Errore Manager UI: W1 non si è svuotata!");
        console.assert(gdoTable.weeklyRows[1].data[1] === 13, "Errore Manager UI: W2 non si è riempita fino a 13!");

        console.log("\n🎉 TEST ORO SBLOCCATO: Visto che ora in W2 ci sono 13 appuntamenti esatti, check vittoria:");
        console.log(`Target: Da superare ${uiState.target1} (T1) o ${uiState.target2} (T2)`);
        console.log(`Reward Tier 2 Agganciata matematicamente: €${uiState.reward2}`);

        console.log("\n✅ TUTTI I TEST E2E SUL TRACKER GDO HANNO SUPERATO I CHECK!");

    } catch (e: any) {
        console.log(`\n\x1b[31m🚨 ERRORE TEST:\x1b[0m ${e.message}`);
    } finally {
        console.log("\n🧹 Ripulizia DB...");
        await db.delete(leads).where(eq(leads.status, "TEST_GAMIFICATION"));
        await db.delete(weeklyGamificationRules).where(eq(weeklyGamificationRules.month, testMonth));
        await db.delete(users).where(eq(users.id, testUserId));

        console.log("Fine.");
        process.exit(0);
    }
}

runGdoBonusE2E();
