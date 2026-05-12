// One-shot seeder per il pool Lancio Videoeditor (12 maggio 2026).
// Legge i due xlsx forniti dall'owner, normalizza nome/email/telefono, ed emette
// statement SQL INSERT batchati su stdout (o su un file via redirect).
// Esegui:  node scripts/seed-launch-pool.mjs > seed-launch-pool.out.sql
// Poi applica i blocchi via Supabase MCP execute_sql (un batch alla volta).
//
// Tabelle target: leads (id, name, phone, email, funnel, status, callCount, isSelfBooked,
// launchBucket, assignedToId, createdAt, updatedAt) e leadEvents (id, leadId, eventType,
// metadata, timestamp). I default coperti dallo schema vengono OMESSI nella INSERT.

import XLSX from 'xlsx'
import { randomUUID } from 'node:crypto'

const FILES = [
  { path: 'C:/Users/bruno/Downloads/lead_zoom_con_telefono.xlsx',  bucket: 'WEBINAR' },
  { path: 'C:/Users/bruno/Downloads/lead_da_chiamare_dopo.xlsx',    bucket: 'NO_WEBINAR' },
]

const BATCH = 400

function esc(v) {
  if (v == null) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

function normalizePhone(raw) {
  if (!raw) return null
  const cleaned = String(raw).replace(/[^\d+]/g, '')
  return cleaned.length >= 5 ? cleaned : null
}

function normalizeEmail(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  return s.includes('@') && s.includes('.') ? s : null
}

const nowIso = new Date().toISOString()
const allRows = []

for (const { path, bucket } of FILES) {
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  let skipped = 0
  for (const r of rows) {
    const phone = normalizePhone(r.Telefono ?? r.telefono ?? r.Phone)
    if (!phone) { skipped++; continue }
    const name  = String(r.Nome ?? r.nome ?? '').trim() || 'Lead senza nome'
    const email = normalizeEmail(r.Email ?? r.email)
    allRows.push({ id: randomUUID(), name, phone, email, bucket })
  }
  console.error(`[${bucket}] file=${path} righe_totali=${rows.length} valide=${rows.length - skipped} scartate=${skipped}`)
}

console.log(`-- TOTAL ROWS: ${allRows.length} (now=${nowIso})`)

// Leads batches
for (let i = 0; i < allRows.length; i += BATCH) {
  const chunk = allRows.slice(i, i + BATCH)
  console.log(`\n-- LEADS BATCH ${Math.floor(i / BATCH) + 1} (${chunk.length} righe)`)
  const values = chunk.map(r =>
    `(${esc(r.id)}, ${esc(r.name)}, ${esc(r.phone)}, ${r.email ? esc(r.email) : 'NULL'}, 'ORG', ${esc(r.bucket)}, '${nowIso}', '${nowIso}')`
  ).join(',\n  ')
  console.log(
    `INSERT INTO leads (id, name, phone, email, funnel, "launchBucket", "createdAt", "updatedAt") VALUES\n  ${values};`
  )
}

// leadEvents batches (IMPORTED per ciascun lead)
for (let i = 0; i < allRows.length; i += BATCH) {
  const chunk = allRows.slice(i, i + BATCH)
  console.log(`\n-- EVENTS BATCH ${Math.floor(i / BATCH) + 1} (${chunk.length} righe)`)
  const values = chunk.map(r =>
    `(${esc(randomUUID())}, ${esc(r.id)}, 'IMPORTED', '{"source":"launch_pool_seed","bucket":"${r.bucket}"}'::jsonb, '${nowIso}')`
  ).join(',\n  ')
  console.log(
    `INSERT INTO "leadEvents" (id, "leadId", "eventType", metadata, "timestamp") VALUES\n  ${values};`
  )
}
