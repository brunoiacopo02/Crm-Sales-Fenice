import { NextResponse } from 'next/server';
import { db } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
    try {
        console.log("Migrazione Fenice Universe — creatures, userCreatures, adventureProgress, adventureBosses, actionChests...");

        // 1. creatures
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "creatures" (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                rarity TEXT NOT NULL,
                element TEXT NOT NULL,
                "imageUrl" TEXT,
                "baseXpBonus" REAL NOT NULL,
                "baseCoinBonus" REAL NOT NULL,
                "maxLevel" INTEGER NOT NULL DEFAULT 10,
                "isActive" BOOLEAN NOT NULL DEFAULT TRUE
            )
        `);

        // 2. userCreatures
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "userCreatures" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "creatureId" TEXT NOT NULL REFERENCES creatures(id),
                level INTEGER NOT NULL DEFAULT 1,
                "xpFed" INTEGER NOT NULL DEFAULT 0,
                "isEquipped" BOOLEAN NOT NULL DEFAULT FALSE,
                "obtainedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // 3. adventureProgress
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "adventureProgress" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "currentStage" INTEGER NOT NULL DEFAULT 1,
                "currentBossHp" INTEGER,
                "lastStageCompletedAt" TIMESTAMPTZ
            )
        `);

        // 4. adventureBosses
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "adventureBosses" (
                id TEXT PRIMARY KEY,
                "stageNumber" INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                "imageUrl" TEXT,
                "totalHp" INTEGER NOT NULL,
                element TEXT NOT NULL,
                "rewardCreatureId" TEXT REFERENCES creatures(id),
                "rewardCoins" INTEGER NOT NULL,
                "rewardTitle" TEXT
            )
        `);

        // 5. actionChests
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "actionChests" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "chestType" TEXT NOT NULL,
                "requiredMetric" TEXT NOT NULL,
                "requiredValue" INTEGER NOT NULL,
                "currentValue" INTEGER NOT NULL DEFAULT 0,
                "isReady" BOOLEAN NOT NULL DEFAULT FALSE,
                "openedAt" TIMESTAMPTZ,
                "rewardCreatureId" TEXT REFERENCES creatures(id),
                "rewardCoins" INTEGER
            )
        `);

        // 6. teamRpgProfile
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "teamRpgProfile" (
                id TEXT PRIMARY KEY,
                "teamName" TEXT NOT NULL DEFAULT 'Team Conferme',
                level INTEGER NOT NULL DEFAULT 1,
                "totalXp" INTEGER NOT NULL DEFAULT 0,
                "currentStage" INTEGER NOT NULL DEFAULT 1,
                "currentBossHp" INTEGER,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // 7. teamCreatures
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "teamCreatures" (
                id TEXT PRIMARY KEY,
                "teamId" TEXT NOT NULL REFERENCES "teamRpgProfile"(id),
                "creatureId" TEXT NOT NULL REFERENCES creatures(id),
                level INTEGER NOT NULL DEFAULT 1,
                "xpFed" INTEGER NOT NULL DEFAULT 0,
                "isEquipped" BOOLEAN NOT NULL DEFAULT FALSE,
                "obtainedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "contributedByUserId" TEXT REFERENCES users(id)
            )
        `);

        // 8. tradingOffers
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "tradingOffers" (
                id TEXT PRIMARY KEY,
                "fromUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "toUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "offeredCreatureId" TEXT NOT NULL REFERENCES "userCreatures"(id),
                "requestedCreatureId" TEXT NOT NULL REFERENCES "userCreatures"(id),
                status TEXT NOT NULL DEFAULT 'pending',
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // 9. duels
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "duels" (
                id TEXT PRIMARY KEY,
                "challengerId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                "opponentId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                metric TEXT NOT NULL,
                duration INTEGER NOT NULL,
                "startTime" TIMESTAMPTZ NOT NULL,
                "endTime" TIMESTAMPTZ NOT NULL,
                "challengerScore" INTEGER NOT NULL DEFAULT 0,
                "opponentScore" INTEGER NOT NULL DEFAULT 0,
                "winnerId" TEXT REFERENCES users(id),
                "rewardCoins" INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active'
            )
        `);

        // Indexes
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS user_creatures_user_idx ON "userCreatures" ("userId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS user_creatures_equipped_idx ON "userCreatures" ("userId", "isEquipped") WHERE "isEquipped" = TRUE
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS adventure_progress_user_idx ON "adventureProgress" ("userId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS adventure_bosses_stage_idx ON "adventureBosses" ("stageNumber")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS action_chests_user_idx ON "actionChests" ("userId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS action_chests_ready_idx ON "actionChests" ("userId", "isReady") WHERE "isReady" = TRUE
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS team_creatures_team_idx ON "teamCreatures" ("teamId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS trading_offers_from_idx ON "tradingOffers" ("fromUserId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS trading_offers_to_idx ON "tradingOffers" ("toUserId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS duels_challenger_idx ON "duels" ("challengerId")
        `);
        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS duels_opponent_idx ON "duels" ("opponentId")
        `);

        console.log("Migrazione Fenice Universe completata!");
        return NextResponse.json({ success: true, message: "Fenice Universe migration completed — 9 tables created" });
    } catch (error) {
        console.error("Errore migrazione Fenice Universe:", error);
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
