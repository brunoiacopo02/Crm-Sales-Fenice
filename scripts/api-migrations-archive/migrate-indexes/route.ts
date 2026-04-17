import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    try {
        // --- LEADS TABLE: missing indexes ---

        // confirmationsOutcome index (Conferme dashboard queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "confirmations_outcome_idx"
            ON "leads" ("confirmationsOutcome")
        `);

        // Composite: assignedToId + status (pipeline queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "assigned_status_idx"
            ON "leads" ("assignedToId", "status")
        `);

        // Composite: assignedToId + recallDate (recall queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "assigned_recall_idx"
            ON "leads" ("assignedToId", "recallDate")
        `);

        // --- CALLLOGS TABLE ---

        // userId index (KPI per-user queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "calllogs_user_id_idx"
            ON "callLogs" ("userId")
        `);

        // Composite: userId + createdAt (KPI time-filtered queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "calllogs_user_created_at_idx"
            ON "callLogs" ("userId", "createdAt")
        `);

        // --- LEADEVENTS TABLE ---

        // leadId index (timeline queries per lead)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "lead_events_lead_id_idx"
            ON "leadEvents" ("leadId")
        `);

        // userId index (user activity queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "lead_events_user_id_idx"
            ON "leadEvents" ("userId")
        `);

        // --- USERACHIEVEMENTS TABLE ---

        // userId index (achievement queries per user)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "user_achievements_user_id_idx"
            ON "userAchievements" ("userId")
        `);

        // --- QUESTPROGRESS TABLE ---

        // userId index (quest queries per user)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "quest_progress_user_id_idx"
            ON "questProgress" ("userId")
        `);

        // Composite: userId + dateScope (quest progress by period)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "quest_progress_user_date_idx"
            ON "questProgress" ("userId", "dateScope")
        `);

        // --- USERCREATURES TABLE ---

        // userId index (creature inventory queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "user_creatures_user_id_idx"
            ON "userCreatures" ("userId")
        `);

        return NextResponse.json({
            success: true,
            message: "Tutti gli indici creati/verificati con successo",
            indexes: [
                "leads: confirmations_outcome_idx",
                "leads: assigned_status_idx (composite)",
                "leads: assigned_recall_idx (composite)",
                "callLogs: calllogs_user_id_idx",
                "callLogs: calllogs_user_created_at_idx (composite)",
                "leadEvents: lead_events_lead_id_idx",
                "leadEvents: lead_events_user_id_idx",
                "userAchievements: user_achievements_user_id_idx",
                "questProgress: quest_progress_user_id_idx",
                "questProgress: quest_progress_user_date_idx (composite)",
                "userCreatures: user_creatures_user_id_idx",
            ]
        });
    } catch (error) {
        console.error("Errore migrazione indici:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
