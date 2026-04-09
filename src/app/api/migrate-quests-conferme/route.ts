import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        console.log("Migrazione quest system Conferme...");

        // 1. Add role column to quests table (default 'GDO' for existing quests)
        await db.execute(sql`
            ALTER TABLE quests ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'GDO'
        `);

        // 2. Seed CONFERME quest templates (5 daily + 3 weekly)
        await db.execute(sql`
            INSERT INTO quests (id, title, description, type, "targetMetric", "targetValue", "rewardXp", "rewardCoins", "isActive", "role")
            VALUES
                ('conf-d-confirm-1', 'Prima Conferma', 'Conferma almeno 1 appuntamento oggi', 'daily', 'conferme_fatte', 1, 15, 10, true, 'CONFERME'),
                ('conf-d-confirm-3', 'Conferme a Raffica', 'Conferma 3 appuntamenti oggi', 'daily', 'conferme_fatte', 3, 40, 30, true, 'CONFERME'),
                ('conf-d-confirm-5', 'Maestro Conferme', 'Conferma 5 appuntamenti oggi', 'daily', 'conferme_fatte', 5, 80, 50, true, 'CONFERME'),
                ('conf-d-calls-8', 'Sentinella Attiva', 'Fai 8 interazioni con i lead oggi', 'daily', 'conferme_chiamate', 8, 15, 10, true, 'CONFERME'),
                ('conf-d-calls-15', 'Operatore Instancabile', 'Fai 15 interazioni con i lead oggi', 'daily', 'conferme_chiamate', 15, 30, 20, true, 'CONFERME'),
                ('conf-d-discard-3', 'Pulizia Rapida', 'Scarta 3 lead non in target oggi', 'daily', 'conferme_scartate', 3, 10, 8, true, 'CONFERME'),
                ('conf-w-confirm-10', 'Settimana da Confermatore', 'Conferma 10 appuntamenti questa settimana', 'weekly', 'conferme_fatte', 10, 120, 80, true, 'CONFERME'),
                ('conf-w-calls-40', 'Settimana Operativa', 'Fai 40 interazioni questa settimana', 'weekly', 'conferme_chiamate', 40, 100, 60, true, 'CONFERME'),
                ('conf-w-confirm-20', 'Re delle Conferme', 'Conferma 20 appuntamenti questa settimana', 'weekly', 'conferme_fatte', 20, 300, 200, true, 'CONFERME')
            ON CONFLICT (id) DO NOTHING
        `);

        console.log("Migrazione quest Conferme completata!");
        return NextResponse.json({ success: true, message: "Quest Conferme: role column added and templates seeded." });
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Errore migrazione quest Conferme:", e);
        return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
    }
}
