import 'dotenv/config';
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { awardXpAndCoins } from "../src/lib/gamificationEngine";
import { getGdoRpgProfile } from "../src/app/actions/rpgProfileActions";

async function main() {
    console.log("=== STARTING RPG ENGINE TEST ===");

    // Create a mock GDO
    const mockGdoId = "TEST-GDO-" + Date.now();
    await db.insert(users).values({
        id: mockGdoId,
        password: 'hashedpassword',
        role: 'GDO',
        isActive: true,
        displayName: 'GDO Eroe',
        level: 1,
        experience: 0,
        coins: 0
    });

    console.log(`[1] Creato GDO (Livello 1, 0 XP, 0 Coins) ID: ${mockGdoId}`);

    // Azione 1: Fissato (+10 XP)
    await awardXpAndCoins(mockGdoId, "FISSATO");
    let u = (await db.select().from(users).where(eq(users.id, mockGdoId)))[0];
    console.log(`[2] Dopo FISSATO -> Lvl: ${u.level}, XP: ${u.experience}, Coins: ${u.coins}`);
    if (u.experience !== 10) throw new Error("XP non assegnato correttamente per FISSATO");

    // Azione 2: Presenziato (+50 XP) x 2 -> totale 110 XP (Level UP! 100 XP target for Lv 1)
    await awardXpAndCoins(mockGdoId, "PRESENZIATO");
    await awardXpAndCoins(mockGdoId, "PRESENZIATO");
    u = (await db.select().from(users).where(eq(users.id, mockGdoId)))[0];
    console.log(`[3] Dopo 2x PRESENZIATO -> Lvl: ${u.level}, XP: ${u.experience}, Coins: ${u.coins}`);
    if (u.level < 2) throw new Error("Livello non aumentato dopo 110 XP accumulati!");

    // Azione 3: Chiuso (+200 XP, +50 Coins)
    await awardXpAndCoins(mockGdoId, "CHIUSO");
    u = (await db.select().from(users).where(eq(users.id, mockGdoId)))[0];
    console.log(`[4] Dopo CHIUSO -> Lvl: ${u.level}, XP: ${u.experience}, Coins: ${u.coins}`);
    if (u.coins < 50) throw new Error("Coins non assegnati per CHIUSO!");

    // Check Lobby Profile View
    // Note: getGdoRpgProfile internally calls getCurrentGdoGamificationState which creates records.
    const profile = await getGdoRpgProfile(mockGdoId);
    console.log(`[5] GDO RPG Profile API -> Stage: ${profile.stage.name}, Target Next XP: ${profile.targetXpForNext}`);

    // Clean up
    await db.delete(users).where(eq(users.id, mockGdoId));
    console.log("=== TEST COMPLETATO CON SUCCESSO ===");
    process.exit(0);
}

main().catch(err => {
    console.error("Test Fallito:", err);
    process.exit(1);
});
