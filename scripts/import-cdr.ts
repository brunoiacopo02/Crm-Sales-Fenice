/**
 * Import dei tabulati del centralino FreePBX.
 *
 *   npm run import:cdr -- data/cdr/cdr-2026-08.csv
 *   npm run import:cdr -- data/cdr/*.csv
 *
 * Idempotente: la chiave primaria è l'uniqueid assegnato da Asterisk, quindi
 * ricaricare lo stesso file non duplica nulla (ON CONFLICT DO NOTHING).
 */
import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'
import { db } from '../src/db'
import { pbxCalls, pbxExtensions } from '../src/db/schema'
import { parseCdrLine } from '../src/lib/cdr/parseCdr'

const BATCH = 1000

async function main() {
    const files = process.argv.slice(2)
    if (!files.length) {
        console.error('Uso: npm run import:cdr -- <file.csv> [altri.csv]')
        process.exit(1)
    }

    const extMap = new Map<string, string>()
    for (const e of await db.select().from(pbxExtensions)) extMap.set(e.extension, e.userId)
    console.log(`Mappatura interni caricata: ${extMap.size} postazioni`)

    for (const file of files) {
        const records: Record<string, string>[] = parse(readFileSync(file), {
            columns: true, skip_empty_lines: true, relax_column_count: true,
        })

        const rows = []
        let scartate = 0
        for (const rec of records) {
            const r = parseCdrLine(rec)
            if (!r) { scartate++; continue }
            rows.push({
                id: r.id,
                companyId: 'fenice',
                calldate: r.calldate,
                dateLocal: r.dateLocal,
                src: r.src,
                dstKey: r.dstKey,
                duration: r.duration,
                billsec: r.billsec,
                disposition: r.disposition,
                direction: r.direction,
                userId: r.direction === 'out' ? (extMap.get(r.src) ?? null) : null,
            })
        }

        let inserite = 0
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH)
            const res = await db.insert(pbxCalls).values(chunk).onConflictDoNothing().returning({ id: pbxCalls.id })
            inserite += res.length
        }
        const senzaUtente = rows.filter(r => r.direction === 'out' && !r.userId).length
        console.log(`${file}: ${records.length} righe, ${rows.length} valide, ${scartate} scartate, ${inserite} nuove, ${senzaUtente} uscite senza postazione mappata`)
    }
    process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
