/**
 * Go-live della nuova economia: Scintille e Piume (restyle "Diretta", PO 25/10/2026).
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/economia-azzera.ts           # prova: legge e basta
 *   node --import tsx --env-file=.env.local scripts/diretta/economia-azzera.ts --apply   # esegue
 *
 * Cosa fa, nell'ordine:
 *  1. Saldi Scintille e Piume a zero. Oggi sono già a zero; se qualcuno li ha
 *     mossi provando su una preview (che usa il DB di produzione), per ogni
 *     saldo diverso da zero scrive una riga di azzeramento nel registro, con
 *     chiave fissa: saldo e registro restano allineati e nulla si cancella.
 *     walletCoins non si tocca: resta come storico della vecchia economia.
 *  2. Disattiva i vecchi articoli del negozio (shopItems.isActive = false).
 *     Mai cancellati.
 *  3. 200 Scintille di benvenuto a Riccardo (119) e Zora (106), chiave fissa.
 *
 * Idempotente: un secondo giro non scrive niente. Va eseguito PRIMA che i GDO
 * comincino a fissare (lunedì 26/10 prima delle 13:30): se nel registro ci
 * sono già premi veri, il punto 1 si ferma e chiede --forza, perché toglierebbe
 * anche Scintille guadagnate davvero.
 */
import { and, count, eq, inArray, notInArray, or, ne, sql, sum } from 'drizzle-orm'
import { db } from '../../src/db'
import { currencyLedger, shopItems, users } from '../../src/db/schema'
import { creditOnce } from '../../src/lib/economy/ledger'

const APPLY = process.argv.includes('--apply')
const FORZA = process.argv.includes('--forza')
const TAG = 'diretta-2026-10-26'

const BENVENUTO = [
    { gdoCode: 119, firstName: 'Riccardo' },
    { gdoCode: 106, firstName: 'Zora' },
] as const
const SCINTILLE_BENVENUTO = 200

/** Causali che non sono premi veri: le scrive solo questo script. */
const CAUSALI_GO_LIVE = ['benvenuto', 'azzeramento']

const chiaveAzzeramento = (valuta: 'S' | 'P', userId: string) => `${valuta}:azzeramento:${userId}:${TAG}`
const chiaveBenvenuto = (userId: string) => `S:benvenuto:${userId}:${TAG}`

async function chiaviEsistenti(chiavi: string[]): Promise<Set<string>> {
    if (!chiavi.length) return new Set()
    const rows = await db.select({ idemKey: currencyLedger.idemKey }).from(currencyLedger)
        .where(inArray(currencyLedger.idemKey, chiavi))
    return new Set(rows.map(r => r.idemKey))
}

