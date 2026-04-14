import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  // 1) Verify createdAt column on leads
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'leads' AND table_schema = 'public'
    ORDER BY ordinal_position
  `);
  const names = cols.rows.map(c => c.column_name);
  console.log('leads columns count:', names.length);
  console.log('Has createdAt?', names.includes('createdAt'));
  console.log('Relevant time fields:', names.filter(n => /created|inserted|imported|uploaded/i.test(n)));

  // 2) Distinct funnel values + counts
  const funnels = await pool.query(`
    SELECT funnel, COUNT(*) as c FROM leads
    GROUP BY funnel ORDER BY c DESC LIMIT 30
  `);
  console.log('\nDistinct funnel values:');
  for (const r of funnels.rows) console.log(`  ${r.funnel || '(null)'}: ${r.c}`);

  // 3) Leads created in April 2026 by funnel
  const april = await pool.query(`
    SELECT funnel, COUNT(*) as c FROM leads
    WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
    GROUP BY funnel ORDER BY c DESC
  `);
  console.log('\nLeads created in April 2026 by funnel:');
  for (const r of april.rows) console.log(`  ${r.funnel || '(null)'}: ${r.c}`);
} finally {
  await pool.end();
}
