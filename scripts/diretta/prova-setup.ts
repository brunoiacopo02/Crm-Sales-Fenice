/**
 * Account e lead di prova, per provare il CRM in produzione senza sporcare
 * niente di vero (migr. 0050, PO 25/10/2026). Le regole sono in src/lib/prova.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/prova-setup.ts            # dry-run: legge e basta
 *   node --import tsx --env-file=.env.local scripts/diretta/prova-setup.ts --esegui   # scrive
 *
 * Crea, se mancano:
 *  1. due account Supabase Auth (admin API, service role di .env.local) e le
 *     righe public.users coerenti: stesso id, isTest=true, solo Fenice;
 *     - prova.gdo@fenice.local, GDO, gdoCode 990, "Prova GDO";
 *     - prova.conferme@fenice.local, CONFERME, "Prova Conferme";
 *     password per entrambi Diretta2026 (o PROVA_PASSWORD), solo alla creazione;
 *  2. il saldo di prova per il negozio (Scintille e Piume nel registro, causale
 *     saldo_prova), ricaricato solo se è sotto il minimo;
 *  3. 25 lead di prova (leads.isTest) del GDO di prova: 3 vergini appena
 *     arrivati, 1ª, 2ª e 3ª chiamata, richiami scaduti e in arrivo, 2
 *     appuntamenti da confermare per l'account Conferme di prova.
 *
 * Idempotente: un account o un lead che c'è già non si ricrea (i lead si
 * riconoscono dal nome, "Prova Uno" ... "Prova Venticinque"). Si ferma se trova
 * un account con la stessa email o lo stesso gdoCode che non è marcato isTest.
 *
 * Va eseguito DOPO la migrazione 0050. Per rimettere i lead come nuovi:
 * prova-pulizia.ts --esegui, poi di nuovo questo.
 */
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { callLogs, currencyLedger, leadEvents, leads, users } from '../../src/db/schema'
import { creditOnce, type Currency } from '../../src/lib/economy/ledger'
import {
    ACCOUNT_PROVA, AZIENDA_PROVA, SALDO_PROVA, pianoLeadDiProva, ricaricaPerSaldo, type AccountProva,
} from '../../src/lib/prova/piano'

const ESEGUI = process.argv.includes('--esegui')
const PASSWORD = process.env.PROVA_PASSWORD || 'Diretta2026'
const CAUSALE_SALDO = 'saldo_prova'

const fmt = (d: Date | null) => d
    ? new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
    : '—'

async function migrazioneApplicata(): Promise<boolean> {
    const r = await db.execute(sql`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'isTest' and table_name in ('users', 'leads')
    `)
    return r.rows.length === 2
}

function supabaseAdmin() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local')
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

type Admin = ReturnType<typeof supabaseAdmin>

async function utenteAuthPerEmail(admin: Admin, email: string): Promise<{ id: string } | null> {
    for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw new Error(`Supabase Auth: ${error.message}`)
        const u = data.users.find(x => x.email?.toLowerCase() === email.toLowerCase())
        if (u) return { id: u.id }
        if (data.users.length < 1000) return null
    }
    return null
}

const metadataAuth = (a: AccountProva) => ({ name: a.firstName, role: a.role, allowedCompanies: [AZIENDA_PROVA] })

/** I campi di public.users che l'account di prova deve avere. */
const campiAttesi = (a: AccountProva) => ({
    name: a.firstName,
    role: a.role,
    companyId: AZIENDA_PROVA,
    area: 'sales',
    allowedCompanies: [AZIENDA_PROVA],
    gdoCode: a.gdoCode,
    displayName: a.firstName,
    firstName: a.firstName,
    isActive: true,
    isTest: true,
    // Fuori da ogni statistica e da ogni giro di lead, anche se qualcuno
    // toccasse i flag da /gestione: le esclusioni del codice valgono comunque.
    statsActive: false,
    phoneTimeTracked: false,
    acAutoIntake: false,
    botReturnIntake: false,
    freshOverflowScorta: false,
})

