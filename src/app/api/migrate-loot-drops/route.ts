import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    try {
        console.log("Migrazione loot drops system...");

        // Create lootDrops table
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "lootDrops" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                rarity TEXT NOT NULL,
                "rewardType" TEXT NOT NULL,
                "rewardValue" INTEGER NOT NULL,
                "bonusXp" INTEGER NOT NULL DEFAULT 0,
                "bonusTitle" TEXT,
                opened BOOLEAN NOT NULL DEFAULT FALSE,
                "openedAt" TIMESTAMPTZ,
                "droppedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // Add indexes
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS loot_drops_user_idx
            ON "lootDrops" ("userId")
        `);

        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS loot_drops_unopened_idx
            ON "lootDrops" ("userId", opened)
            WHERE opened = FALSE
        `);

        console.log("Migrazione loot drops completata!");
        return NextResponse.json({ success: true, message: "Loot drops migration completed" });
    } catch (error) {
        console.error("Errore migrazione loot drops:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
