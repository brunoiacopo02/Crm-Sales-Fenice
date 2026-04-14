import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  // 1) Duplicates in userAchievements: same user + same achievement + same tier
  const dupes = await pool.query(`
    SELECT "userId", "achievementId", tier, COUNT(*) AS copies
    FROM "userAchievements"
    GROUP BY "userId", "achievementId", tier
    HAVING COUNT(*) > 1
    ORDER BY copies DESC
  `);
  console.log(`Duplicate userAchievements rows: ${dupes.rows.length} groups`);
  for (const r of dupes.rows.slice(0, 20)) console.log('  ', r);

  // 2) Duplicate coinTransactions for achievements (same user + same reason within 2s)
  const txDupes = await pool.query(`
    SELECT t1."userId", t1.reason, t1."createdAt", t2."createdAt" AS dup_at, t1.amount
    FROM "coinTransactions" t1
    JOIN "coinTransactions" t2 ON t1."userId" = t2."userId"
      AND t1.reason = t2.reason
      AND t1.id < t2.id
      AND ABS(EXTRACT(EPOCH FROM (t2."createdAt" - t1."createdAt"))) < 2
    WHERE t1.reason ILIKE 'Achievement%'
    ORDER BY t1."createdAt" DESC LIMIT 30
  `);
  console.log(`\nDuplicate achievement coinTransactions (≤2s apart): ${txDupes.rows.length}`);
  for (const r of txDupes.rows) console.log('  ', r);

  // 3) Count users affected
  const affected = await pool.query(`
    SELECT "userId", COUNT(*) AS dup_coin_count, SUM(amount) AS extra_coins
    FROM "coinTransactions" t1
    WHERE EXISTS (
      SELECT 1 FROM "coinTransactions" t2
      WHERE t2."userId" = t1."userId"
        AND t2.reason = t1.reason
        AND t2.id != t1.id
        AND ABS(EXTRACT(EPOCH FROM (t2."createdAt" - t1."createdAt"))) < 2
        AND t1.reason ILIKE 'Achievement%'
    )
    AND t1.reason ILIKE 'Achievement%'
    GROUP BY "userId"
    ORDER BY extra_coins DESC
  `);
  console.log(`\nUsers affected by achievement double-fire:`);
  for (const r of affected.rows) {
    const u = await pool.query(`SELECT name, "gdoCode" FROM users WHERE id=$1`, [r.userId]);
    console.log(`  ${u.rows[0]?.name} (gdoCode=${u.rows[0]?.gdoCode}): ${r.dup_coin_count} tx in group, +${r.extra_coins} coins total`);
  }
} finally {
  await pool.end();
}
