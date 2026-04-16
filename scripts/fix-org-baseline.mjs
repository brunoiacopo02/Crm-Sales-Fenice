import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    const before = await pool.query(`
        SELECT "funnelName", "leadCount", "appDelta", "confermeDelta", "trattativeDelta", "closeDelta"
        FROM "monthlyFunnelBaselines" WHERE "yearMonth" = '2026-04' AND "funnelName" = 'ORG'
    `);
    console.log('ORG before:', before.rows[0]);

    // Correction: ORG confermeDelta was misread as 28, should be 18;
    // trattativeDelta was misread as 13, should be 18.
    // Resulting totals now match Bruno's reported 34 conferme / 30 presenziati.
    await pool.query(`
        UPDATE "monthlyFunnelBaselines" SET
            "confermeDelta" = 18,
            "trattativeDelta" = 18,
            "updatedAt" = NOW()
        WHERE "yearMonth" = '2026-04' AND "funnelName" = 'ORG'
    `);

    const after = await pool.query(`
        SELECT "funnelName", "leadCount", "appDelta", "confermeDelta", "trattativeDelta", "closeDelta"
        FROM "monthlyFunnelBaselines" WHERE "yearMonth" = '2026-04' AND "funnelName" = 'ORG'
    `);
    console.log('ORG after: ', after.rows[0]);

    // Verify totals across all April funnels
    const totals = await pool.query(`
        SELECT
            SUM("appDelta") AS app_delta,
            SUM("confermeDelta") AS conf_delta,
            SUM("trattativeDelta") AS tratt_delta,
            SUM("closeDelta") AS close_delta
        FROM "monthlyFunnelBaselines" WHERE "yearMonth" = '2026-04'
    `);
    console.log('\nTotale delta dopo correzione:', totals.rows[0]);
    console.log('Atteso: conf_delta = 34, tratt_delta = 30');
} finally {
    await pool.end();
}
