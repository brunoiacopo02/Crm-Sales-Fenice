import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    try {
        console.log("Migrazione indici database...");

        // --- LEADS TABLE: missing indexes ---

        // confirmationsOutcome index (Conferme dashboard queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "confirmations_outcome_idx"
            ON "leads" ("confirmationsOutcome")
        `);
        console.log("✓ confirmations_outcome_idx");

        // Composite: assignedToId + status (pipeline queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "assigned_status_idx"
            ON "leads" ("assignedToId", "status")
        `);
        console.log("✓ assigned_status_idx");

        // Composite: assignedToId + recallDate (recall queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "assigned_recall_idx"
            ON "leads" ("assignedToId", "recallDate")
        `);
        console.log("✓ assigned_recall_idx");

        // --- CALLLOGS TABLE ---

        // userId index (KPI per-user queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "calllogs_user_id_idx"
            ON "callLogs" ("userId")
        `);
        console.log("✓ calllogs_user_id_idx");

        // Composite: userId + createdAt (KPI time-filtered queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "calllogs_user_created_at_idx"
            ON "callLogs" ("userId", "createdAt")
        `);
        console.log("✓ calllogs_user_created_at_idx");

        // --- LEADEVENTS TABLE ---

        // leadId index (timeline queries per lead)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "lead_events_lead_id_idx"
            ON "leadEvents" ("leadId")
        `);
        console.log("✓ lead_events_lead_id_idx");

        // userId index (user activity queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "lead_events_user_id_idx"
            ON "leadEvents" ("userId")
        `);
        console.log("✓ lead_events_user_id_idx");

        // --- USERACHIEVEMENTS TABLE ---

        // userId index (achievement queries per user)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "user_achievements_user_id_idx"
            ON "userAchievements" ("userId")
        `);
        console.log("✓ user_achievements_user_id_idx");

        // --- QUESTPROGRESS TABLE ---

        // userId index (quest queries per user)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "quest_progress_user_id_idx"
            ON "questProgress" ("userId")
        `);
        console.log("✓ quest_progress_user_id_idx");

        // Composite: userId + dateScope (quest progress by period)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "quest_progress_user_date_idx"
            ON "questProgress" ("userId", "dateScope")
        `);
        console.log("✓ quest_progress_user_date_idx");

        // --- USERCREATURES TABLE ---

        // userId index (creature inventory queries)
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "user_creatures_user_id_idx"
            ON "userCreatures" ("userId")
        `);
        console.log("✓ user_creatures_user_id_idx");

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
