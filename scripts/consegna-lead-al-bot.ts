/**
 * Consegna al bot fissatore i lead dei GDO scoperti.
 *
 *   npx tsx --env-file=.env scripts/consegna-lead-al-bot.ts --gdo=114,119 --seconde --dry
 *   BOT_WEBHOOK_SECRET=... npx tsx --env-file=.env scripts/consegna-lead-al-bot.ts --gdo=114,119 --seconde
 *
 * Criterio (deciso col PO il 2026-09-09, GDO assenti):
 *   - lead in prima chiamata (callCount=0), piu' le seconde chiamate degli
 *     ultimi 7 giorni se passi --seconde
 *   - niente richiami, niente scarti, niente appuntamenti
 *   - SOLO lead che il bot non ha mai visto: chi e' gia' passato di li' ed e'
 *     stato ridato indietro (REASSIGNED_FROM_BOT) o e' gia' stato pushato
 *     resta al GDO, altrimenti gli si rifa' girare la stessa sequenza addosso.
 *
 * Il push NON parte tutto insieme: l'intake del bot ha un rate limit di 60
 * richieste/minuto per IP e il CRM non ritenta, quindi oltre soglia i lead si
 * perdono in silenzio. Si spedisce a lotti (default 25 ogni 60 secondi) via
 * /api/bot/backfill, che usa il vero pushLeadToBot -> env di produzione e
 * audit BOT_PUSHED su ogni singolo esito.
 *
 * Modalita' --solo-riassegna --out=file.json: riassegna al bot e scrive gli id
 * senza pushare. Serve quando non si ha il BOT_WEBHOOK_SECRET (su Vercel e'
 * Sensitive, write-only: nemmeno `vercel env pull` lo restituisce). Il push si
 * fa poi da /api/admin/bot-push-leads, che e' lo stesso pushLeadToBot ma
 * autorizzato dalla sessione ADMIN invece che dal secret.
 *
 * Modalita' --recuperi: nessuna riassegnazione, ripesca i lead gia' del bot
 * il cui unico push e' fallito (timeout) e non e' mai stato ripetuto.
 */
import { db } from '../src/db'
import { leads, users, leadEvents } from '../src/db/schema'
import { and, eq, exists, inArray, isNull, ne, notExists, or, sql } from 'drizzle-orm'
import crypto from 'node:crypto'
import fs from 'node:fs'

const CRM_URL = process.env.CRM_URL || 'https://crm-sales-fenice.vercel.app'
const FENICE = 'fenice'

type Args = {
    gdo: number[]
    seconde: boolean
    dry: boolean
    chunk: number
    intervallo: number
    recuperi: boolean
    /** Riassegna e basta: il push lo fa qualcun altro (vedi --out). */
    soloRiassegna: boolean
    /** Dove scrivere gli id riassegnati, per pusharli dalla sessione ADMIN. */
    out: string | null
}

function parseArgs(argv: string[]): Args {
    const get = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
    const has = (k: string) => argv.includes(`--${k}`)
    return {
        gdo: (get('gdo') || '').split(',').filter(Boolean).map(Number),
        seconde: has('seconde'),
        dry: has('dry'),
        chunk: Number(get('chunk') || 25),
        intervallo: Number(get('intervallo') || 60),
        recuperi: has('recuperi'),
        soloRiassegna: has('solo-riassegna'),
        out: get('out') || null,
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Lead mai passato dal bot: ne' ridato indietro da lui, ne' mai consegnato.
 *
 * "Mai consegnato" vuol dire NESSUN evento BOT_PUSHED, non "nessun push andato
 * a buon fine". Un `network_error` e' un timeout del NOSTRO fetch a 5 secondi,
 * non un mancato arrivo: il fornitore ha verificato il 2026-09-09 che 113
 * timeout su 113 erano arrivati, con conversazione creata e template di
 * apertura gia' partito (il loro intake fa il giro a Twilio dentro la
 * richiesta). Rimandare un lead in timeout significa mandare una seconda
 * apertura WhatsApp alla stessa persona.
 */
function maiVistoDalBot() {
    return and(
        notExists(db.select({ x: sql`1` }).from(leadEvents).where(and(
            eq(leadEvents.leadId, leads.id),
            eq(leadEvents.eventType, 'REASSIGNED_FROM_BOT'),
        ))),
        notExists(db.select({ x: sql`1` }).from(leadEvents).where(and(
            eq(leadEvents.leadId, leads.id),
            eq(leadEvents.eventType, 'BOT_PUSHED'),
        ))),
    )
}

async function botAccount() {
    const [bot] = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.isBot, true), eq(users.companyId, FENICE)))
        .limit(1)
    if (!bot) throw new Error('account bot non trovato')
    return bot.id
}

