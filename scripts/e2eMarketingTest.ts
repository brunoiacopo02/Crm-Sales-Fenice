import "dotenv/config";
process.env.E2E_CLI_MODE = 'true';

import { db } from "../src/db";
import { users, leads } from "../src/db/schema";
import { getMarketingStats, saveMarketingBudget } from "../src/app/actions/marketingActions";
import { processCsvImport } from "../src/app/actions/importLeads";
import { updateLeadOutcome } from "../src/app/actions/pipelineActions";
import { setConfermeOutcome, setSalespersonOutcome } from "../src/app/actions/confermeActions";
import { eq, or } from "drizzle-orm";
import crypto from "crypto";

async function runE2E() {
    console.log("==================================================");
    console.log("🚀 INIZIO TEST END-TO-END MARKETING ANALYTICS Real Actions");
    console.log("==================================================");

    const TEST_MONTH = "2026-04"; // Mese di test pulito
    const funnelName = "TELEGRAM";

    // 0. Cerco un utente reale da usare come "GDO" / "Venditore" per bypassare vincoli FK.
    const userList = await db.select({ id: users.id }).from(users).limit(1);
    const validUserId = userList.length > 0 ? userList[0].id : crypto.randomUUID();
    process.env.E2E_USER_ID = validUserId; // Applica all'auth bypass

    // Pulizia
    console.log("🧹 Pulizia di vecchi test data E2E...");
    await db.delete(leads).where(
        or(
            eq(leads.phone, "+390001112223"),
            eq(leads.phone, "+390001112224")
        )
    );

    try {
        // ========== STEP 1: CARICAMENTO DEI LEAD ==========
        console.log(`\n▶️ Step 1: Il Marketing carica 2 Lead in ${funnelName}`);

        await processCsvImport([
            { rowIndex: 1, nome: "Marco E2E Test", telefono: "+390001112223", email: "marco@e2e.test", cognome: funnelName },
            { rowIndex: 2, nome: "Luca E2E Test Due", telefono: "+390001112224", email: "luca@e2e.test", cognome: funnelName }
        ]);

        // Poichè i manual inserts creano i leads, prendiamoli
        const testLeads = await db.select().from(leads).where(eq(leads.phone, "+390001112223"));
        const testLead2 = await db.select().from(leads).where(eq(leads.phone, "+390001112224"));
        const leadId = testLeads[0].id;
        const leadId2 = testLead2[0].id;

        // Modifica temporanea date per farle cadere nel mese corretto di test (Aprile 2026) -> solo per test
        const aprilDate = new Date("2026-04-10T10:00:00Z");
        await db.update(leads).set({ createdAt: aprilDate }).where(eq(leads.id, leadId));
        await db.update(leads).set({ createdAt: aprilDate }).where(eq(leads.id, leadId2));

        let stats = await getMarketingStats(TEST_MONTH);
        let teleStats = stats.find(s => s.funnel === funnelName);
        console.log(`   Verifica: LEAD=${teleStats?.leads} (Atteso: >=2)`);
        if (!teleStats || teleStats.leads < 2) throw new Error("Step 1 Fallito: Mismatch LEAD count");
        console.log("✅ Step 1 completato: Dati allineati");


        // ========== STEP 2: APPUNTAMENTO GDO ==========
        console.log(`\n▶️ Step 2: Il GDO fissa un appuntamento per ${leadId}`);
        await updateLeadOutcome(leadId, 'APPUNTAMENTO', 'Test meeting in arrivo', aprilDate);

        stats = await getMarketingStats(TEST_MONTH);
        teleStats = stats.find(s => s.funnel === funnelName);
        const baselineLeads = teleStats?.leads || 2;
        console.log(`   Verifica: APP=${teleStats?.apps} (Atteso: >= 1), APP%=${teleStats?.appsPerc}%`);
        if (!teleStats || teleStats.apps < 1 || teleStats.appsPerc !== (teleStats.apps / baselineLeads * 100)) throw new Error("Step 2 Fallito: Mismatch APP count or Percentage");
        console.log("✅ Step 2 completato: Dati allineati");


        // ========== STEP 3: CONFERMA APPUNTAMENTO ==========
        console.log(`\n▶️ Step 3: Reparto Conferme imposta Esito: Confermato`);
        // We need the current version integer realistically. Re-fetch.
        let l = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
        await setConfermeOutcome(leadId, l[0].version, "confermato", "", validUserId); // Spingiamo il fake User

        stats = await getMarketingStats(TEST_MONTH);
        teleStats = stats.find(s => s.funnel === funnelName);
        console.log(`   Verifica: CONFERME=${teleStats?.conferme} (Atteso: >= 1), CONF%=${teleStats?.confermePerc}%`);
        if (!teleStats || teleStats.conferme < 1) throw new Error("Step 3 Fallito: Mismatch Conferme count");
        console.log("✅ Step 3 completato: Dati allineati");


        // ========== STEP 4.A: VENDITORE - TRATTATIVA IN CORSO ==========
        console.log(`\n▶️ Step 4.a: Il Venditore imposta esito provvisorio "Non chiuso" per registrare lo Show-up`);
        l = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
        await setSalespersonOutcome(leadId, l[0].version, "Non chiuso", "Ci deve pensare");

        stats = await getMarketingStats(TEST_MONTH);
        teleStats = stats.find(s => s.funnel === funnelName);
        console.log(`   Verifica (pre-close): TRATT=${teleStats?.trattative}, CLOSE=${teleStats?.close}`);
        if (!teleStats || teleStats.trattative < 1 || teleStats.close !== 0) throw new Error("Step 4.a Fallito: Mismatch Trattative o Close Count errato");
        console.log("✅ Step 4.a completato: Trattativa registrata senza Chiusura");


        // ========== STEP 4.B: VENDITORE - CLOSE ==========
        console.log(`\n▶️ Step 4.b: Il Venditore chiude. Esito "Chiuso" a 500€`);
        l = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
        // We also need to manually patch closeAmountEur directly as there isn't an exposed public action explicitly in the flow for setting amount outside form components
        await db.update(leads).set({ closeAmountEur: 500 }).where(eq(leads.id, leadId));
        await setSalespersonOutcome(leadId, l[0].version, "Chiuso", "Accettato deal Gold");

        stats = await getMarketingStats(TEST_MONTH);
        teleStats = stats.find(s => s.funnel === funnelName);
        console.log(`   Verifica (post-close): TRATT=${teleStats?.trattative}, CLOSE=${teleStats?.close}, FATTURATO=${teleStats?.fatturato}€`);
        if (!teleStats || teleStats.trattative < 1 || teleStats.close < 1 || teleStats.fatturato < 500) throw new Error("Step 4.b Fallito: Mismatch su chiusure o fatturato");
        console.log("✅ Step 4.b completato: Dati allineati");


        // ========== STEP 5: BUDGET E ROAS ==========
        console.log(`\n▶️ Step 5: Il Manager inserisce Budget. Spesa "250€" nel Mese`);
        await saveMarketingBudget(funnelName, TEST_MONTH, 250);

        stats = await getMarketingStats(TEST_MONTH);
        teleStats = stats.find(s => s.funnel === funnelName);
        console.log(`   Verifica finale ROAS: Spesa=${teleStats?.spentAmountEur}€, Fatturato=${teleStats?.fatturato}€ -> ROAS Atteso: 100%, Ottenuto: ${teleStats?.roas}%`);
        if (!teleStats || teleStats.roas !== 100) throw new Error(`Step 5 Fallito: ROAS mismatch. Formula errata. Ricevuto: ${teleStats?.roas}`);
        console.log("✅ Step 5 completato: Dati allineati");

        console.log("\n====== TUTTI I TEST SUPERATI CON SUCCESSO ======\n");

    } catch (e: any) {
        console.log(`\n\x1b[31m🚨 FALLIMENTO TEST:\x1b[0m ${e.message}\n`);
    } finally {
        console.log("🧹 Ripulizia DB...");
        const oldL = await db.select().from(leads).where(eq(leads.phone, "+390001112223"));
        if (oldL[0]) await db.delete(leads).where(eq(leads.id, oldL[0].id));
        const oldL2 = await db.select().from(leads).where(eq(leads.phone, "+390001112224"));
        if (oldL2[0]) await db.delete(leads).where(eq(leads.id, oldL2[0].id));
        console.log("Fine dello script.");
        process.exit(0);
    }
}

runE2E();
