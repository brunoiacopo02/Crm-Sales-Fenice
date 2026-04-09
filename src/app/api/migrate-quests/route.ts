import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        // Create quests table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS quests (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                type TEXT NOT NULL,
                "targetMetric" TEXT NOT NULL,
                "targetValue" INTEGER NOT NULL,
                "rewardXp" INTEGER NOT NULL,
                "rewardCoins" INTEGER NOT NULL,
                "isActive" BOOLEAN NOT NULL DEFAULT true,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // Create questProgress table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "questProgress" (
                id TEXT PRIMARY KEY,
                "questId" TEXT NOT NULL REFERENCES quests(id),
                "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "currentValue" INTEGER NOT NULL DEFAULT 0,
                completed BOOLEAN NOT NULL DEFAULT false,
                "completedAt" TIMESTAMPTZ,
                "dateScope" TEXT NOT NULL,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // Add indexes for performance
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS quest_progress_user_scope_idx
            ON "questProgress" ("userId", "dateScope")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS quest_progress_quest_idx
            ON "questProgress" ("questId")
        `);

        // Seed default quest templates
        await db.execute(sql`
            INSERT INTO quests (id, title, description, type, "targetMetric", "targetValue", "rewardXp", "rewardCoins", "isActive")
            VALUES
                ('quest-d-calls-30', 'Telefonista Veloce', 'Effettua 30 chiamate oggi', 'daily', 'calls_made', 30, 15, 10, true),
                ('quest-d-calls-50', 'Maratoneta del Telefono', 'Effettua 50 chiamate oggi', 'daily', 'calls_made', 50, 30, 20, true),
                ('quest-d-calls-80', 'Inferno Telefonico', 'Effettua 80 chiamate oggi', 'daily', 'calls_made', 80, 60, 40, true),
                ('quest-d-appt-1', 'Primo Fissaggio', 'Fissa almeno 1 appuntamento oggi', 'daily', 'appointments_set', 1, 10, 10, true),
                ('quest-d-appt-3', 'Trittico Vincente', 'Fissa 3 appuntamenti oggi', 'daily', 'appointments_set', 3, 40, 30, true),
                ('quest-d-appt-5', 'Macchina da Fissaggi', 'Fissa 5 appuntamenti oggi', 'daily', 'appointments_set', 5, 80, 50, true),
                ('quest-d-contacts-20', 'Esploratore Lead', 'Contatta 20 lead distinti oggi', 'daily', 'leads_contacted', 20, 20, 15, true),
                ('quest-d-contacts-40', 'Cacciatore di Lead', 'Contatta 40 lead distinti oggi', 'daily', 'leads_contacted', 40, 40, 25, true),
                ('quest-w-calls-200', 'Settimana di Fuoco', 'Effettua 200 chiamate questa settimana', 'weekly', 'calls_made', 200, 100, 50, true),
                ('quest-w-calls-400', 'Leggenda Settimanale', 'Effettua 400 chiamate questa settimana', 'weekly', 'calls_made', 400, 250, 150, true),
                ('quest-w-appt-10', 'Fissatore Seriale', 'Fissa 10 appuntamenti questa settimana', 'weekly', 'appointments_set', 10, 120, 80, true),
                ('quest-w-appt-20', 'Re dei Fissaggi', 'Fissa 20 appuntamenti questa settimana', 'weekly', 'appointments_set', 20, 300, 200, true),
                ('quest-w-contacts-100', 'Rete Ampia', 'Contatta 100 lead distinti questa settimana', 'weekly', 'leads_contacted', 100, 80, 50, true)
            ON CONFLICT (id) DO NOTHING
        `);

        return NextResponse.json({ success: true, message: "Quest system tables created and seeded." });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore migrazione quest:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
