// Applica i batch SQL generati in tmp-seed-batches/ direttamente sul Postgres Supabase.
// Esegue PRIMA tutti i leads-NN, poi tutti gli events-NN (events ha FK su leadId).
import { Pool } from 'pg'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DB_URL = process.env.DATABASE_URL
  || "postgresql://postgres:Infernape02.88I@db.ncutwzsifzundikwllxp.supabase.co:5432/postgres"

const pool = new Pool({ connectionString: DB_URL, max: 4 })

async function main() {
  const dir = 'tmp-seed-batches'
  const files = readdirSync(dir).sort()
  const leads = files.filter(f => f.startsWith('leads-'))
  const events = files.filter(f => f.startsWith('events-'))

  const t0 = Date.now()
  console.log(`Applying ${leads.length} leads batches, then ${events.length} events batches...`)

  for (const f of leads) {
    const sql = readFileSync(join(dir, f), 'utf8')
    const t = Date.now()
    await pool.query(sql)
    console.log(`  [LEADS] ${f}: OK (${Date.now() - t}ms)`)
  }
  for (const f of events) {
    const sql = readFileSync(join(dir, f), 'utf8')
    const t = Date.now()
    await pool.query(sql)
    console.log(`  [EVENTS] ${f}: OK (${Date.now() - t}ms)`)
  }

  console.log(`\nTotal time: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await pool.end()
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
