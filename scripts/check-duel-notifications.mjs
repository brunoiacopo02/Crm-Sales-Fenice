import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  // 1) Recent duels (last 2 hours)
  const duels = await pool.query(`
    SELECT id, "challengerId", "opponentId", metric, "rewardCoins", status, "startTime"
    FROM duels
    WHERE "startTime" > NOW() - INTERVAL '2 hours'
    ORDER BY "startTime" DESC LIMIT 10
  `);
  console.log(`Recent duels (last 2h): ${duels.rows.length}`);
  for (const d of duels.rows) {
    const c = await pool.query(`SELECT "gdoCode", name FROM users WHERE id=$1`, [d.challengerId]);
    const o = await pool.query(`SELECT "gdoCode", name FROM users WHERE id=$1`, [d.opponentId]);
    console.log(`  ${d.startTime.toISOString()} | ${c.rows[0]?.name} (#${c.rows[0]?.gdoCode}) vs ${o.rows[0]?.name} (#${o.rows[0]?.gdoCode}) | stake=${d.rewardCoins} | ${d.status} | ${d.id}`);
  }

  // 2) Recent duel_started notifications
  const notifs = await pool.query(`
    SELECT id, "recipientUserId", type, title, body, status, "createdAt", metadata
    FROM notifications
    WHERE type = 'duel_started'
    ORDER BY "createdAt" DESC LIMIT 20
  `);
  console.log(`\nduel_started notifications (most recent 20): ${notifs.rows.length}`);
  for (const n of notifs.rows) {
    const u = await pool.query(`SELECT "gdoCode", name FROM users WHERE id=$1`, [n.recipientUserId]);
    console.log(`  ${n.createdAt.toISOString()} → ${u.rows[0]?.name} (#${u.rows[0]?.gdoCode}) | ${n.status} | ${n.title}`);
  }

  // 3) Check Supabase Realtime publication for notifications table
  const pub = await pool.query(`
    SELECT pubname, tablename FROM pg_publication_tables WHERE tablename = 'notifications'
  `);
  console.log(`\nRealtime publications for 'notifications' table:`);
  for (const p of pub.rows) console.log('  ', p);

  // 4) All notifications in last hour (any type) to see what's flowing
  const allNotifs = await pool.query(`
    SELECT type, COUNT(*) as c
    FROM notifications
    WHERE "createdAt" > NOW() - INTERVAL '1 hour'
    GROUP BY type ORDER BY c DESC
  `);
  console.log(`\nAll notifications created in last 1h:`);
  for (const r of allNotifs.rows) console.log(`  ${r.type}: ${r.c}`);
} finally {
  await pool.end();
}