/** Account pronto (o da creare): id noto solo se esiste già da qualche parte. */
interface StatoAccount { account: AccountProva; id: string | null; nuovo: boolean }

async function preparaAccount(admin: Admin, migrata: boolean): Promise<StatoAccount[]> {
    const stati: StatoAccount[] = []
    for (const a of ACCOUNT_PROVA) {
        console.log(`\n· ${a.email} (${a.role}${a.gdoCode ? `, GDO ${a.gdoCode}` : ''})`)
        const [riga] = await db.select({
            id: users.id, role: users.role, gdoCode: users.gdoCode, firstName: users.firstName,
            companyId: users.companyId, allowedCompanies: users.allowedCompanies, isActive: users.isActive,
        }).from(users).where(eq(users.email, a.email)).limit(1)

        if (a.gdoCode !== null) {
            const conCodice = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.gdoCode, a.gdoCode))
            const altro = conCodice.find(u => u.email?.toLowerCase() !== a.email.toLowerCase())
            if (altro) throw new Error(`gdoCode ${a.gdoCode} è già di ${altro.email}: mi fermo, non tocco account veri.`)
        }

        if (riga) {
            if (!migrata) {
                console.log('  esiste in public.users (non verificabile se è di prova: manca la migrazione 0050)')
                stati.push({ account: a, id: riga.id, nuovo: false })
                continue
            }
            const [{ isTest }] = await db.select({ isTest: users.isTest }).from(users).where(eq(users.id, riga.id))
            if (!isTest) throw new Error(`${a.email} esiste ma NON è marcato isTest: mi fermo, non tocco account veri.`)
            const attesi = campiAttesi(a)
            const diversi = [
                riga.role !== attesi.role && 'ruolo',
                riga.gdoCode !== attesi.gdoCode && 'gdoCode',
                riga.firstName !== attesi.firstName && 'firstName',
                riga.companyId !== attesi.companyId && 'azienda',
                JSON.stringify(riga.allowedCompanies) !== JSON.stringify(attesi.allowedCompanies) && 'allowedCompanies',
                riga.isActive !== true && 'isActive',
            ].filter(Boolean)
            if (diversi.length === 0) {
                console.log(`  già a posto (id ${riga.id})`)
            } else if (ESEGUI) {
                await db.update(users).set(attesi).where(and(eq(users.id, riga.id), eq(users.isTest, true)))
                console.log(`  riallineato: ${diversi.join(', ')}`)
            } else {
                console.log(`  da riallineare: ${diversi.join(', ')}`)
            }
            stati.push({ account: a, id: riga.id, nuovo: false })
            continue
        }

        const auth = await utenteAuthPerEmail(admin, a.email)
        if (!ESEGUI) {
            console.log(auth
                ? `  da completare: utente Auth già presente (id ${auth.id}), manca la riga in public.users`
                : '  da creare: utente Supabase Auth + riga public.users')
            stati.push({ account: a, id: auth?.id ?? null, nuovo: true })
            continue
        }
        if (!migrata) throw new Error('Migrazione 0050 non applicata: applicala prima di creare gli account.')

        let id: string
        if (auth) {
            id = auth.id
            const { error } = await admin.auth.admin.updateUserById(id, { password: PASSWORD, user_metadata: metadataAuth(a) })
            if (error) throw new Error(`Supabase Auth (${a.email}): ${error.message}`)
            console.log(`  utente Auth già presente (id ${id}): password e metadati riallineati`)
        } else {
            const { data, error } = await admin.auth.admin.createUser({
                email: a.email, password: PASSWORD, email_confirm: true, user_metadata: metadataAuth(a),
            })
            if (error || !data.user) throw new Error(`Supabase Auth (${a.email}): ${error?.message ?? 'nessun utente'}`)
            id = data.user.id
            console.log(`  utente Auth creato (id ${id})`)
        }
        await db.insert(users).values({
            id,
            email: a.email,
            password: await bcrypt.hash(PASSWORD, 10),
            ...campiAttesi(a),
        })
        console.log('  riga public.users creata (isTest = true)')
        stati.push({ account: a, id, nuovo: true })
    }
    return stati
}

