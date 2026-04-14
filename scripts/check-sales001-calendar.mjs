import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  const users = await pool.query(
    `SELECT id, email, name, "displayName", role FROM users
     WHERE email ILIKE '%sales001%' OR name ILIKE '%sales001%' OR "displayName" ILIKE '%sales001%' LIMIT 10`
  );
  console.log('USERS:', users.rows);
  for (const u of users.rows) {
    const cc = await pool.query(
      `SELECT id, provider, "accessToken" IS NOT NULL AS has_access, "refreshToken" IS NOT NULL AS has_refresh, "tokenExpiry", "createdAt", "updatedAt"
       FROM "calendarConnections" WHERE "userId" = $1`,
      [u.id]
    );
    console.log(`-- Calendar connection for ${u.email}/${u.name}:`, cc.rows);
  }

  // Also show all sellers (role=venditore or seller) with or without calendar
  const sellers = await pool.query(
    `SELECT u.id, u.email, u.name, u."displayName", u.role, cc.id IS NOT NULL AS has_calendar, cc."tokenExpiry"
     FROM users u
     LEFT JOIN "calendarConnections" cc ON cc."userId" = u.id
     WHERE u.role IN ('venditore','seller','SALES','sales','VENDITORE')
     ORDER BY u.name`
  );
  console.log('\nALL SELLERS:', sellers.rows);
} catch (e) {
  console.error('ERR', e);
} finally {
  await pool.end();
}
