import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1) Dedupe userAchievements: keep oldest row per (userId, achievementId, tier)
  const delRes = await client.query(`
    DELETE FROM "userAchievements"
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY "userId", "achievementId", tier
          ORDER BY "unlockedAt" ASC, id ASC
        ) AS rn
        FROM "userAchievements"
      ) t WHERE rn > 1
    )
    RETURNING id, "userId", "achievementId", tier
  `);
  console.log(`Deleted ${delRes.rowCount} duplicate userAchievements rows:`);
  for (const r of delRes.rows) console.log('  ', r);

  // 2) Apply UNIQUE constraint
  const constraintExists = await client.query(`
    SELECT 1 FROM pg_constraint WHERE conname = 'user_ach_tier_unique'
  `);
  if (constraintExists.rowCount === 0) {
    await client.query(`
      ALTER TABLE "userAchievements"
      ADD CONSTRAINT user_ach_tier_unique UNIQUE ("userId", "achievementId", tier)
    `);
    console.log('✅ UNIQUE constraint user_ach_tier_unique added');
  } else {
    console.log('Constraint already exists, skipping');
  }

  // 3) Refund GDO 117 for the 40 extra coins
  const GDO117 = await client.query(`SELECT id, "walletCoins" FROM users WHERE "gdoCode" = 117`);
  if (GDO117.rows.length > 0) {
    const u = GDO117.rows[0];
    console.log(`\nGDO 117 before: ${u.walletCoins}`);
    await client.query(`UPDATE users SET "walletCoins" = "walletCoins" - 40 WHERE id = $1`, [u.id]);
    const crypto = await import('crypto');
    await client.query(
      `INSERT INTO "coinTransactions" (id, "userId", amount, reason, "createdAt")
       VALUES ($1, $2, -40, 'Correzione bug double-fire achievement (10/04/2026)', NOW())`,
      [crypto.randomUUID(), u.id]
    );
    const after = await client.query(`SELECT "walletCoins" FROM users WHERE id = $1`, [u.id]);
    console.log(`GDO 117 after: ${after.rows[0].walletCoins}`);
  }

  await client.query('COMMIT');
  console.log('\n✅ All changes committed');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Rolled back:', e.message);
  throw e;
} finally {
  client.release();
  await pool.end();
}
