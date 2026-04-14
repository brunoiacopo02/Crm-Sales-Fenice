import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  const res = await pool.query(`
    DELETE FROM duels
    WHERE status = 'active' AND "startTime" > NOW() - INTERVAL '3 hours'
    RETURNING id, "challengerId", "opponentId", "rewardCoins"
  `);
  console.log(`Deleted ${res.rowCount} orphan test duels:`);
  for (const d of res.rows) console.log('  ', d);
} finally {
  await pool.end();
}