async function preparaSaldo(stati: StatoAccount[], migrata: boolean) {
    console.log(`\n2. Saldo di prova per il negozio: almeno ${SALDO_PROVA.scintille} Scintille e ${SALDO_PROVA.piume} Piume`)
    for (const s of stati) {
        if (!s.id || !migrata) {
            console.log(`  ${s.account.firstName}: da accreditare dopo la creazione dell'account`)
            continue
        }
        const [u] = await db.select({ scintille: users.scintille, piume: users.piume }).from(users).where(eq(users.id, s.id))
        const attuale = { S: u?.scintille ?? 0, P: u?.piume ?? 0 }
        for (const [valuta, minimo] of [['S', SALDO_PROVA.scintille], ['P', SALDO_PROVA.piume]] as [Currency, number][]) {
            const ricarica = ricaricaPerSaldo(attuale[valuta], minimo)
            const nome = valuta === 'S' ? 'Scintille' : 'Piume'
            if (ricarica === 0) {
                console.log(`  ${s.account.firstName}: ${attuale[valuta]} ${nome}, già sopra il minimo`)
                continue
            }
            if (!ESEGUI) {
                console.log(`  ${s.account.firstName}: ${attuale[valuta]} ${nome}, da ricaricare di ${ricarica}`)
                continue
            }
            // Chiave nuova a ogni ricarica (generazione), così una ricarica dopo
            // gli acquisti di prova non si scontra con quella di prima; due giri
            // simultanei calcolano la stessa chiave e ne passa uno solo.
            const [{ n }] = await db.select({ n: count() }).from(currencyLedger).where(and(
                eq(currencyLedger.userId, s.id), eq(currencyLedger.reason, CAUSALE_SALDO), eq(currencyLedger.currency, valuta),
            ))
            const ok = await creditOnce({
                userId: s.id, currency: valuta, amount: ricarica, reason: CAUSALE_SALDO,
                idemKey: `${valuta}:${CAUSALE_SALDO}:${s.id}:${Number(n) + 1}`,
                metadata: { nota: 'Saldo di prova per il negozio (scripts/diretta/prova-setup.ts)' },
                companyId: AZIENDA_PROVA,
            })
            console.log(`  ${s.account.firstName}: ${ok ? `ricaricate ${ricarica}` : 'ricarica già scritta da un altro giro'} ${nome}`)
        }
    }
}

