import 'dotenv/config';
import pg from 'pg';
import crypto from 'crypto';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const YM = '2026-04';
const TARGET_NUOVI = 3715;
const TARGET_DB = 2964;
const WORKING_DAYS = 24;
const BASELINE_NUOVI = 1449;
const BASELINE_DB = 1422;

try {
  const existing = await pool.query(`SELECT id FROM "monthlyLeadTargets" WHERE "yearMonth" = $1`, [YM]);

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE "monthlyLeadTargets"
       SET "targetNuovi" = $1, "targetDatabase" = $2, "workingDays" = $3,
           "baselineNuovi" = $4, "baselineDatabase" = $5, "baselineSetAt" = NOW(), "updatedAt" = NOW()
       WHERE "yearMonth" = $6`,
      [TARGET_NUOVI, TARGET_DB, WORKING_DAYS, BASELINE_NUOVI, BASELINE_DB, YM]
    );
    console.log(`✅ Updated April 2026 target`);
  } else {
    await pool.query(
      `INSERT INTO "monthlyLeadTargets"
       (id, "yearMonth", "targetNuovi", "targetDatabase", "workingDays",
        "baselineNuovi", "baselineDatabase", "baselineSetAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())`,
      [crypto.randomUUID(), YM, TARGET_NUOVI, TARGET_DB, WORKING_DAYS, BASELINE_NUOVI, BASELINE_DB]
    );
    console.log(`✅ Inserted April 2026 target`);
  }

  const verify = await pool.query(`SELECT * FROM "monthlyLeadTargets" WHERE "yearMonth" = $1`, [YM]);
  console.log('\nFinal row:');
  console.log(verify.rows[0]);
} finally {
  await pool.end();
}
