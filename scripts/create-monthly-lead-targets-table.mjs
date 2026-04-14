import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "monthlyLeadTargets" (
      id TEXT PRIMARY KEY,
      "yearMonth" TEXT NOT NULL UNIQUE,
      "targetNuovi" INTEGER NOT NULL,
      "targetDatabase" INTEGER NOT NULL,
      "workingDays" INTEGER NOT NULL,
      "baselineNuovi" INTEGER NOT NULL DEFAULT 0,
      "baselineDatabase" INTEGER NOT NULL DEFAULT 0,
      "baselineSetAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅ monthlyLeadTargets table created (or already existed)');

  const check = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'monthlyLeadTargets' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);
  console.log('\nColumns:');
  for (const c of check.rows) console.log(`  ${c.column_name} (${c.data_type})`);
} finally {
  await pool.end();
}
