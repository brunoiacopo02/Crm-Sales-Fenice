import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        // Seed 3 script-related achievements (GDO category: script)
        await db.execute(sql`
            INSERT INTO achievements (id, name, description, icon, category, metric, "tier1Target", "tier2Target", "tier3Target")
            VALUES
                ('ach-script-studente', 'Studente Modello', 'Segui lo script durante le chiamate per migliorare le tue performance', 'BookOpen', 'script', 'total_scripts_completed', 10, 50, 200),
                ('ach-script-master', 'Script Master', 'Hai interiorizzato lo script: le parole giuste al momento giusto', 'GraduationCap', 'script', 'total_scripts_completed', 300, 500, 1000),
                ('ach-script-persuasione', 'Maestro della Persuasione', 'Lo script è parte di te: ogni chiamata è un capolavoro', 'Sparkles', 'script', 'total_scripts_completed', 1500, 3000, 5000)
            ON CONFLICT (id) DO NOTHING
        `);

        // Seed 2 script-related quests (1 daily + 1 weekly) for GDO role
        await db.execute(sql`
            INSERT INTO quests (id, title, description, type, "targetMetric", "targetValue", "rewardXp", "rewardCoins", "isActive", role)
            VALUES
                ('quest-d-script-5', 'Seguace dello Script', 'Segui lo script per 5 chiamate oggi', 'daily', 'scripts_completed', 5, 10, 15, true, 'GDO'),
                ('quest-w-script-20', 'Disciplina Settimanale', 'Completa 20 script questa settimana', 'weekly', 'scripts_completed', 20, 30, 50, true, 'GDO')
            ON CONFLICT (id) DO NOTHING
        `);

        return NextResponse.json({
            success: true,
            message: "3 script achievements + 2 script quests seeded successfully."
        });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore migrazione script achievements:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
