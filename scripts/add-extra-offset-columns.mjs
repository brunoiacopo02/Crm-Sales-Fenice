import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    const cols = ['appExtra', 'confermeExtra', 'trattativeExtra', 'closeExtra'];
    for (const c of cols) {
        await pool.query(`ALTER TABLE "monthlyLeadTargets" ADD COLUMN IF NOT EXISTS "${c}" INTEGER NOT NULL DEFAULT 0`);
        console.log(`  ✅ column ${c}`);
    }

    // April: closeExtra = 3 (7 Excel Numeri Mensili - 4 funnel delta sum)
    await pool.query(`UPDATE "monthlyLeadTargets" SET "closeExtra" = 3, "updatedAt" = NOW() WHERE "yearMonth" = '2026-04'`);

    const v = await pool.query(`SELECT "appExtra", "confermeExtra", "trattativeExtra", "closeExtra" FROM "monthlyLeadTargets" WHERE "yearMonth" = '2026-04'`);
    console.log('\nExtra offsets April 2026:', v.rows[0]);
} finally {
    await pool.end();
}
