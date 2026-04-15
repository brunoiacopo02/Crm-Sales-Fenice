import 'dotenv/config';
import pg from 'pg';
import crypto from 'crypto';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

/**
 * Seed data for April 2026 from Bruno's Excel screenshot.
 * Semantics:
 *  - leadCount is absolute.
 *  - app / conferme / trattative / close values below are the "partial" Excel values
 *    that must be stored as DELTAS — they get summed with live CRM counts on display.
 *  - dataPrimoSottoSoglia is manually set from the Excel date.
 *  - statoSegnalazione is auto-recomputed later; initial value is just a hint.
 */
const APRIL_SEED = [
    { funnel: 'TELEGRAM',      lead: 384,  app: 47, conferme: 3, trattative: 2, close: 0, date: '2026-04-01', stato: 'ALLERT' },
    { funnel: 'JOB SIMULATOR', lead: 527,  app: 79, conferme: 6, trattative: 5, close: 0, date: '2026-04-01', stato: 'ALLERT' },
    { funnel: 'CORSO 10 ORE',  lead: 395,  app: 49, conferme: 5, trattative: 4, close: 0, date: '2026-04-07', stato: 'ALLERT' },
    // ORG: user instruction — solo lead=0, il resto mantiene i valori Excel
    { funnel: 'ORG',           lead: 0,    app: 163, conferme: 28, trattative: 13, close: 4, date: null, stato: 'OK' },
    { funnel: 'DATABASE',      lead: 1522, app: 4,  conferme: 0, trattative: 0, close: 0, date: '2026-04-01', stato: 'ALLERT' },
    // Sezione bassa "sui lead"
    { funnel: 'GOOGLE',        lead: 20,   app: 0,  conferme: 0, trattative: 0, close: 0, date: null, stato: 'OK' },
    { funnel: 'SOCIAL',        lead: 17,   app: 8,  conferme: 2, trattative: 1, close: 0, date: null, stato: 'OK' },
    { funnel: 'TELEGRAM-TK',   lead: 126,  app: 11, conferme: 0, trattative: 0, close: 0, date: null, stato: 'OK' },
];
const YM = '2026-04';

try {
    // 1) Create table if not exists
    await pool.query(`
        CREATE TABLE IF NOT EXISTS "monthlyFunnelBaselines" (
            id TEXT PRIMARY KEY,
            "yearMonth" TEXT NOT NULL,
            "funnelName" TEXT NOT NULL,
            "leadCount" INTEGER NOT NULL DEFAULT 0,
            "appDelta" INTEGER NOT NULL DEFAULT 0,
            "confermeDelta" INTEGER NOT NULL DEFAULT 0,
            "trattativeDelta" INTEGER NOT NULL DEFAULT 0,
            "closeDelta" INTEGER NOT NULL DEFAULT 0,
            "fatturatoEur" REAL NOT NULL DEFAULT 0,
            "spesaEur" REAL NOT NULL DEFAULT 0,
            "dataPrimoSottoSoglia" TIMESTAMPTZ,
            "statoSegnalazione" TEXT NOT NULL DEFAULT 'OK',
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT funnel_baseline_unique UNIQUE ("yearMonth", "funnelName")
        )
    `);
    console.log('✅ monthlyFunnelBaselines table ready');

    // 2) Compute current CRM counts per funnel (April 2026) so we can derive deltas.
    //    delta = partial_excel_value - current_crm_count  (so that display = delta + crm = partial + crm)
    const crmCounts = await pool.query(`
        SELECT
            UPPER(COALESCE(funnel, '')) AS funnel,
            COUNT(*) FILTER (WHERE "status" = 'APPOINTMENT' OR "appointmentDate" IS NOT NULL) AS app_count,
            COUNT(*) FILTER (WHERE "confirmationsOutcome" = 'confermato') AS conferme_count,
            COUNT(*) FILTER (WHERE "salespersonOutcome" IN ('Chiuso', 'Non chiuso')) AS trattative_count,
            COUNT(*) FILTER (WHERE "salespersonOutcome" = 'Chiuso') AS close_count
        FROM leads
        WHERE "createdAt" >= '2026-04-01' AND "createdAt" < '2026-05-01'
          AND UPPER(COALESCE(funnel, '')) != 'TEST'
          AND UPPER(COALESCE(funnel, '')) != ''
        GROUP BY UPPER(COALESCE(funnel, ''))
    `);
    const crmMap = new Map();
    for (const r of crmCounts.rows) {
        crmMap.set(r.funnel, {
            app: parseInt(r.app_count, 10),
            conferme: parseInt(r.conferme_count, 10),
            trattative: parseInt(r.trattative_count, 10),
            close: parseInt(r.close_count, 10),
        });
    }
    console.log('\nCurrent CRM counts per funnel (April 2026):');
    for (const [funnel, counts] of crmMap) console.log(`  ${funnel}:`, counts);

    // 3) Seed / upsert each row
    console.log('\nSeeding funnel baselines:');
    for (const row of APRIL_SEED) {
        const funnelUpper = row.funnel.toUpperCase();
        const crm = crmMap.get(funnelUpper) || { app: 0, conferme: 0, trattative: 0, close: 0 };

        // Delta is what, when summed with CRM, gives the display value.
        // Bruno said the Excel numbers are PARTIAL and must be summed with CRM.
        // So display = excel_partial + crm_count, and therefore delta = excel_partial.
        const appDelta = row.app;
        const confermeDelta = row.conferme;
        const trattativeDelta = row.trattative;
        const closeDelta = row.close;

        const existing = await pool.query(
            `SELECT id FROM "monthlyFunnelBaselines" WHERE "yearMonth" = $1 AND "funnelName" = $2`,
            [YM, funnelUpper]
        );

        if (existing.rows.length > 0) {
            await pool.query(`
                UPDATE "monthlyFunnelBaselines" SET
                    "leadCount" = $1,
                    "appDelta" = $2,
                    "confermeDelta" = $3,
                    "trattativeDelta" = $4,
                    "closeDelta" = $5,
                    "dataPrimoSottoSoglia" = $6,
                    "statoSegnalazione" = $7,
                    "updatedAt" = NOW()
                WHERE id = $8
            `, [row.lead, appDelta, confermeDelta, trattativeDelta, closeDelta, row.date, row.stato, existing.rows[0].id]);
            console.log(`  updated ${funnelUpper}`);
        } else {
            await pool.query(`
                INSERT INTO "monthlyFunnelBaselines"
                (id, "yearMonth", "funnelName", "leadCount",
                 "appDelta", "confermeDelta", "trattativeDelta", "closeDelta",
                 "fatturatoEur", "spesaEur",
                 "dataPrimoSottoSoglia", "statoSegnalazione",
                 "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $10, NOW(), NOW())
            `, [crypto.randomUUID(), YM, funnelUpper, row.lead,
                appDelta, confermeDelta, trattativeDelta, closeDelta,
                row.date, row.stato]);
            console.log(`  inserted ${funnelUpper}`);
        }
    }

    // 4) Verification
    const verify = await pool.query(
        `SELECT "funnelName", "leadCount", "appDelta", "confermeDelta", "trattativeDelta", "closeDelta", "dataPrimoSottoSoglia", "statoSegnalazione"
         FROM "monthlyFunnelBaselines" WHERE "yearMonth" = $1 ORDER BY "funnelName"`,
        [YM]
    );
    console.log('\nFinal baseline rows:');
    for (const r of verify.rows) console.log('  ', r);
} finally {
    await pool.end();
}
