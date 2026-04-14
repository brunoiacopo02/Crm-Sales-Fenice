import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'users'
    ORDER BY ordinal_position
  `);
  console.log('users columns:');
  for (const c of cols.rows) console.log(`  ${c.column_name} (${c.data_type}, nullable=${c.is_nullable}, default=${c.column_default || '-'})`);

  const sales = await pool.query(`
    SELECT id, email, name, "displayName", role, "isActive", "gdoCode", "walletCoins", level, experience, "createdAt"
    FROM users WHERE role = 'VENDITORE' ORDER BY email
  `);
  console.log(`\nExisting VENDITORE accounts (${sales.rows.length}):`);
  for (const u of sales.rows) console.log('  ', u);
} finally {
  await pool.end();
}