async function candidati(gdoIds: string[], seconde: boolean) {
    const sezione = seconde
        ? or(
            eq(leads.callCount, 0),
            and(eq(leads.callCount, 1), sql`${leads.lastCallDate} >= now() - interval '7 days'`),
        )
        : eq(leads.callCount, 0)

    return db.select({
        id: leads.id,
        nome: leads.name,
        callCount: leads.callCount,
        assegnatario: leads.assignedToId,
        gdoCode: users.gdoCode,
    })
        .from(leads)
        .innerJoin(users, eq(users.id, leads.assignedToId))
        .where(and(
            eq(leads.companyId, FENICE),
            inArray(leads.assignedToId, gdoIds),
            ne(leads.status, 'REJECTED'),
            ne(leads.status, 'APPOINTMENT'),
            isNull(leads.recallDate),
            sezione,
            maiVistoDalBot(),
        ))
}

/** Lead gia' del bot il cui ultimo push e' fallito e non e' mai andato a buon fine. */
async function daRecuperare(botId: string) {
    return db.select({ id: leads.id, nome: leads.name, callCount: leads.callCount })
        .from(leads)
        .where(and(
            eq(leads.companyId, FENICE),
            eq(leads.assignedToId, botId),
            eq(leads.status, 'NEW'),
            isNull(leads.botReport),
            exists(db.select({ x: sql`1` }).from(leadEvents).where(and(
                eq(leadEvents.leadId, leads.id),
                eq(leadEvents.eventType, 'BOT_PUSHED'),
                sql`${leadEvents.metadata}->>'result' <> 'sent'`,
            ))),
            notExists(db.select({ x: sql`1` }).from(leadEvents).where(and(
                eq(leadEvents.leadId, leads.id),
                eq(leadEvents.eventType, 'BOT_PUSHED'),
                sql`${leadEvents.metadata}->>'result' = 'sent'`,
            ))),
        ))
}

async function riassegna(righe: Awaited<ReturnType<typeof candidati>>, botId: string) {
    const now = new Date()
    const ids = righe.map(r => r.id)
    for (let i = 0; i < ids.length; i += 200) {
        const fetta = ids.slice(i, i + 200)
        await db.transaction(async tx => {
            await tx.update(leads)
                .set({
                    assignedToId: botId,
                    // Il bot lavora solo lead NEW: le seconde chiamate tornano
                    // in cima senza perdere il callCount, che resta a storico.
                    status: 'NEW',
                    // Latch: non e' un nuovo ingresso nel funnel, la data di
                    // presa in carico originale non si tocca.
                    assignedAt: sql`COALESCE(${leads.assignedAt}, ${now})`,
                    updatedAt: now,
                    version: sql`${leads.version} + 1`,
                })
                .where(inArray(leads.id, fetta))

            await tx.insert(leadEvents).values(righe.slice(i, i + 200).map(r => ({
                id: crypto.randomUUID(),
                leadId: r.id,
                eventType: 'REASSIGNED_ADMIN',
                userId: null,
                fromSection: r.callCount === 0 ? 'Prima Chiamata' : 'Seconda Chiamata',
                toSection: r.callCount === 0 ? 'Prima Chiamata' : 'Seconda Chiamata',
                timestamp: now,
                metadata: {
                    reason: 'gdo_scoperti_al_bot',
                    fromAssigneeId: r.assegnatario,
                    fromGdoCode: r.gdoCode,
                    toAssigneeId: botId,
                    batch: '2026-09-09',
                },
                companyId: FENICE,
            })))
        })
    }
}

