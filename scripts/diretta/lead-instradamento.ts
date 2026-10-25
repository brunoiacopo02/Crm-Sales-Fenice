/**
 * Go-live Diretta (PO 25/10/2026): chi riceve i lead.
 *
 *   - ridati dal bot (chat interrotta): tutta la squadra, tranne Beatrice (112)
 *     e Christel (114) che sono in malattia e Lorenzo (118);
 *   - vergini (lead freschi da ActiveCampaign): 10 al giorno a testa, tranne
 *     Lorenzo (118), Beatrice e Christel. Oltre i 10 i lead vanno al bot, come
 *     prima (la catena sta nel webhook AC, `ordineRipiegoFreschi`).
 *
 * Lorenzo non riceve lead nuovi finché Bruno non lo accende da /gestione (PO
 * 25/10 mattina): i suoi lead e i suoi tetti li sistema lead-lorenzo.ts.
 *
 * Scrive i flag che /gestione già governa: Freschi (`acAutoIntake`), Ridati
 * (`botReturnIntake`) e Tetto/gg (`dailyFreshCap`). Dopo il go-live assenze e
 * rientri si gestiscono da lì, senza script. Tocca solo i GDO della squadra
 * (con nome vero): il bot e gli account senza nome restano come sono, e il
 * codice non manda loro lead nemmeno con un flag acceso.
 *
 * Dry-run di default: stampa il piano e chi riceverà cosa. Idempotente:
 * rilanciato dopo `--esegui` non trova più niente da cambiare.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/lead-instradamento.ts [--esegui]
 *        [--ridati-esclusi=112,114,118] [--vergini-esclusi=112,114,118] [--tetto=10]
 *
 * Ordine al go-live: prima account-attiva.ts (107 e 116 accesi), poi questo.
 * Al contrario funziona lo stesso, ma un account spento non riceve niente.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../../src/db'
import { users } from '../../src/db/schema'
import {
    pianoInstradamento, riceveRidati, riceveVergini, SCELTE_PO_25_10,
    type GdoInstradabile, type ScelteInstradamento,
} from '../../src/lib/diretta/instradamento'

const FENICE = 'fenice'

function opzione(nome: string): string | undefined {
    const pref = `--${nome}=`
    return process.argv.find((a) => a.startsWith(pref))?.slice(pref.length)
}

function codici(nome: string, predefiniti: number[]): number[] {
    const raw = opzione(nome)
    if (raw === undefined) return predefiniti
    if (raw.trim() === '') return []
    const lista = raw.split(',').map((s) => Number(s.trim()))
    if (lista.some((n) => !Number.isInteger(n))) throw new Error(`--${nome}: codici GDO non validi (${raw})`)
    return lista
}

function leggiScelte(): ScelteInstradamento {
    const tetto = opzione('tetto')
    const verginiAlGiorno = tetto === undefined ? SCELTE_PO_25_10.verginiAlGiorno : Number(tetto)
    if (!Number.isInteger(verginiAlGiorno) || verginiAlGiorno < 0 || verginiAlGiorno > 1000) {
        throw new Error(`--tetto deve essere un intero fra 0 e 1000 (ricevuto ${tetto})`)
    }
    return {
        ridatiEsclusi: codici('ridati-esclusi', SCELTE_PO_25_10.ridatiEsclusi),
        verginiEsclusi: codici('vergini-esclusi', SCELTE_PO_25_10.verginiEsclusi),
        verginiAlGiorno,
    }
}

const flag = (f: { acAutoIntake: boolean; botReturnIntake: boolean; dailyFreshCap: number | null }) =>
    `freschi=${f.acAutoIntake ? 'sì' : 'no'} ridati=${f.botReturnIntake ? 'sì' : 'no'} tetto=${f.dailyFreshCap ?? '—'}`

async function main() {
    const esegui = process.argv.includes('--esegui')
    const scelte = leggiScelte()

    const gdos: GdoInstradabile[] = await db.select({
        id: users.id,
        gdoCode: users.gdoCode,
        role: users.role,
        isActive: users.isActive,
        isBot: users.isBot,
        firstName: users.firstName,
        acAutoIntake: users.acAutoIntake,
        botReturnIntake: users.botReturnIntake,
        dailyFreshCap: users.dailyFreshCap,
    }).from(users).where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO')))

    console.log(`Scelte: ridati esclusi [${scelte.ridatiEsclusi.join(', ')}], vergini esclusi [${scelte.verginiEsclusi.join(', ')}], ${scelte.verginiAlGiorno} vergini al giorno.\n`)

    const piano = pianoInstradamento(gdos, scelte)
    if (piano.length === 0) {
        console.log('Niente da cambiare: i flag sono già quelli decisi.')
    } else {
        console.log(`Da cambiare (${piano.length}):`)
        for (const r of piano) {
            const spento = r.accountSpento ? '  [account spento: va acceso con account-attiva.ts]' : ''
            console.log(`  ${r.gdoCode} ${r.nome}: ${flag(r.prima)}  →  ${flag(r.dopo)}${spento}`)
        }
    }

    // Chi riceverà cosa a piano applicato, con l'isActive di adesso.
    const dopo = gdos.map((g) => {
        const r = piano.find((x) => x.id === g.id)
        return r ? { ...g, ...r.dopo } : g
    })
    const nomi = (lista: GdoInstradabile[]) => lista
        .sort((a, b) => (a.gdoCode ?? 0) - (b.gdoCode ?? 0))
        .map((g) => `${g.gdoCode} ${g.firstName}`).join(', ') || 'nessuno'
    console.log(`\nRiceveranno i ridati: ${nomi(dopo.filter(riceveRidati))}`)
    console.log(`Riceveranno i vergini (${scelte.verginiAlGiorno} al giorno): ${nomi(dopo.filter(riceveVergini))}`)

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. Rilancia con --esegui per applicare.')
        return
    }
    if (piano.length === 0) return

    await db.transaction(async (tx) => {
        for (const r of piano) {
            // Il WHERE riafferma chi è: un id finito per errore nel piano non
            // può toccare il bot né un utente di un altro ruolo.
            await tx.update(users)
                .set(r.dopo)
                .where(and(
                    eq(users.id, r.id),
                    eq(users.companyId, FENICE),
                    eq(users.role, 'GDO'),
                    eq(users.isBot, false),
                ))
        }
    })
    console.log(`\nScritto: ${piano.length} GDO aggiornati.`)
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
