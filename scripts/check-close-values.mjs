import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    // All closed leads with their amounts
    const closed = await pool.query(`
        SELECT l.name, UPPER(COALESCE(l.funnel,'')) AS funnel,
               l."closeAmountEur", l."salespersonOutcome",
               l."salespersonOutcomeAt", l."createdAt",
               l."closeProduct"
        FROM leads l
        WHERE l."salespersonOutcome" = 'Chiuso'
        ORDER BY l."salespersonOutcomeAt" DESC NULLS LAST
    `);
    console.log(`All closed leads in DB: ${closed.rows.length}\n`);

    let totalAmount = 0;
    let nullAmountCount = 0;
    for (const r of closed.rows) {
        const amt = r.closeAmountEur;
        if (amt === null || amt === undefined) nullAmountCount++;
        else totalAmount += amt;

        const createdMonth = r.createdAt ? new Date(r.createdAt).toISOString().slice(0,7) : '?';
        const closedMonth = r.salespersonOutcomeAt ? new Date(r.salespersonOutcomeAt).toISOString().slice(0,7) : '?';

        console.log(`  ${(r.name || '???').padEnd(22)} | ${r.funnel.padEnd(16)} | closeAmount: ${amt !== null ? '€'+amt : 'NULL'} | created: ${createdMonth} | closed: ${closedMonth} | product: ${r.closeProduct || '-'}`);
    }

    console.log(`\n--- Summary ---`);
    console.log(`Total closed: ${closed.rows.length}`);
    console.log(`With closeAmountEur: ${closed.rows.length - nullAmountCount}`);
    console.log(`Without closeAmountEur (NULL): ${nullAmountCount}`);
    console.log(`Sum of closeAmountEur: €${totalAmount.toFixed(2)}`);

    // Check: closed leads created in March but closed in April
    const crossMonth = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "salespersonOutcome" = 'Chiuso'
          AND "createdAt" < '2026-04-01'
          AND "salespersonOutcomeAt" >= '2026-04-01' AND "salespersonOutcomeAt" < '2026-05-01'
    `);
    console.log(`\nLeads created BEFORE April but closed IN April: ${crossMonth.rows[0].c}`);
} finally {
    await pool.end();
}
