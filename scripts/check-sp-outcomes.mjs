import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    const all = await pool.query(`
        SELECT "salespersonOutcome" AS out, COUNT(*) AS c
        FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
        GROUP BY "salespersonOutcome" ORDER BY c DESC
    `);
    console.log('April 2026 salespersonOutcome distribution:');
    for (const r of all.rows) {
        console.log(`  ${JSON.stringify(r.out)}: ${r.c}`);
    }

    const byFunnel = await pool.query(`
        SELECT UPPER(COALESCE(funnel,'')) AS funnel, "salespersonOutcome" AS out, COUNT(*) AS c
        FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "salespersonOutcome" IS NOT NULL
        GROUP BY UPPER(COALESCE(funnel,'')), "salespersonOutcome"
        ORDER BY funnel, "salespersonOutcome"
    `);
    console.log('\nBy funnel (not-null outcomes only):');
    for (const r of byFunnel.rows) {
        console.log(`  ${r.funnel.padEnd(18)} | ${String(r.out).padEnd(25)} | ${r.c}`);
    }

    // Show leads with appointment but no outcome (might be "in trattativa")
    const noOutcome = await pool.query(`
        SELECT COUNT(*) AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
          AND "salespersonOutcome" IS NULL
    `);
    console.log(`\nLeads confermati senza salespersonOutcome (in trattativa / in attesa): ${noOutcome.rows[0].c}`);

    // isPresenziato helper count
    const presCrm = await pool.query(`
        SELECT COUNT(*) AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "salespersonOutcome" IS NOT NULL
          AND LOWER("salespersonOutcome") NOT LIKE '%sparit%'
          AND LOWER("salespersonOutcome") NOT LIKE '%assent%'
          AND LOWER("salespersonOutcome") NOT LIKE '%non presenziato%'
    `);
    console.log(`\nPresenziati secondo helper CRM (isPresenziato): ${presCrm.rows[0].c}`);

    // My panoramica logic count
    const myLogic = await pool.query(`
        SELECT COUNT(*) AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "salespersonOutcome" IN ('Chiuso', 'Non chiuso')
    `);
    console.log(`Presenziati secondo logica panoramica (IN Chiuso/Non chiuso): ${myLogic.rows[0].c}`);
} finally {
    await pool.end();
}
