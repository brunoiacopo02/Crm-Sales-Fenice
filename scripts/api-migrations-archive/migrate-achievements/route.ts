import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        // Create achievements table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS achievements (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                icon TEXT NOT NULL,
                category TEXT NOT NULL,
                metric TEXT NOT NULL,
                "tier1Target" INTEGER NOT NULL,
                "tier2Target" INTEGER NOT NULL,
                "tier3Target" INTEGER NOT NULL,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // Create userAchievements table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "userAchievements" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "achievementId" TEXT NOT NULL REFERENCES achievements(id),
                tier INTEGER NOT NULL,
                "unlockedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // Add indexes
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS user_achievements_user_idx
            ON "userAchievements" ("userId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS user_achievements_achievement_idx
            ON "userAchievements" ("achievementId")
        `);

        // Seed 15 achievement templates across 7 categories
        await db.execute(sql`
            INSERT INTO achievements (id, name, description, icon, category, metric, "tier1Target", "tier2Target", "tier3Target")
            VALUES
                -- CALLS category (2)
                ('ach-calls-telefonista', 'Telefonista', 'Effettua chiamate per diventare un maestro del telefono', 'Phone', 'calls', 'total_calls', 100, 500, 1000),
                ('ach-calls-centralino', 'Centralino Umano', 'Il telefono è la tua arma: chiamate a raffica!', 'PhoneCall', 'calls', 'total_calls', 2000, 5000, 10000),

                -- APPOINTMENTS category (2)
                ('ach-appt-fissatore', 'Fissatore', 'Fissa appuntamenti come un professionista', 'CalendarCheck', 'appointments', 'total_appointments', 10, 50, 200),
                ('ach-appt-re', 'Re degli Appuntamenti', 'La tua agenda è sempre piena', 'Crown', 'appointments', 'total_appointments', 300, 500, 1000),

                -- STREAK category (2)
                ('ach-streak-costante', 'Costante', 'La costanza paga: mantieni la tua streak', 'Flame', 'streak', 'current_streak', 7, 14, 30),
                ('ach-streak-maratoneta', 'Maratoneta', 'La tua dedizione non ha limiti', 'Zap', 'streak', 'current_streak', 45, 60, 90),

                -- QUESTS category (2)
                ('ach-quest-avventuriero', 'Avventuriero', 'Completa quest per guadagnare esperienza', 'Compass', 'quests', 'total_quests_completed', 10, 50, 200),
                ('ach-quest-cacciatore', 'Cacciatore di Quest', 'Nessuna quest ti sfugge', 'Target', 'quests', 'total_quests_completed', 300, 500, 1000),

                -- LEVEL category (3)
                ('ach-level-recluta', 'Recluta', 'Muovi i primi passi nel mondo Fenice', 'Shield', 'level', 'current_level', 5, 10, 15),
                ('ach-level-veterano', 'Veterano', 'Sei un pilastro del team', 'Sword', 'level', 'current_level', 20, 25, 30),
                ('ach-level-leggenda', 'Leggenda', 'Il tuo nome risuona nella storia', 'Star', 'level', 'current_level', 35, 40, 50),

                -- LEADS CONTACTED category (2)
                ('ach-leads-networker', 'Networker', 'Espandi la tua rete di contatti', 'Users', 'leads', 'total_leads_contacted', 50, 200, 500),
                ('ach-leads-ragno', 'Ragno della Rete', 'Nessun lead sfugge alla tua rete', 'Globe', 'leads', 'total_leads_contacted', 1000, 2000, 5000),

                -- COINS category (2)
                ('ach-coins-collezionista', 'Collezionista', 'Accumula Fenice Coins senza sosta', 'Coins', 'coins', 'total_coins_earned', 500, 2000, 5000),
                ('ach-coins-paperon', 'Paperon de'' Paperoni', 'La tua ricchezza è leggendaria', 'Gem', 'coins', 'total_coins_earned', 10000, 25000, 50000)
            ON CONFLICT (id) DO NOTHING
        `);

        return NextResponse.json({ success: true, message: "Achievement system tables created and 15 achievements seeded." });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore migrazione achievements:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