async function pushScaglionato(ids: string[], chunk: number, intervallo: number) {
    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!secret) throw new Error('BOT_WEBHOOK_SECRET mancante: serve per /api/bot/backfill')

    const totali: Record<string, number> = {}
    let coda = [...ids]
    let lotto = 0

    while (coda.length > 0) {
        const fetta = coda.slice(0, chunk)
        coda = coda.slice(chunk)
        lotto++
        const partito = Date.now()

        let esito: any
        try {
            const res = await fetch(`${CRM_URL}/api/bot/backfill`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-backfill-key': secret },
                body: JSON.stringify({ leadIds: fetta, limit: 500 }),
                signal: AbortSignal.timeout(280_000),
            })
            esito = await res.json()
            if (!res.ok) {
                console.error(`lotto ${lotto}: HTTP ${res.status}`, esito)
                if (res.status === 401) throw new Error('backfill: chiave non valida, mi fermo')
                coda = [...fetta, ...coda]
                await sleep(intervallo * 1000)
                continue
            }
        } catch (e) {
            console.error(`lotto ${lotto}: errore di rete`, e)
            coda = [...fetta, ...coda]
            await sleep(intervallo * 1000)
            continue
        }

        for (const [k, v] of Object.entries(esito.summary || {})) {
            totali[k] = (totali[k] || 0) + Number(v)
        }
        const persi = fetta.length - (esito.matched ?? esito.pushed ?? 0)
        console.log(`lotto ${lotto}: inviati ${esito.pushed}/${fetta.length}` +
            `${persi > 0 ? ` (${persi} non idonei)` : ''} — ${JSON.stringify(esito.summary)} — coda ${coda.length}`)

        // Il resto dichiarato dalla versione scaglionata lato server torna in coda.
        if (Array.isArray(esito.remainingLeadIds) && esito.remainingLeadIds.length > 0) {
            coda = [...esito.remainingLeadIds, ...coda]
        }

        if (coda.length > 0) {
            const attesa = Math.max(0, intervallo * 1000 - (Date.now() - partito))
            if (attesa > 0) await sleep(attesa)
        }
    }

    return totali
}

/** Gli id riassegnati, a lotti gia' pronti per /api/admin/bot-push-leads. */
function scriviIds(ids: string[], out: string | null) {
    if (!out) {
        console.log(JSON.stringify(ids))
        return
    }
    fs.writeFileSync(out, JSON.stringify({ generatoIl: new Date().toISOString(), totale: ids.length, ids }, null, 2))
    console.log(`Scritti ${ids.length} id in ${out}`)
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    const botId = await botAccount()

    if (args.recuperi) {
        const righe = await daRecuperare(botId)
        console.log(`Recuperi: ${righe.length} lead gia' del bot con push fallito e mai riuscito`)
        if (args.dry || righe.length === 0) return
        if (args.soloRiassegna) return scriviIds(righe.map(r => r.id), args.out)
        const totali = await pushScaglionato(righe.map(r => r.id), args.chunk, args.intervallo)
        console.log('Esiti recuperi:', totali)
        return
    }

    if (args.gdo.length === 0) throw new Error('serve --gdo=114,119')

    const gdoRows = await db.select({ id: users.id, gdoCode: users.gdoCode })
        .from(users)
        .where(and(eq(users.companyId, FENICE), inArray(users.gdoCode, args.gdo)))
    if (gdoRows.length !== args.gdo.length) throw new Error('GDO non trovati: ' + JSON.stringify(gdoRows))

    const righe = await candidati(gdoRows.map(g => g.id), args.seconde)
    const perGdo = righe.reduce<Record<string, { prima: number; seconda: number }>>((acc, r) => {
        const k = String(r.gdoCode)
        acc[k] = acc[k] || { prima: 0, seconda: 0 }
        if (r.callCount === 0) acc[k].prima++; else acc[k].seconda++
        return acc
    }, {})
    console.log(`Candidati: ${righe.length}`, perGdo)

    if (args.dry) return
    if (righe.length === 0) return

    await riassegna(righe, botId)

    if (args.soloRiassegna) {
        console.log(`Riassegnati al bot: ${righe.length}. Push NON eseguito da qui.`)
        return scriviIds(righe.map(r => r.id), args.out)
    }

    console.log(`Riassegnati al bot: ${righe.length}. Inizio push a ${args.chunk} ogni ${args.intervallo}s.`)

    const totali = await pushScaglionato(righe.map(r => r.id), args.chunk, args.intervallo)
    console.log('Esiti push:', totali)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
