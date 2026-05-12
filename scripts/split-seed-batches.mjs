// Splitta seed-launch-pool.out.sql in file singoli per batch.
// Output: tmp-seed-batches/leads-NN.sql e events-NN.sql

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const src = readFileSync('seed-launch-pool.out.sql', 'utf8')
mkdirSync('tmp-seed-batches', { recursive: true })

const lines = src.split('\n')
let current = null
let buf = []

function flush() {
  if (current && buf.length > 0) {
    writeFileSync(`tmp-seed-batches/${current}.sql`, buf.join('\n'))
  }
  buf = []
}

for (const line of lines) {
  const leadMatch = line.match(/^-- LEADS BATCH (\d+)/)
  const eventsMatch = line.match(/^-- EVENTS BATCH (\d+)/)
  if (leadMatch) {
    flush()
    current = `leads-${String(leadMatch[1]).padStart(2, '0')}`
    continue
  }
  if (eventsMatch) {
    flush()
    current = `events-${String(eventsMatch[1]).padStart(2, '0')}`
    continue
  }
  if (current && line.trim() !== '') buf.push(line)
}
flush()
console.log('Done')
