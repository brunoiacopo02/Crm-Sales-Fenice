/**
 * Carica in rewardItems il catalogo del negozio nuovo della Diretta
 * (src/lib/diretta/negozioCatalogo.ts, prezzi da far approvare a Bruno).
 *
 *   npx tsx --env-file=.env.local scripts/diretta/negozio-catalogo.ts           # prova, nessuna scrittura
 *   npx tsx --env-file=.env.local scripts/diretta/negozio-catalogo.ts --apply   # scrive
 *
 * Idempotente sugli id: un articolo che manca si crea; uno che c'è già si
 * allinea al catalogo (nome, descrizione, tipo, valuta, prezzo, immagine,
 * ruoli, regalabile, ordine) e torna in vendita. Rilanciarlo senza modifiche
 * non scrive niente. Non cancella nulla: gli articoli di rewardItems che non
 * stanno nel catalogo restano come sono e vengono solo elencati. Le richieste
 * già fatte tengono il loro prezzo (rewardPurchases.price).
 *
 * I vecchi articoli del Fenice Store (shopItems) non si toccano qui.
 */
import { inArray } from 'drizzle-orm'
import { db } from '../../src/db'
import { rewardItems } from '../../src/db/schema'
import { CATALOGO_NEGOZIO, RITIRATI_NEGOZIO, settimaneAlMassimo, type CatalogItem } from '../../src/lib/diretta/negozioCatalogo'

const FENICE = 'fenice'

type Riga = typeof rewardItems.$inferSelect

function campi(item: CatalogItem) {
    return {
        name: item.name,
        description: item.description,
        kind: item.kind,
        currency: item.currency,
        price: item.price,
        imageUrl: item.imageUrl,
        roles: item.roles,
        giftable: item.giftable,
        sortOrder: item.sortOrder,
        isActive: true,
    }
}

function differenze(row: Riga, item: CatalogItem): string[] {
    const atteso = campi(item)
    const out: string[] = []
    for (const [k, v] of Object.entries(atteso)) {
        const attuale = (row as Record<string, unknown>)[k]
        const uguale = Array.isArray(v)
            ? Array.isArray(attuale) && attuale.length === v.length && v.every((x, i) => attuale[i] === x)
            : attuale === v
        if (!uguale) out.push(`${k}: ${JSON.stringify(attuale)} -> ${JSON.stringify(v)}`)
    }
    return out
}

async function main() {
    const apply = process.argv.includes('--apply')
    const ids = CATALOGO_NEGOZIO.map(i => i.id)

    const tutti = await db.select().from(rewardItems)
    const conflitti = tutti.filter(r => ids.includes(r.id) && r.companyId !== FENICE)
    if (conflitti.length > 0) {
        throw new Error(`id già usati da un'altra azienda: ${conflitti.map(r => `${r.id} (${r.companyId})`).join(', ')}`)
    }
    const esistenti = new Map(tutti.filter(r => r.companyId === FENICE).map(r => [r.id, r]))

    const nuovi: CatalogItem[] = []
    const daAllineare: { item: CatalogItem; diff: string[] }[] = []
    for (const item of CATALOGO_NEGOZIO) {
        const row = esistenti.get(item.id)
        if (!row) nuovi.push(item)
        else {
            const diff = differenze(row, item)
            if (diff.length > 0) daAllineare.push({ item, diff })
        }
    }
    const fuoriCatalogo = tutti.filter(r => r.companyId === FENICE && !ids.includes(r.id))

    console.log(`Catalogo: ${CATALOGO_NEGOZIO.length} articoli, in rewardItems ne esistono ${esistenti.size}.`)
    console.log('')
    for (const i of CATALOGO_NEGOZIO) {
        const settimane = settimaneAlMassimo(i.currency, i.price).toFixed(1)
        const valuta = i.currency === 'P' ? 'Piume' : 'Scintille'
        console.log(`  ${i.id.padEnd(26)} ${String(i.price).padStart(5)} ${valuta.padEnd(9)} ${settimane.padStart(5)} sett. al massimo  ${i.kind}${i.giftable ? ', regalabile' : ''}  per ${i.roles.join(' e ')}`)
    }
    console.log('')
    console.log(`Da creare: ${nuovi.length}`)
    for (const i of nuovi) console.log(`  + ${i.id}`)
    console.log(`Da allineare: ${daAllineare.length}`)
    for (const { item, diff } of daAllineare) {
        console.log(`  ~ ${item.id}`)
        for (const d of diff) console.log(`      ${d}`)
    }
    const daSpegnere = fuoriCatalogo.filter(r => r.isActive && RITIRATI_NEGOZIO.includes(r.id))
    const restanti = fuoriCatalogo.filter(r => !daSpegnere.includes(r))
    if (daSpegnere.length > 0) console.log(`Ritirati, da spegnere: ${daSpegnere.map(r => r.id).join(', ')}`)
    if (restanti.length > 0) {
        console.log(`Fuori catalogo (lasciati come sono): ${restanti.map(r => `${r.id}${r.isActive ? '' : ' (spento)'}`).join(', ')}`)
    }

    const daScrivere = [...nuovi, ...daAllineare.map(d => d.item)]
    if (daScrivere.length === 0 && daSpegnere.length === 0) {
        console.log('\nNiente da scrivere: rewardItems è già allineato al catalogo.')
        return
    }
    if (!apply) {
        console.log('\nProva: nessuna scrittura. Rilancia con --apply per scrivere.')
        return
    }

    await db.transaction(async (tx) => {
        for (const item of daScrivere) {
            const values = campi(item)
            await tx.insert(rewardItems)
                .values({ id: item.id, companyId: FENICE, ...values })
                .onConflictDoUpdate({ target: rewardItems.id, set: values })
        }
        if (daSpegnere.length > 0) {
            await tx.update(rewardItems).set({ isActive: false })
                .where(inArray(rewardItems.id, daSpegnere.map(r => r.id)))
        }
    })
    const dopo = await db.select({ id: rewardItems.id }).from(rewardItems).where(inArray(rewardItems.id, ids))
    if (daSpegnere.length > 0) console.log(`Spenti: ${daSpegnere.length} articoli ritirati.`)
    console.log(`\nScritto: ${daScrivere.length} articoli. In rewardItems ora ci sono ${dopo.length} articoli del catalogo.`)
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
