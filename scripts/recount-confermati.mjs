import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    // A) esattamente con lo stesso filtro di getCrmFunnelCounts
    const a = await pool.query(`
        SELECT
            UPPER(COALESCE(funnel,'')) AS funnel,
            COUNT(*) FILTER (WHERE "confirmationsOutcome" = 'confermato')::int AS conferme
        FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND UPPER(COALESCE(funnel,'')) NOT IN ('TEST','')
        GROUP BY UPPER(COALESCE(funnel,''))
        ORDER BY funnel
    `);
    let totalA = 0;
    console.log('A) getCrmFunnelCounts filter (createdAt + NOT TEST/empty):');
    for (const r of a.rows) { console.log(`  ${r.funnel}: ${r.conferme}`); totalA += r.conferme; }
    console.log(`  TOTAL A = ${totalA}`);

    // B) senza filtro funnel (include NULL e TEST)
    const b = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
    `);
    console.log(`\nB) Totale confermati aprile (createdAt, senza filtro funnel): ${b.rows[0].c}`);

    // C) confermati con funnel NULL o vuoto
    const c = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
          AND (funnel IS NULL OR funnel = '')
    `);
    console.log(`C) Confermati con funnel NULL/vuoto: ${c.rows[0].c}`);

    // D) confermati filtrando per confirmationsTimestamp (evento in aprile)
    const d = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "confirmationsTimestamp" >= '2026-04-01' AND "confirmationsTimestamp" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
    `);
    console.log(`\nD) Confermati per confirmationsTimestamp (evento aprile): ${d.rows[0].c}`);

    // E) confermati TOTALI nel DB (tutti i tempi)
    const e = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads WHERE "confirmationsOutcome" = 'confermato'
    `);
    console.log(`E) Confermati in assoluto nel DB: ${e.rows[0].c}`);

    // F) confermati filtrando per appointmentDate in aprile
    const f = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "appointmentDate" >= '2026-04-01' AND "appointmentDate" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
    `);
    console.log(`F) Confermati con appointmentDate aprile: ${f.rows[0].c}`);
} finally {
    await pool.end();
}
