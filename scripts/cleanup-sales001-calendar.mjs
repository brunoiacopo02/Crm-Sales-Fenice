import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const SALES001_ID = '424fef5b-7035-4e5f-949e-863f850f8bcb';

try {
  const res = await pool.query(
    `DELETE FROM "calendarConnections" WHERE "userId" = $1 RETURNING id`,
    [SALES001_ID]
  );
  console.log('Deleted rows:', res.rows);
} finally {
  await pool.end();
}
