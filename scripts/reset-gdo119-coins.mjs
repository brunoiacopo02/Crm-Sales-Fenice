import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const GDO119_ID = '8b36ab29-ad9d-4965-aeed-e06d572b531f';
const NEW_COINS = 1100;

try {
  const before = await pool.query(`SELECT "walletCoins" FROM users WHERE id = $1`, [GDO119_ID]);
  console.log('Before:', before.rows[0]);

  const delta = NEW_COINS - before.rows[0].walletCoins;

  await pool.query(`UPDATE users SET "walletCoins" = $1 WHERE id = $2`, [NEW_COINS, GDO119_ID]);

  // Log the adjustment in coinTransactions so it's traceable
  const crypto = await import('crypto');
  await pool.query(
    `INSERT INTO "coinTransactions" (id, "userId", amount, reason, "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    [crypto.randomUUID(), GDO119_ID, delta, 'Aggiustamento manuale (correzione exploit Scrigno 13-04-2026)']
  );

  const after = await pool.query(`SELECT "walletCoins" FROM users WHERE id = $1`, [GDO119_ID]);
  console.log('After:', after.rows[0]);
  console.log(`Delta: ${delta >= 0 ? '+' : ''}${delta}`);
} finally {
  await pool.end();
}