async function main() {
    console.log(APPLY ? '=== ESECUZIONE (--apply) ===' : '=== PROVA: nessuna scrittura (aggiungi --apply per eseguire) ===')

    // ── Stato del registro ──────────────────────────────────────────────
    const registro = await db.select({
        reason: currencyLedger.reason,
        currency: currencyLedger.currency,
        righe: count(),
        totale: sum(currencyLedger.amount),
    }).from(currencyLedger).groupBy(currencyLedger.reason, currencyLedger.currency)
    console.log(`\nRegistro Scintille/Piume: ${registro.length ? '' : 'vuoto'}`)
    for (const r of registro) console.log(`  ${r.currency} ${r.reason.padEnd(28)} righe ${r.righe}  totale ${r.totale}`)

    const [{ premiVeri }] = await db.select({ premiVeri: count() }).from(currencyLedger)
        .where(notInArray(currencyLedger.reason, CAUSALI_GO_LIVE))

    // ── 1. Saldi a zero ─────────────────────────────────────────────────
    const conSaldo = await db.select({
        id: users.id, gdoCode: users.gdoCode, displayName: users.displayName, firstName: users.firstName,
        scintille: users.scintille, piume: users.piume,
    }).from(users).where(or(ne(users.scintille, 0), ne(users.piume, 0)))

    console.log(`\n1. Saldi diversi da zero: ${conSaldo.length}`)
    const giaAzzerati = await chiaviEsistenti(conSaldo.flatMap(u => [chiaveAzzeramento('S', u.id), chiaveAzzeramento('P', u.id)]))
    for (const u of conSaldo) {
        console.log(`  ${u.firstName ?? u.displayName ?? u.id}: Scintille ${u.scintille}, Piume ${u.piume}`)
    }
    if (conSaldo.length && Number(premiVeri) > 0 && !FORZA) {
        console.log(`  FERMO: nel registro ci sono ${premiVeri} righe di premi veri (fissati, Piume, forzieri).`)
        console.log('  Azzerare ora toglierebbe anche Scintille guadagnate davvero. Se sono solo prove, rilancia con --forza.')
    } else if (APPLY) {
        let scritte = 0
        for (const u of conSaldo) {
            for (const [valuta, saldo] of [['S', u.scintille], ['P', u.piume]] as const) {
                if (saldo === 0 || giaAzzerati.has(chiaveAzzeramento(valuta, u.id))) continue
                const ok = await creditOnce({
                    userId: u.id, currency: valuta, amount: -saldo, reason: 'azzeramento',
                    idemKey: chiaveAzzeramento(valuta, u.id),
                    metadata: { nota: 'Azzeramento al go-live della nuova economia (PO 25/10/2026)' },
                })
                if (ok) scritte++
            }
        }
        console.log(`  Righe di azzeramento scritte: ${scritte}`)
    }

    // ── 2. Vecchi articoli del negozio ──────────────────────────────────
    const attivi = await db.select({ id: shopItems.id, name: shopItems.name, cost: shopItems.cost })
        .from(shopItems).where(eq(shopItems.isActive, true))
    console.log(`\n2. Vecchi articoli del negozio ancora attivi: ${attivi.length}`)
    for (const a of attivi) console.log(`  ${a.name} (${a.cost} monete)`)
    if (APPLY && attivi.length) {
        const spenti = await db.update(shopItems).set({ isActive: false })
            .where(and(eq(shopItems.isActive, true), inArray(shopItems.id, attivi.map(a => a.id))))
            .returning({ id: shopItems.id })
        console.log(`  Disattivati: ${spenti.length}`)
    }

    // ── 3. Benvenuto a Riccardo e Zora ──────────────────────────────────
    console.log(`\n3. Benvenuto: ${SCINTILLE_BENVENUTO} Scintille`)
    const persone = await db.select({ id: users.id, gdoCode: users.gdoCode, firstName: users.firstName, role: users.role })
        .from(users).where(inArray(users.gdoCode, BENVENUTO.map(b => b.gdoCode)))
    const giaDati = await chiaviEsistenti(persone.map(p => chiaveBenvenuto(p.id)))
    for (const b of BENVENUTO) {
        const p = persone.find(x => x.gdoCode === b.gdoCode)
        if (!p || p.role !== 'GDO' || p.firstName?.trim() !== b.firstName) {
            console.log(`  ${b.gdoCode}: SALTATO, l'account non corrisponde a ${b.firstName} (trovato: ${p?.firstName ?? 'nessuno'})`)
            continue
        }
        if (giaDati.has(chiaveBenvenuto(p.id))) {
            console.log(`  ${b.firstName} (${b.gdoCode}): già accreditate`)
            continue
        }
        if (!APPLY) {
            console.log(`  ${b.firstName} (${b.gdoCode}): da accreditare`)
            continue
        }
        const ok = await creditOnce({
            userId: p.id, currency: 'S', amount: SCINTILLE_BENVENUTO, reason: 'benvenuto',
            idemKey: chiaveBenvenuto(p.id),
            metadata: { nota: 'Benvenuto nella nuova economia (PO 25/10/2026)' },
        })
        console.log(`  ${b.firstName} (${b.gdoCode}): ${ok ? 'accreditate' : 'già presenti'}`)
    }

    // Controllo finale: il saldo in cache su users deve essere la somma del registro.
    const sommaRegistro = (valuta: 'S' | 'P') =>
        sql`coalesce((select sum(l."amount") from ${currencyLedger} l where l."userId" = ${users.id} and l."currency" = ${valuta}), 0)`
    const disallineati = await db.select({ id: users.id, firstName: users.firstName })
        .from(users)
        .where(or(ne(users.scintille, sommaRegistro('S')), ne(users.piume, sommaRegistro('P'))))
    console.log(`\nControllo saldi = registro: ${disallineati.length ? `${disallineati.length} disallineati` : 'tutto allineato'}`)
    for (const d of disallineati) console.log(`  ${d.firstName ?? d.id}`)

    console.log(APPLY ? '\nFatto.' : '\nProva finita: niente è stato scritto.')
}

main().then(() => process.exit(0), (e) => {
    console.error(e)
    process.exit(1)
})
