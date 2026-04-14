import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  // Find GDO 119
  const user = await pool.query(
    `SELECT id, email, name, "displayName", "gdoCode", "walletCoins", "lastTimedChestAt", level, experience
     FROM users WHERE "gdoCode" = 119 LIMIT 1`
  );
  console.log('GDO 119:', user.rows);

  if (user.rows.length === 0) { process.exit(1); }
  const userId = user.rows[0].id;

  // Recent coin transactions (last 7 days)
  const tx = await pool.query(
    `SELECT id, amount, reason, "createdAt" FROM "coinTransactions"
     WHERE "userId" = $1 AND "createdAt" > NOW() - INTERVAL '7 days'
     ORDER BY "createdAt" DESC LIMIT 50`,
    [userId]
  );
  console.log(`\nLast ${tx.rows.length} coin transactions (7d):`);
  for (const r of tx.rows) {
    console.log(`  ${r.createdAt.toISOString()} | ${r.amount > 0 ? '+' : ''}${r.amount} | ${r.reason}`);
  }

  // Count chest claims today & yesterday
  const chestCount = await pool.query(
    `SELECT
       date_trunc('day', "createdAt" AT TIME ZONE 'Europe/Rome')::date AS day,
       COUNT(*) AS chests,
       SUM(amount) AS total_coins
     FROM "coinTransactions"
     WHERE "userId" = $1 AND reason ILIKE 'Scrigno a Tempo%'
       AND "createdAt" > NOW() - INTERVAL '7 days'
     GROUP BY day ORDER BY day DESC`,
    [userId]
  );
  console.log(`\nScrigno claims by day (GDO 119):`);
  for (const r of chestCount.rows) {
    console.log(`  ${r.day} | ${r.chests} chests | ${r.total_coins} coins`);
  }
} finally {
  await pool.end();
}