async function preparaLead(gdo: StatoAccount | undefined, migrata: boolean) {
    const now = new Date()
    const piano = pianoLeadDiProva(now)
    console.log(`\n3. Lead di prova del GDO di prova: ${piano.length}`)

    let esistenti = new Set<string>()
    if (gdo?.id && migrata) {
        const righe = await db.select({ name: leads.name }).from(leads)
            .where(and(eq(leads.isTest, true), eq(leads.assignedToId, gdo.id)))
        esistenti = new Set(righe.map(r => r.name))
    }
    const daCreare = piano.filter(l => !esistenti.has(l.nome))
    for (const l of piano) {
        const stato = esistenti.has(l.nome) ? 'c\'è già' : 'da creare'
        const dettagli = [
            l.tipo.padEnd(16),
            l.funnel.padEnd(13),
            `chiamate ${l.callCount}`,
            l.recallDate ? `richiamo ${fmt(l.recallDate)}` : null,
            l.appointmentDate ? `appuntamento ${fmt(l.appointmentDate)} (fissato ${fmt(l.appointmentCreatedAt)})` : null,
            l.tipo === 'vergine' ? `arrivato ${fmt(l.createdAt)}` : null,
        ].filter(Boolean).join('  ')
        console.log(`  ${l.nome.padEnd(18)} ${l.telefono}  ${dettagli}  [${stato}]`)
    }
    if (daCreare.length === 0) {
        console.log('  Tutti presenti: niente da creare.')
        return
    }
    if (!ESEGUI) {
        console.log(`  Da creare: ${daCreare.length}. Le date sono calcolate al momento dell'esecuzione.`)
        return
    }
    if (!migrata) throw new Error('Migrazione 0050 non applicata: i lead di prova non hanno dove portare il marcatore.')
    if (!gdo?.id) throw new Error('Manca l\'account GDO di prova.')
    const gdoId = gdo.id

    await db.transaction(async (tx) => {
        for (const l of daCreare) {
            const id = randomUUID()
            await tx.insert(leads).values({
                id,
                name: l.nome,
                email: l.email,
                phone: l.telefono,
                funnel: l.funnel,
                source: l.source,
                status: l.status,
                callCount: l.callCount,
                assignedToId: gdoId,
                assignedAt: l.createdAt,
                lastCallDate: l.lastCallDate,
                lastCallNote: l.lastCallNote,
                recallDate: l.recallDate,
                recallNote: l.recallNote,
                appointmentDate: l.appointmentDate,
                appointmentNote: l.appointmentNote,
                appointmentCreatedAt: l.appointmentCreatedAt,
                isTest: true,
                createdAt: l.createdAt,
                updatedAt: now,
                companyId: AZIENDA_PROVA,
            })
            await tx.insert(leadEvents).values({
                id: randomUUID(),
                leadId: id,
                eventType: 'ASSIGNED',
                userId: gdoId,
                timestamp: l.createdAt,
                metadata: { via: 'prova_setup', assignedToUser: gdoId },
                companyId: AZIENDA_PROVA,
            })
            if (l.chiamate.length > 0) {
                await tx.insert(callLogs).values(l.chiamate.map(c => ({
                    id: randomUUID(),
                    leadId: id,
                    userId: gdoId,
                    outcome: c.outcome,
                    note: c.note,
                    createdAt: c.at,
                    companyId: AZIENDA_PROVA,
                })))
            }
        }
    })
    console.log(`  Creati: ${daCreare.length}.`)
}

async function main() {
    console.log(ESEGUI ? '=== ESECUZIONE (--esegui) ===' : '=== DRY-RUN: nessuna scrittura (aggiungi --esegui per creare) ===')
    const migrata = await migrazioneApplicata()
    console.log(migrata
        ? 'Migrazione 0050: applicata (users.isTest e leads.isTest presenti).'
        : 'Migrazione 0050: NON applicata. Il dry-run mostra il piano; --esegui si ferma finché non la applichi.')

    console.log('\n1. Account di prova (Supabase Auth + public.users)')
    const admin = supabaseAdmin()
    const stati = await preparaAccount(admin, migrata)
    await preparaSaldo(stati, migrata)
    await preparaLead(stati.find(s => s.account.chiave === 'gdo'), migrata)

    if (migrata) {
        const [{ n }] = await db.select({ n: count() }).from(leads).where(eq(leads.isTest, true))
        const ids = stati.map(s => s.id).filter((x): x is string => !!x)
        const marcati = ids.length
            ? await db.select({ email: users.email, isTest: users.isTest }).from(users).where(inArray(users.id, ids))
            : []
        console.log(`\nControllo: ${n} lead di prova nel database; account marcati: ${marcati.filter(m => m.isTest).map(m => m.email).join(', ') || 'nessuno'}.`)
    }
    console.log(ESEGUI ? '\nFatto. Accesso: prova.gdo@fenice.local e prova.conferme@fenice.local.' : '\nDry-run finito: niente è stato scritto.')
}

main().then(() => process.exit(0), (e) => {
    console.error(e instanceof Error ? `ERRORE: ${e.message}` : e)
    process.exit(1)
})
