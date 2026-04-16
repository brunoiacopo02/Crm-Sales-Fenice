import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const url = process.env.DATABASE_URL || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres";
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
    // Lead totali con appuntamento nel mese
    const apptTotal = await pool.query(`
        SELECT COUNT(*) AS c FROM leads
        WHERE "appointmentDate" >= '2026-04-01' AND "appointmentDate" < '2026-05-01'
    `);
    console.log('Lead con appointmentDate in aprile:', apptTotal.rows[0].c);

    // Lead confermati in aprile
    const confTotal = await pool.query(`
        SELECT COUNT(*) AS c FROM leads
        WHERE "appointmentDate" >= '2026-04-01' AND "appointmentDate" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
    `);
    console.log('Lead confermati con appointmentDate aprile:', confTotal.rows[0].c);

    // Lead confermati CON appt passato (ci sono già stati) e senza outcome
    const passedNoOutcome = await pool.query(`
        SELECT COUNT(*) AS c FROM leads
        WHERE "appointmentDate" < NOW()
          AND "appointmentDate" >= '2026-04-01'
          AND "confirmationsOutcome" = 'confermato'
          AND "salespersonOutcome" IS NULL
    `);
    console.log('Lead confermati, appt passato, SENZA outcome venditore:', passedNoOutcome.rows[0].c);

    // Lead confermati con appt ANCORA DA FARE (futuro)
    const futureAppts = await pool.query(`
        SELECT COUNT(*) AS c FROM leads
        WHERE "appointmentDate" >= NOW()
          AND "appointmentDate" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
    `);
    console.log('Lead confermati con appt futuro (ancora da fare):', futureAppts.rows[0].c);

    // Outcome distribution limited to confermati
    const dist = await pool.query(`
        SELECT "salespersonOutcome" AS out, COUNT(*) AS c FROM leads
        WHERE "appointmentDate" >= '2026-04-01' AND "appointmentDate" < '2026-05-01'
          AND "confirmationsOutcome" = 'confermato'
        GROUP BY "salespersonOutcome" ORDER BY c DESC
    `);
    console.log('\nOutcome distribution (lead CONFERMATI con appt aprile):');
    for (const r of dist.rows) console.log(`  ${JSON.stringify(r.out)}: ${r.c}`);

    // Summary
    console.log('\n--- Summary ---');
    const fissati = apptTotal.rows[0].c;
    const confermati = confTotal.rows[0].c;
    const passedNoOut = passedNoOutcome.rows[0].c;
    const future = futureAppts.rows[0].c;
    console.log(`Fissati: ${fissati}`);
    console.log(`Confermati: ${confermati}`);
    console.log(`  - già esitati: ${confermati - passedNoOut - future}`);
    console.log(`  - appt passato SENZA outcome: ${passedNoOut}`);
    console.log(`  - appt ancora da fare: ${future}`);
} finally {
    await pool.end();
}
