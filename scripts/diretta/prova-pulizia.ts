/**
 * Pulizia dei dati di prova (migr. 0050, PO 25/10/2026). Le regole sono in src/lib/prova.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/prova-pulizia.ts            # dry-run: conta e basta
 *   node --import tsx --env-file=.env.local scripts/diretta/prova-pulizia.ts --esegui   # cancella
 *
 * Cancella SOLO le righe col marcatore di prova:
 *  - i lead con leads.isTest = true, con i loro callLog ed eventi (e, per le
 *    chiavi esterne in cascata, note Conferme, sondaggi, consegne marketing);
 *  - le notifiche degli account di prova e quelle che parlano di un lead di prova;
 *  - il registro Scintille/Piume e gli acquisti del negozio degli account di
 *    prova (users.isTest = true), con il saldo in cache riportato a zero.
 * Gli account restano: prova-setup.ts --esegui li rifornisce di lead e saldo.
 *
 * Il controllo: prima di scrivere rilegge ogni riga che cancellerebbe insieme
 * alla prova del suo marcatore (il lead è isTest, l'account è isTest). Se anche
 * una sola riga non ce l'ha, si ferma senza toccare niente. Ogni DELETE ripete
 * il marcatore nel WHERE e conta le righe: se il numero non torna con quello
 * letto prima, annulla tutto (una transazione sola).
 */
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { callLogs, currencyLedger, leadEvents, leads, notifications, rewardPurchases, teamChestAwards, users } from '../../src/db/schema'
import { senzaMarcatore } from '../../src/lib/prova/regole'
import { ACCOUNT_PROVA } from '../../src/lib/prova/piano'

const ESEGUI = process.argv.includes('--esegui')

/** Un insieme di righe da cancellare, ognuna con la prova del suo marcatore. */
interface Gruppo { nome: string; righe: { id: string; isTest: boolean | null }[] }

class Rifiuto extends Error {}

function controlla(gruppi: Gruppo[]) {
    for (const g of gruppi) {
        const senza = senzaMarcatore(g.righe)
        if (senza.length > 0) {
            throw new Rifiuto(`${g.nome}: ${senza.length} righe senza marcatore di prova (es. ${senza.slice(0, 3).map(r => r.id).join(', ')}). Non cancello niente.`)
        }
    }
}

