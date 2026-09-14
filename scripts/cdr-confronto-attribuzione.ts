/**
 * Tempo al telefono per persona, PRIMA e DOPO la correzione dell'attribuzione.
 *
 *   npx tsx --env-file=.env scripts/cdr-confronto-attribuzione.ts [YYYY-MM ...]
 *
 * Sola lettura: non tocca il database. Serve a misurare quanto cambiano i
 * numeri per persona una volta rimessa a posto la corrispondenza
 * interno → operatore (vedi src/lib/cdr/attribuzione.ts).
 */
import { db } from '../src/db'
import { sql } from 'drizzle-orm'
import { mappaAttribuzione, chiaveGiorno } from '../src/lib/cdr/attribuzione'

const MIN_CHIAMATE_GIORNO = 40   // stessa soglia di analisi-pause-settimana.ts

type Riga = { src: string; dateLocal: string; userId: string | null; billsec: number; disposition: string }

async function main() {
    const mesi = process.argv.slice(2)
    const mappa = await mappaAttribuzione()

    const res = await db.execute(sql`
        SELECT p.src, p."dateLocal", p."userId", p.billsec, p.disposition
        FROM "pbxCalls" p WHERE p.direction = 'out' AND p."companyId" = 'fenice'
    `)
    const righe = res.rows as unknown as Riga[]

    const utenti = new Map<string, string>()
    for (const u of (await db.execute(sql`SELECT id, name FROM users`)).rows as any[]) utenti.set(u.id, u.name)

    // (persona, giorno) → chiamate, secondi di conversazione. Due volte: vecchia e nuova attribuzione.
    const agg = (chiave: (r: Riga) => string | null) => {
        const giorni = new Map<string, { n: number; voce: number; risposte30: number }>()
        for (const r of righe) {
            const uid = chiave(r)
            if (!uid) continue
            const k = `${uid}|${r.dateLocal}`
            const cur = giorni.get(k) ?? { n: 0, voce: 0, risposte30: 0 }
            cur.n++; cur.voce += r.billsec
            if (r.disposition === 'ANSWERED' && r.billsec >= 30) cur.risposte30++
            giorni.set(k, cur)
        }
        const perPersonaMese = new Map<string, { giornate: number; chiamate: number; voce: number; risposte30: number }>()
        for (const [k, v] of giorni) {
            if (v.n < MIN_CHIAMATE_GIORNO) continue
            const [uid, d] = k.split('|')
            const km = `${uid}|${d.slice(0, 7)}`
            const cur = perPersonaMese.get(km) ?? { giornate: 0, chiamate: 0, voce: 0, risposte30: 0 }
            cur.giornate++; cur.chiamate += v.n; cur.voce += v.voce; cur.risposte30 += v.risposte30
            perPersonaMese.set(km, cur)
        }
        return perPersonaMese
    }

    const prima = agg(r => r.userId)
    const dopo = agg(r => mappa.get(chiaveGiorno(r.src, r.dateLocal)) ?? null)

    const chiavi = [...new Set([...prima.keys(), ...dopo.keys()])]
        .filter(k => mesi.length === 0 || mesi.includes(k.split('|')[1]))
        .sort((a, b) => {
            const [ua, ma] = a.split('|'); const [ub, mb] = b.split('|')
            return ma === mb ? (utenti.get(ua) ?? '').localeCompare(utenti.get(ub) ?? '') : ma.localeCompare(mb)
        })

    console.log('mese     persona     | giornate  min voce/gg  chiamate/gg | giornate  min voce/gg  chiamate/gg | scarto')
    console.log('-'.repeat(112))
    let meseCorrente = ''
    for (const k of chiavi) {
        const [uid, mese] = k.split('|')
        const p = prima.get(k), d = dopo.get(k)
        if (mese !== meseCorrente) { if (meseCorrente) console.log(''); meseCorrente = mese }
        const f = (x?: { giornate: number; chiamate: number; voce: number }) => x
            ? `${String(x.giornate).padStart(8)}  ${String(Math.round(x.voce / 60 / x.giornate)).padStart(11)}  ${String(Math.round(x.chiamate / x.giornate)).padStart(11)}`
            : `${'—'.padStart(8)}  ${'—'.padStart(11)}  ${'—'.padStart(11)}`
        const dg = (d?.giornate ?? 0) - (p?.giornate ?? 0)
        console.log(`${mese}  ${(utenti.get(uid) ?? uid).padEnd(10)} |${f(p)} |${f(d)} | ${dg > 0 ? '+' : ''}${dg} gg`)
    }
    await (db as any).$client?.end?.()
}

main().catch(async (e) => { console.error(e); await (db as any).$client?.end?.(); process.exit(1) })
