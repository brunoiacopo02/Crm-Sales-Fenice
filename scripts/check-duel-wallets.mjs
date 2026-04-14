import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  const users = await pool.query(`
    SELECT id, "gdoCode", name, "walletCoins" FROM users WHERE "gdoCode" IN (114, 115)
  `);
  console.log('Wallets now:');
  for (const u of users.rows) console.log(`  #${u.gdoCode} ${u.name}: ${u.walletCoins}`);

  // Check coin transactions related to duels for these users (last 2h)
  const tx = await pool.query(`
    SELECT t."userId", u."gdoCode", t.amount, t.reason, t."createdAt"
    FROM "coinTransactions" t
    JOIN users u ON u.id = t."userId"
    WHERE u."gdoCode" IN (114, 115)
      AND t."createdAt" > NOW() - INTERVAL '2 hours'
      AND t.reason ILIKE 'Duello%'
    ORDER BY t."createdAt" DESC
  `);
  console.log(`\nDuel-related coinTransactions (last 2h): ${tx.rows.length}`);
  for (const r of tx.rows) {
    console.log(`  ${r.createdAt.toISOString()} | #${r.gdoCode} | ${r.amount > 0 ? '+' : ''}${r.amount} | ${r.reason}`);
  }
} finally {
  await pool.end();
}
