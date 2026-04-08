import pg from 'pg';
import { config } from 'dotenv';
config();
const { Client } = pg;

// Use Supabase pooler (IPv4 compatible) instead of direct connection
const dbUrl = process.env.DATABASE_URL!.replace('db.', 'aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&').replace(':5432/postgres', '');
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// Force IPv4
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const migrations = [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS "streakCount" INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastStreakDate" TEXT',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS "activeTitle" TEXT',
  `CREATE TABLE IF NOT EXISTS quests (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'daily',
    "targetMetric" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL DEFAULT 1,
    "rewardXp" INTEGER NOT NULL DEFAULT 10,
    "rewardCoins" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true
  )`,
  `CREATE TABLE IF NOT EXISTS "questProgress" (
    id TEXT PRIMARY KEY,
    "questId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ,
    "dateScope" TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT 'trophy',
    category TEXT DEFAULT 'general',
    metric TEXT NOT NULL,
    "tier1Target" INTEGER NOT NULL DEFAULT 10,
    "tier2Target" INTEGER NOT NULL DEFAULT 50,
    "tier3Target" INTEGER NOT NULL DEFAULT 100
  )`,
  `CREATE TABLE IF NOT EXISTS "userAchievements" (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    tier INTEGER NOT NULL DEFAULT 1,
    "unlockedAt" TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS "lootDrops" (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    rarity TEXT NOT NULL DEFAULT 'common',
    "rewardType" TEXT NOT NULL DEFAULT 'coins',
    "rewardValue" INTEGER NOT NULL DEFAULT 10,
    "droppedAt" TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS "bossBattles" (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    "totalHp" INTEGER NOT NULL DEFAULT 100,
    "currentHp" INTEGER NOT NULL DEFAULT 100,
    "rewardCoins" INTEGER NOT NULL DEFAULT 100,
    "startTime" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "endTime" TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  )`,
  `CREATE TABLE IF NOT EXISTS "bossContributions" (
    id TEXT PRIMARY KEY,
    "battleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    damage INTEGER NOT NULL DEFAULT 1,
    action TEXT,
    "createdAt" TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS "seasonalEvents" (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    theme TEXT DEFAULT 'default',
    "startDate" TIMESTAMPTZ NOT NULL,
    "endDate" TIMESTAMPTZ NOT NULL,
    "xpMultiplier" REAL NOT NULL DEFAULT 1.0,
    "coinsMultiplier" REAL NOT NULL DEFAULT 1.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true
  )`,
];

async function run() {
  await client.connect();

  for (const sql of migrations) {
    try {
      await client.query(sql);
      const name = sql.substring(0, 60).replace(/\n/g, ' ');
      console.log('OK:', name);
    } catch (e: any) {
      console.log('FAIL:', e.message?.substring(0, 100));
    }
  }

  const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('streakCount', 'lastStreakDate', 'activeTitle')");
  console.log('\nColonne users verificate:', cols.rows.map((c: any) => c.column_name));

  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('quests', 'questProgress', 'achievements', 'userAchievements', 'lootDrops', 'bossBattles', 'bossContributions', 'seasonalEvents')");
  console.log('Tabelle create:', tables.rows.map((t: any) => t.tablename));

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