async function main() {
    console.log(ESEGUI ? '=== ESECUZIONE (--esegui) ===' : '=== DRY-RUN: nessuna cancellazione (aggiungi --esegui per cancellare) ===')

    const colonne = await db.execute(sql`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'isTest' and table_name in ('users', 'leads')
    `)
    if (colonne.rows.length !== 2) {
        console.log('Migrazione 0050 non applicata: non esistono dati di prova da pulire.')
        return
    }

    // ── Chi e cosa è di prova ────────────────────────────────────────────
    const account = await db.select({ id: users.id, email: users.email, role: users.role, isTest: users.isTest })
        .from(users).where(eq(users.isTest, true))
    const idAccount = account.map(a => a.id)
    console.log(`\nAccount di prova: ${account.length ? account.map(a => `${a.email} (${a.role})`).join(', ') : 'nessuno'}`)
    // Le email di prova su un account NON marcato restano fuori: non si toccano.
    const emailProva = ACCOUNT_PROVA.map(a => a.email)
    const nonMarcati = await db.select({ email: users.email }).from(users)
        .where(and(inArray(users.email, emailProva), eq(users.isTest, false)))
    for (const n of nonMarcati) console.log(`  ATTENZIONE: ${n.email} esiste ma non è marcato isTest: escluso dalla pulizia.`)

    const leadProva = await db.select({ id: leads.id, name: leads.name, isTest: leads.isTest })
        .from(leads).where(eq(leads.isTest, true))
    const idLead = leadProva.map(l => l.id)
    console.log(`Lead di prova: ${leadProva.length}`)

    // ── Le righe da cancellare, ciascuna col suo marcatore ───────────────
    const perLead = <T>(f: () => Promise<T[]>) => (idLead.length ? f() : Promise.resolve([] as T[]))
    const perAccount = <T>(f: () => Promise<T[]>) => (idAccount.length ? f() : Promise.resolve([] as T[]))

    const [chiamate, eventi, notificheAccount, notificheLead, registro, acquisti] = await Promise.all([
        perLead(() => db.select({ id: callLogs.id, isTest: leads.isTest }).from(callLogs)
            .innerJoin(leads, eq(leads.id, callLogs.leadId)).where(eq(leads.isTest, true))),
        perLead(() => db.select({ id: leadEvents.id, isTest: leads.isTest }).from(leadEvents)
            .innerJoin(leads, eq(leads.id, leadEvents.leadId)).where(eq(leads.isTest, true))),
        perAccount(() => db.select({ id: notifications.id, isTest: users.isTest }).from(notifications)
            .innerJoin(users, eq(users.id, notifications.recipientUserId)).where(eq(users.isTest, true))),
        // Notifiche a persone vere che parlano di un lead di prova: il marcatore è il lead.
        perLead(() => db.select({ id: notifications.id, isTest: leads.isTest }).from(notifications)
            .innerJoin(leads, sql`${leads.id} = ${notifications.metadata}->>'leadId'`)
            .innerJoin(users, eq(users.id, notifications.recipientUserId))
            .where(and(eq(leads.isTest, true), eq(users.isTest, false)))),
        perAccount(() => db.select({ id: currencyLedger.id, isTest: users.isTest }).from(currencyLedger)
            .innerJoin(users, eq(users.id, currencyLedger.userId)).where(eq(users.isTest, true))),
        perAccount(() => db.select({ id: rewardPurchases.id, isTest: users.isTest }).from(rewardPurchases)
            .innerJoin(users, eq(users.id, rewardPurchases.userId)).where(eq(users.isTest, true))),
    ])

    const gruppi: Gruppo[] = [
        { nome: 'Lead', righe: leadProva },
        { nome: 'CallLog dei lead di prova', righe: chiamate },
        { nome: 'Eventi dei lead di prova', righe: eventi },
        { nome: 'Notifiche agli account di prova', righe: notificheAccount },
        { nome: 'Notifiche su lead di prova (ad altri)', righe: notificheLead },
        { nome: 'Registro Scintille/Piume degli account di prova', righe: registro },
        { nome: 'Acquisti del negozio degli account di prova', righe: acquisti },
    ]
    console.log('\nDa cancellare:')
    for (const g of gruppi) console.log(`  ${g.nome.padEnd(50)} ${g.righe.length}`)

    // ── Cose che non dovrebbero esistere: si mostrano, non si toccano ─────
    const [chiamateSuVeri, eventiSuVeri, veriAssegnati, veriConfermati, premiVeriSuProva, forzieri] = await Promise.all([
        perAccount(() => db.select({ id: callLogs.id }).from(callLogs)
            .innerJoin(leads, eq(leads.id, callLogs.leadId))
            .where(and(inArray(callLogs.userId, idAccount), eq(leads.isTest, false)))),
        perAccount(() => db.select({ id: leadEvents.id }).from(leadEvents)
            .innerJoin(leads, eq(leads.id, leadEvents.leadId))
            .where(and(inArray(leadEvents.userId, idAccount), eq(leads.isTest, false)))),
        perAccount(() => db.select({ id: leads.id }).from(leads)
            .where(and(inArray(leads.assignedToId, idAccount), eq(leads.isTest, false)))),
        // Le Scintille delle Conferme seguono confirmationsUserId: un lead vero
        // confermato da un account di prova va guardato a mano.
        perAccount(() => db.select({ id: leads.id }).from(leads)
            .where(and(inArray(leads.confirmationsUserId, idAccount), eq(leads.isTest, false)))),
        perLead(() => db.select({ id: currencyLedger.id }).from(currencyLedger)
            .innerJoin(users, eq(users.id, currencyLedger.userId))
            .where(and(inArray(currencyLedger.leadId, idLead), eq(users.isTest, false)))),
        perAccount(() => db.select({ id: teamChestAwards.id }).from(teamChestAwards).where(inArray(teamChestAwards.userId, idAccount))),
    ])
    const anomalie = [
        ['callLog di account di prova su lead veri', chiamateSuVeri.length],
        ['eventi di account di prova su lead veri', eventiSuVeri.length],
        ['lead veri assegnati a un account di prova', veriAssegnati.length],
        ['lead veri confermati da un account di prova', veriConfermati.length],
        ['righe del registro di persone vere su lead di prova', premiVeriSuProva.length],
        ['forzieri di squadra agli account di prova', forzieri.length],
    ] as const
    if (anomalie.some(([, n]) => n > 0)) {
        console.log('\nNon cancellati (non hanno il marcatore di prova, da guardare a mano):')
        for (const [nome, n] of anomalie) if (n > 0) console.log(`  ${nome}: ${n}`)
    }

    controlla(gruppi)
    console.log('\nControllo marcatori: ogni riga da cancellare è di prova.')

    if (!ESEGUI) {
        console.log('\nDry-run finito: niente è stato cancellato.')
        return
    }
    if (gruppi.every(g => g.righe.length === 0)) {
        console.log('\nNiente da cancellare.')
        return
    }

    const attesi = (g: Gruppo) => new Set(g.righe.map(r => r.id))
    const verifica = (nome: string, cancellati: { id: string }[], g: Gruppo) => {
        const voluti = attesi(g)
        if (cancellati.length !== voluti.size || cancellati.some(r => !voluti.has(r.id))) {
            throw new Rifiuto(`${nome}: cancellate ${cancellati.length} righe, attese ${voluti.size}. Annullo tutto.`)
        }
        console.log(`  ${nome}: ${cancellati.length}`)
    }
    const idsDi = (g: Gruppo) => g.righe.map(r => r.id)
    const soloSe = async (g: Gruppo, f: () => Promise<{ id: string }[]>) => (g.righe.length ? f() : [])

    console.log('\nCancellazione (una transazione):')
    await db.transaction(async (tx) => {
        const leadDiProva = tx.select({ id: leads.id }).from(leads).where(eq(leads.isTest, true))
        const accountDiProva = tx.select({ id: users.id }).from(users).where(eq(users.isTest, true))

        verifica('Notifiche agli account di prova', await soloSe(gruppi[3], () => tx.delete(notifications)
            .where(and(inArray(notifications.id, idsDi(gruppi[3])), inArray(notifications.recipientUserId, accountDiProva)))
            .returning({ id: notifications.id })), gruppi[3])
        verifica('Notifiche su lead di prova', await soloSe(gruppi[4], () => tx.delete(notifications)
            .where(and(
                inArray(notifications.id, idsDi(gruppi[4])),
                inArray(sql`${notifications.metadata}->>'leadId'`, leadDiProva),
            ))
            .returning({ id: notifications.id })), gruppi[4])
        verifica('CallLog', await soloSe(gruppi[1], () => tx.delete(callLogs)
            .where(and(inArray(callLogs.id, idsDi(gruppi[1])), inArray(callLogs.leadId, leadDiProva)))
            .returning({ id: callLogs.id })), gruppi[1])
        verifica('Eventi', await soloSe(gruppi[2], () => tx.delete(leadEvents)
            .where(and(inArray(leadEvents.id, idsDi(gruppi[2])), inArray(leadEvents.leadId, leadDiProva)))
            .returning({ id: leadEvents.id })), gruppi[2])
        verifica('Registro', await soloSe(gruppi[5], () => tx.delete(currencyLedger)
            .where(and(inArray(currencyLedger.id, idsDi(gruppi[5])), inArray(currencyLedger.userId, accountDiProva)))
            .returning({ id: currencyLedger.id })), gruppi[5])
        verifica('Acquisti', await soloSe(gruppi[6], () => tx.delete(rewardPurchases)
            .where(and(inArray(rewardPurchases.id, idsDi(gruppi[6])), inArray(rewardPurchases.userId, accountDiProva)))
            .returning({ id: rewardPurchases.id })), gruppi[6])
        verifica('Lead', await soloSe(gruppi[0], () => tx.delete(leads)
            .where(and(inArray(leads.id, idsDi(gruppi[0])), eq(leads.isTest, true)))
            .returning({ id: leads.id })), gruppi[0])

        // Registro vuoto = saldo zero: la cache su users resta allineata, e
        // l'immagine profilo comprata se ne va con l'acquisto.
        if (idAccount.length) {
            const azzerati = await tx.update(users)
                .set({ scintille: 0, piume: 0, profileImageUrl: null })
                .where(and(inArray(users.id, idAccount), eq(users.isTest, true), or(ne(users.scintille, 0), ne(users.piume, 0), sql`${users.profileImageUrl} is not null`)))
                .returning({ id: users.id })
            console.log(`  Saldi degli account di prova a zero: ${azzerati.length}`)
        }
    })
    console.log('\nFatto. Per ripartire: prova-setup.ts --esegui.')
}

main().then(() => process.exit(0), (e) => {
    console.error(e instanceof Rifiuto ? `RIFIUTO: ${e.message}` : e)
    process.exit(1)
})
