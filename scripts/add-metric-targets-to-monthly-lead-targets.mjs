import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const YM = '2026-04';
const APRIL_METRIC_TARGETS = {
    targetAppMonthly: 1225,
    targetConfMonthly: 196,
    targetPresMonthly: 176.4,
    targetCloseMonthly: 74,
    targetFatturatoMonthly: 168000,
};

try {
    // 1) Add new columns if they don't exist
    const cols = [
        { name: 'targetAppMonthly',      type: 'REAL NOT NULL DEFAULT 0' },
        { name: 'targetConfMonthly',     type: 'REAL NOT NULL DEFAULT 0' },
        { name: 'targetPresMonthly',     type: 'REAL NOT NULL DEFAULT 0' },
        { name: 'targetCloseMonthly',    type: 'REAL NOT NULL DEFAULT 0' },
        { name: 'targetFatturatoMonthly',type: 'REAL NOT NULL DEFAULT 0' },
        { name: 'fatturatoExtraEur',     type: 'REAL NOT NULL DEFAULT 0' },
    ];
    for (const c of cols) {
        await pool.query(`ALTER TABLE "monthlyLeadTargets" ADD COLUMN IF NOT EXISTS "${c.name}" ${c.type}`);
        console.log(`  ✅ column ${c.name}`);
    }

    // 2) Seed April 2026 metric targets
    const existing = await pool.query(`SELECT id FROM "monthlyLeadTargets" WHERE "yearMonth" = $1`, [YM]);
    if (existing.rows.length === 0) {
        console.log(`⚠️  No row for ${YM}. Run seed-april-lead-target.mjs first.`);
    } else {
        await pool.query(`
            UPDATE "monthlyLeadTargets" SET
                "targetAppMonthly" = $1,
                "targetConfMonthly" = $2,
                "targetPresMonthly" = $3,
                "targetCloseMonthly" = $4,
                "targetFatturatoMonthly" = $5,
                "updatedAt" = NOW()
            WHERE "yearMonth" = $6
        `, [
            APRIL_METRIC_TARGETS.targetAppMonthly,
            APRIL_METRIC_TARGETS.targetConfMonthly,
            APRIL_METRIC_TARGETS.targetPresMonthly,
            APRIL_METRIC_TARGETS.targetCloseMonthly,
            APRIL_METRIC_TARGETS.targetFatturatoMonthly,
            YM,
        ]);
        console.log(`✅ Seeded metric targets for ${YM}`);
    }

    const verify = await pool.query(`
        SELECT "yearMonth", "targetNuovi", "targetDatabase", "workingDays",
               "targetAppMonthly", "targetConfMonthly", "targetPresMonthly",
               "targetCloseMonthly", "targetFatturatoMonthly", "fatturatoExtraEur"
        FROM "monthlyLeadTargets" WHERE "yearMonth" = $1
    `, [YM]);
    console.log('\nFinal row:', verify.rows[0]);
} finally {
    await pool.end();
}
