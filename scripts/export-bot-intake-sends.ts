/**
 * Esporta gli invii verso `/api/bot/intake` per la riconciliazione col fornitore.
 *
 *   npx tsx --env-file=.env scripts/export-bot-intake-sends.ts [YYYY-MM-DD]
 *
 * Sola lettura. Legge gli audit `leadEvents.BOT_PUSHED` scritti da
 * `src/lib/bot-fissatore/push.ts` — ogni tentativo di push lascia una riga con
 * l'esito, quindi la lista e' completa anche per i tentativi falliti.
 *
 * Scrive due CSV in `data/bot-intake/` (cartella gitignorata: nessun dato
 * personale nei file, solo id interni, ma restano fuori dal repo per abitudine):
 *   - invii-<da>.csv        tutti gli invii: leadId, inviatoIl, result, status
 *   - da-verificare-<da>.csv i soli non-2xx e timeout, cioe' i lead che potrebbero
 *                            non essere mai arrivati
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { db } from '../src/db'
import { sql } from 'drizzle-orm'

const DIR = 'data/bot-intake'

type Riga = { leadId: string; inviatoIl: string; result: string; status: string | null; host: string | null }

const csv = (righe: Riga[]) =>
    'leadId,inviatoIl,result,status,host\n' +
    righe.map(r => [r.leadId, r.inviatoIl, r.result, r.status ?? '', r.host ?? ''].join(',')).join('\n') + '\n'

async function main() {
    const da = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-08-01'

    const res = await db.execute(sql`
        SELECT "leadId",
               to_char(timestamp AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD"T"HH24:MI:SS') AS "inviatoIl",
               metadata->>'result' AS result,
               metadata->>'status'  AS status,
               metadata->>'urlHost' AS host
        FROM "leadEvents"
        WHERE "eventType" = 'BOT_PUSHED'
          AND (timestamp AT TIME ZONE 'Europe/Rome') >= ${da}
        ORDER BY timestamp
    `)
    const righe = res.rows as unknown as Riga[]
    // "sent" con status 2xx e' arrivato di sicuro; tutto il resto ha esito ignoto e
    // va incrociato col fornitore.
    //
    // ATTENZIONE, verificato il 2026-09-09 sui 113 timeout del periodo 14/08-09/09:
    // erano arrivati TUTTI E 113, con conversazione creata e 13 appuntamenti fissati.
    // Un timeout NON e' un lead perso: il loro intake manda il template di apertura
    // via Twilio prima di rispondere, quindi sotto carico supera i nostri 5 secondi
    // mentre il lavoro e' gia' fatto. Questa lista serve a riconciliare, mai a
    // decidere un rinvio da sola — rimandare un lead gia' arruolato gli farebbe
    // arrivare una seconda apertura.
    const daVerificare = righe.filter(r => r.result !== 'sent' || !/^2\d\d$/.test(r.status ?? ''))

    mkdirSync(DIR, { recursive: true })
    writeFileSync(`${DIR}/.gitignore`, '# Liste di riconciliazione col fornitore del bot: fuori dal repo\n*\n!.gitignore\n')
    writeFileSync(`${DIR}/invii-${da}.csv`, csv(righe))
    writeFileSync(`${DIR}/da-verificare-${da}.csv`, csv(daVerificare))

    const perEsito = new Map<string, number>()
    for (const r of righe) {
        const k = `${r.result}${r.status ? ` ${r.status}` : ''}`
        perEsito.set(k, (perEsito.get(k) ?? 0) + 1)
    }
    console.log(`Finestra: dal ${da} (ora di Roma)`)
    console.log(`Invii totali: ${righe.length} · lead distinti: ${new Set(righe.map(r => r.leadId)).size}`)
    for (const [k, n] of [...perEsito].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${n}`)
    console.log(`\nDa verificare (non arrivati di sicuro): ${daVerificare.length}`)
    console.log(`  ${DIR}/invii-${da}.csv`)
    console.log(`  ${DIR}/da-verificare-${da}.csv`)
    await (db as any).$client?.end?.()
}

main().catch(async (e) => { console.error(e); await (db as any).$client?.end?.(); process.exit(1) })
