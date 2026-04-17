import { NextResponse } from 'next/server';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export async function GET() {
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Migrations disabled in production' }, { status: 403 });
    }

    try {
        // Create bossBattles table (ADDITIVE)
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "bossBattles" (
                "id" text PRIMARY KEY,
                "title" text NOT NULL,
                "description" text NOT NULL,
                "totalHp" integer NOT NULL,
                "currentHp" integer NOT NULL,
                "rewardCoins" integer NOT NULL,
                "rewardXp" integer NOT NULL DEFAULT 0,
                "startTime" timestamp with time zone NOT NULL,
                "endTime" timestamp with time zone NOT NULL,
                "status" text NOT NULL DEFAULT 'active',
                "createdBy" text REFERENCES "users"("id"),
                "defeatedAt" timestamp with time zone,
                "createdAt" timestamp with time zone NOT NULL DEFAULT now()
            )
        `);

        // Create bossContributions table (ADDITIVE)
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "bossContributions" (
                "id" text PRIMARY KEY,
                "battleId" text NOT NULL REFERENCES "bossBattles"("id"),
                "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
                "damage" integer NOT NULL,
                "action" text NOT NULL,
                "createdAt" timestamp with time zone NOT NULL DEFAULT now()
            )
        `);

        // Indexes for performance
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "boss_battles_status_idx" ON "bossBattles" ("status")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "boss_contributions_battle_idx" ON "bossContributions" ("battleId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS "boss_contributions_user_idx" ON "bossContributions" ("userId")
        `);

        return NextResponse.json({ success: true, message: 'Boss battle tables created successfully' });
    } catch (error: any) {
        console.error('Migration error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
