import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    // When was the funnel baseline seeded?
    const baseline = await pool.query(`
        SELECT MIN("createdAt") AS seed_time FROM "monthlyFunnelBaselines" WHERE "yearMonth" = '2026-04'
    `);
    const seedTime = baseline.rows[0].seed_time;
    console.log('Funnel baseline seed time:', seedTime);

    // CRM confermati BEFORE seed (these were already part of the Excel 34)
    const before = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
          AND "confirmationsTimestamp" < $1
    `, [seedTime]);
    console.log('CRM confermati BEFORE baseline seed:', before.rows[0].c);

    // CRM confermati AFTER seed (these are NEW, should be summed)
    const after = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
          AND "confirmationsTimestamp" >= $1
    `, [seedTime]);
    console.log('CRM confermati AFTER baseline seed:', after.rows[0].c);

    // Total CRM confermati
    const total = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
    `);
    console.log('CRM confermati TOTALE:', total.rows[0].c);

    console.log('\n--- Calcolo ---');
    console.log(`Excel baseline conferme delta = 34`);
    console.log(`CRM confermati PRIMA del seed (gia inclusi nel 34) = ${before.rows[0].c}`);
    console.log(`CRM confermati DOPO il seed (nuovi) = ${after.rows[0].c}`);
    console.log(`Display corretto = 34 + ${after.rows[0].c} = ${34 + after.rows[0].c}`);
    console.log(`Display attuale (sbagliato) = 34 + ${total.rows[0].c} = ${34 + total.rows[0].c}`);

    // Same for trattative/presenziati
    const trattBefore = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "salespersonOutcome" IN ('Chiuso','Non chiuso')
          AND "salespersonOutcomeAt" < $1
    `, [seedTime]);
    const trattAfter = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "salespersonOutcome" IN ('Chiuso','Non chiuso')
          AND "salespersonOutcomeAt" >= $1
    `, [seedTime]);
    console.log(`\nPresenziati PRIMA = ${trattBefore.rows[0].c}, DOPO = ${trattAfter.rows[0].c}`);
    console.log(`Display corretto = 30 + ${trattAfter.rows[0].c} = ${30 + trattAfter.rows[0].c}`);

    // Same for app (fissati)
    const appBefore = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND ("status" = 'APPOINTMENT' OR "appointmentDate" IS NOT NULL)
          AND "appointmentCreatedAt" < $1
    `, [seedTime]);
    const appAfter = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND ("status" = 'APPOINTMENT' OR "appointmentDate" IS NOT NULL)
          AND "appointmentCreatedAt" >= $1
    `, [seedTime]);
    console.log(`\nApp PRIMA = ${appBefore.rows[0].c}, DOPO = ${appAfter.rows[0].c}`);

    // Close
    const closeBefore = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "salespersonOutcome" = 'Chiuso'
          AND "salespersonOutcomeAt" < $1
    `, [seedTime]);
    const closeAfter = await pool.query(`
        SELECT COUNT(*)::int AS c FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND "salespersonOutcome" = 'Chiuso'
          AND "salespersonOutcomeAt" >= $1
    `, [seedTime]);
    console.log(`Close PRIMA = ${closeBefore.rows[0].c}, DOPO = ${closeAfter.rows[0].c}`);
} finally {
    await pool.end();
}
