import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    // ALL confermati in April with details
    const all = await pool.query(`
        SELECT
            l.id,
            l.name,
            UPPER(COALESCE(l.funnel,'')) AS funnel,
            l."confirmationsOutcome",
            l."confirmationsTimestamp",
            l."confirmationsUserId",
            l."salespersonOutcome",
            l."createdAt",
            l."appointmentDate",
            l."appointmentCreatedAt",
            u.name AS gdo_name
        FROM leads l
        LEFT JOIN users u ON u.id = l."assignedToId"
        WHERE l."createdAt" >= '2026-04-01' AND l."createdAt" < '2026-05-01'
          AND l."confirmationsOutcome" = 'confermato'
        ORDER BY l."confirmationsTimestamp" ASC NULLS FIRST
    `);

    console.log(`Total confermati in April CRM: ${all.rows.length}\n`);

    // Classify each
    let naturalCount = 0;
    let suspectCount = 0;
    for (const r of all.rows) {
        const hasTimestamp = !!r.confirmationsTimestamp;
        const hasUserId = !!r.confirmationsUserId;
        const suspect = !hasTimestamp || !hasUserId;

        if (suspect) suspectCount++;
        else naturalCount++;

        const flag = suspect ? '⚠️ SUSPECT (no timestamp/userId)' : '✅ natural';
        console.log(`${flag} | ${r.funnel.padEnd(16)} | ${(r.name || '???').padEnd(20)} | confTimestamp: ${r.confirmationsTimestamp ? new Date(r.confirmationsTimestamp).toISOString().slice(0,16) : 'NULL'} | confUserId: ${r.confirmationsUserId || 'NULL'} | spOutcome: ${r.salespersonOutcome || 'NULL'}`);
    }

    console.log(`\n--- Summary ---`);
    console.log(`Natural (con timestamp + userId): ${naturalCount}`);
    console.log(`Suspect (senza timestamp o userId — probabilmente seedati): ${suspectCount}`);
    console.log(`\nSe escludiamo i suspect: confermati reali = ${naturalCount}`);
    console.log(`Bruno dice ~19, differenza: ${naturalCount - 19}`);
} finally {
    await pool.end();
}
