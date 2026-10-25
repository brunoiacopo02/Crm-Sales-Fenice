/**
 * Go-live Diretta (PO 25/10/2026 mattina): i lead di Lorenzo (118).
 *
 * Il 118 era di Fabio e Lorenzo ne eredita i lead aperti (~180 su Fenice).
 * Bruno vuole che gli restino solo i 35 ridati dal bot più recenti e migliori;
 * le seconde e terze chiamate e tutto il resto escono dalla sua pipeline.
 *
 * Chi resta (src/lib/diretta/ridatiDaTenere.ts, testato):
 *   - solo ridati dal bot in prima chiamata;
 *   - prima i mai chiamati (nessuna chiamata in tutta la storia del lead);
 *   - poi chi ha dato segnali di interesse: "Ti ha cercato" aperto, ha scritto
 *     di nuovo dopo la restituzione (nota del bot o messaggio in entrata), chat
 *     interrotta;
 *   - poi i più recenti (restituzione o ultimo messaggio del lead);
 *   - id come spareggio.
 * Un lead che Lorenzo ha già chiamato dopo `--entro` non esce mai e occupa un posto.
 *
 * Chi esce viene parcheggiato come in lead-togli-lancio.ts: assignedToId → null
 * (torna fra i "non assegnati", ripescabile da /import; quelli del pool
 * database tornano disponibili nel loro pool), evento RIDATO_PARCHEGGIATO con
 * motivo, chi lo aveva, stato, tentativi e richiamo, per poterlo ripristinare.
 * Stato, tentativi e richiamo del lead restano come sono. Nessun lead si cancella.
 *
 * Perimetro: lead Fenice aperti (NEW/IN_PROGRESS) del 118, senza appuntamento
 * né presenza, arrivati a lui prima di `--entro` (default 26/10/2026, ora di
 * Roma: i lead di Fabio). Quello che gli arriva dopo non si tocca. I lead
 * Serenamente restano dove sono: per GDO e Conferme Serenamente non esiste.
 *
 * Interruttori: Lorenzo non riceve lead nuovi finché Bruno non lo accende da
 * /gestione. Lo script spegne Freschi, Ridati e Scorta del 118 e mette i due
 * tetti (freschi e ridati) a `--tetto` al giorno: accenderlo è una spunta. Il
 * tetto dei ridati è la colonna della migrazione 0049, da applicare prima.
 *
 * Idempotente: rilanciato dopo `--esegui` trova i 35 rimasti e non toglie altro.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/lead-lorenzo.ts [--esegui]
 *        [--tieni=35] [--tetto=30] [--codice=118] [--entro=2026-10-26]
 *
 * Dry-run di default: solo letture, stampa il piano.
 */

import crypto from 'node:crypto'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { botContactRequests, callLogs, leadEvents, leads, users } from '../../src/db/schema'
import { oraArrivo, type EventoLead } from '../../src/lib/diretta/arrivo'
import { dayBoundsRome } from '../../src/lib/dateUtils'
import {
    interesse, pianoTieni, type LeadEreditato, type MotivoUscita,
} from '../../src/lib/diretta/ridatiDaTenere'

const FENICE = 'fenice'
const MOTIVO = 'lorenzo_solo_ridati_migliori'
const NOTA = 'PO 25/10/2026: a Lorenzo restano i ridati migliori, il resto esce dalla sua pipeline'
const LOTTO = 300

const SEGNALI = ['BOT_NOTE', 'INBOUND_MESSAGE', 'BOT_CONTACT_REQUEST'] as const
const ASSEGNAZIONI = ['REASSIGNED_FROM_BOT', 'REASSIGNED_ADMIN', 'ASSIGNED'] as const

function opzione(nome: string): string | undefined {
    const pref = `--${nome}=`
    return process.argv.find((a) => a.startsWith(pref))?.slice(pref.length)
}

function intero(nome: string, predefinito: number, min: number, max: number): number {
    const raw = opzione(nome)
    if (raw === undefined) return predefinito
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${nome} deve essere un intero fra ${min} e ${max} (ricevuto ${raw})`)
    return n
}

function lotti<T>(lista: readonly T[]): T[][] {
    const out: T[][] = []
    for (let i = 0; i < lista.length; i += LOTTO) out.push(lista.slice(i, i + LOTTO))
    return out
}

const quando = (d: Date | null) => d
    ? d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

const ETICHETTE_USCITA: Record<MotivoUscita, string> = {
    ridato_oltre_il_limite: 'ridati in prima chiamata oltre il limite',
    gia_chiamato: 'seconde e terze chiamate (già chiamati)',
    non_ridato: 'mai passati dal bot, in prima chiamata',
    richiamo: 'con un richiamo in agenda',
}

interface LeadDiLorenzo extends LeadEreditato {
    funnel: string | null
    status: string
    launchBucket: string | null
    recallDate: Date | null
    arrivo: Date
}

async function main() {
    const esegui = process.argv.includes('--esegui')
    const tieni = intero('tieni', 35, 0, 1000)
    const tetto = intero('tetto', 30, 0, 1000)
    const codice = intero('codice', 118, 1, 9999)
    const giornoEntro = opzione('entro') ?? '2026-10-26'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giornoEntro)) throw new Error(`--entro nel formato 2026-10-26 (ricevuto ${giornoEntro})`)
    const entro = dayBoundsRome(new Date(`${giornoEntro}T12:00:00Z`)).start

    // Colonne esplicite: `dailyReturnCap` (migr. 0049) qui non si legge, così
    // la prova a vuoto gira anche prima della migrazione.
    const [lorenzo] = await db.select({
        id: users.id, gdoCode: users.gdoCode, firstName: users.firstName, isActive: users.isActive,
        isBot: users.isBot, acAutoIntake: users.acAutoIntake, botReturnIntake: users.botReturnIntake,
        freshOverflowScorta: users.freshOverflowScorta, dailyFreshCap: users.dailyFreshCap,
    }).from(users).where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.gdoCode, codice))).limit(1)
    if (!lorenzo) throw new Error(`GDO ${codice} non trovato`)
    if (lorenzo.isBot) throw new Error(`GDO ${codice} è il bot: niente da fare`)

    // Stesso predicato in lettura e in scrittura: un lead che nel frattempo è
    // stato fissato, scartato o spostato non viene toccato.
    const aperti = and(
        eq(leads.companyId, FENICE),
        eq(leads.assignedToId, lorenzo.id),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
    )

    const righe = await db.select({
        id: leads.id, funnel: leads.funnel, status: leads.status, callCount: leads.callCount,
        recallDate: leads.recallDate, lastCallDate: leads.lastCallDate, assignedAt: leads.assignedAt,
        createdAt: leads.createdAt, launchBucket: leads.launchBucket,
    }).from(leads).where(aperti)
    const ids = righe.map((r) => r.id)

    const eventi = new Map<string, (EventoLead & { timestamp: Date; reason: string | null })[]>()
    const chiamate = new Map<string, number>()
    const cercati = new Set<string>()
    for (const blocco of lotti(ids)) {
        const ev = await db.select({
            leadId: leadEvents.leadId,
            eventType: leadEvents.eventType,
            userId: leadEvents.userId,
            timestamp: leadEvents.timestamp,
            reason: sql<string | null>`${leadEvents.metadata}->>'reason'`,
            toAssigneeId: sql<string | null>`${leadEvents.metadata}->>'toAssigneeId'`,
            assignedToUser: sql<string | null>`${leadEvents.metadata}->>'assignedToUser'`,
        }).from(leadEvents).where(and(
            inArray(leadEvents.leadId, blocco),
            inArray(leadEvents.eventType, [...ASSEGNAZIONI, ...SEGNALI]),
        ))
        for (const e of ev) eventi.set(e.leadId, [...(eventi.get(e.leadId) ?? []), e])

        const cl = await db.select({ leadId: callLogs.leadId, n: sql<number>`count(*)::int` })
            .from(callLogs).where(inArray(callLogs.leadId, blocco)).groupBy(callLogs.leadId)
        for (const c of cl) chiamate.set(c.leadId, c.n)

        const cr = await db.select({ leadId: botContactRequests.leadId }).from(botContactRequests)
            .where(and(inArray(botContactRequests.leadId, blocco), ne(botContactRequests.status, 'closed')))
        for (const c of cr) cercati.add(c.leadId)
    }

    const tutti: LeadDiLorenzo[] = righe.map((r) => {
        const ev = (eventi.get(r.id) ?? []).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        const ritorni = ev.filter((e) => e.eventType === 'REASSIGNED_FROM_BOT')
        const segnali = ev.filter((e) => (SEGNALI as readonly string[]).includes(e.eventType))
        const ultimoRitorno = ritorni.at(-1) ?? null
        return {
            id: r.id,
            funnel: r.funnel,
            status: r.status,
            launchBucket: r.launchBucket,
            recallDate: r.recallDate,
            callCount: r.callCount,
            chiamateTotali: chiamate.get(r.id) ?? 0,
            ridatoIl: ultimoRitorno?.timestamp ?? null,
            ultimoSegnale: segnali.at(-1)?.timestamp ?? null,
            tiHaCercato: cercati.has(r.id),
            chatInterrotta: ultimoRitorno?.reason === 'chat_interrotta',
            richiamo: r.recallDate !== null,
            giaLavorato: !!r.lastCallDate && r.lastCallDate.getTime() >= entro.getTime(),
            arrivo: oraArrivo({
                eventi: ev.filter((e) => (ASSEGNAZIONI as readonly string[]).includes(e.eventType)),
                proprietario: lorenzo.id,
                assignedAt: r.assignedAt,
                createdAt: r.createdAt,
            }),
        }
    })

    const perimetro = tutti.filter((l) => l.arrivo.getTime() < entro.getTime())
    const dopo = tutti.length - perimetro.length
    const piano = pianoTieni(perimetro, tieni)

    const [sere] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(
        eq(leads.companyId, 'serenamente'),
        eq(leads.assignedToId, lorenzo.id),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
    ))

    const nome = lorenzo.firstName?.trim() || `GDO ${codice}`
    console.log(`${nome} (GDO ${codice}): ${tutti.length} lead aperti su Fenice senza appuntamento.`)
    console.log(`  arrivati prima del ${giornoEntro} (ereditati): ${perimetro.length}; arrivati dopo, non si toccano: ${dopo}`)
    console.log(`  lead Serenamente aperti, non si toccano: ${sere?.n ?? 0}`)

    const lavorati = piano.tenuti.filter((l) => l.giaLavorato).length
    const conSegnali = piano.tenuti.filter((l) => interesse(l) > 0).length
    console.log(`\nRestano a ${nome}: ${piano.tenuti.length} (limite ${tieni})`)
    console.log(`  già chiamati da lui dopo il ${giornoEntro}: ${lavorati}`)
    console.log(`  ridati in prima chiamata scelti: ${piano.tenuti.length - lavorati}, di cui mai chiamati ${piano.tenuti.filter((l) => !l.giaLavorato && l.chiamateTotali === 0).length} e con segnali di interesse ${conSegnali}`)

    console.log(`\nEscono dalla sua pipeline (parcheggiati): ${piano.parcheggiati.length}`)
    const perMotivo = new Map<MotivoUscita, LeadDiLorenzo[]>()
    for (const p of piano.parcheggiati) perMotivo.set(p.motivo, [...(perMotivo.get(p.motivo) ?? []), p.lead])
    for (const [motivo, lista] of perMotivo) {
        const ridati = lista.filter((l) => l.ridatoIl).length
        const pool = lista.filter((l) => l.launchBucket?.startsWith('DB_')).length
        const dettagli = [
            ridati && ridati !== lista.length ? `ridati ${ridati}` : null,
            pool ? `pool database ${pool}` : null,
        ].filter(Boolean).join(', ')
        console.log(`  ${ETICHETTE_USCITA[motivo]}: ${lista.length}${dettagli ? ` (${dettagli})` : ''}`)
    }

    console.log(`\nI ${piano.tenuti.length} che restano, in ordine:`)
    piano.tenuti.forEach((l, i) => {
        const segno = l.tiHaCercato ? 'ti ha cercato'
            : interesse(l) === 2 ? `ha scritto di nuovo ${quando(l.ultimoSegnale)}`
                : l.chatInterrotta ? 'chat interrotta' : ''
        const extra = [
            l.giaLavorato ? 'già chiamato da lui' : null,
            l.chiamateTotali > 0 ? `${l.chiamateTotali} chiamate in passato` : null,
            segno || null,
        ].filter(Boolean).join(', ')
        console.log(`  ${String(i + 1).padStart(2)}. ${l.id.slice(0, 8)}  ${(l.funnel ?? '—').padEnd(15)} ridato ${quando(l.ridatoIl)}${extra ? `  ${extra}` : ''}`)
    })

    const flag = (f: boolean) => (f ? 'sì' : 'no')
    console.log(`\nInterruttori di ${nome} adesso: freschi ${flag(lorenzo.acAutoIntake)}, ridati ${flag(lorenzo.botReturnIntake)}, scorta ${flag(lorenzo.freshOverflowScorta)}, tetto freschi ${lorenzo.dailyFreshCap ?? '—'}`)
    console.log(`Dopo: freschi no, ridati no, scorta no, tetto freschi ${tetto}, tetto ridati ${tetto} (colonna della migrazione 0049).`)
    console.log(`Per accenderlo: /gestione, spunta Ridati (e Freschi, se Bruno lo vuole) sulla riga di ${nome}.`)

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. Rilancia con --esegui per applicare.')
        return
    }

    const motivoDi = new Map(piano.parcheggiati.map((p) => [p.lead.id, p.motivo]))
    const now = new Date()
    const parcheggiati = await db.transaction(async (tx) => {
        let totale = 0
        for (const blocco of lotti([...motivoDi.keys()])) {
            // Rilettura sotto lock con lo stesso predicato: quello scritto
            // nell'evento è lo stato vero al momento della scrittura.
            const bloccati = await tx.select({
                id: leads.id, status: leads.status, callCount: leads.callCount,
                recallDate: leads.recallDate, lastCallDate: leads.lastCallDate,
            }).from(leads).where(and(aperti, inArray(leads.id, blocco))).for('update')
            // Un lead che Lorenzo ha chiamato nel frattempo resta suo.
            const daFare = bloccati.filter((l) => !(l.lastCallDate && l.lastCallDate.getTime() >= entro.getTime()))
            if (daFare.length === 0) continue

            await tx.update(leads)
                .set({ assignedToId: null, updatedAt: now, version: sql`${leads.version} + 1` })
                .where(and(aperti, inArray(leads.id, daFare.map((l) => l.id))))

            await tx.insert(leadEvents).values(daFare.map((l) => ({
                id: crypto.randomUUID(),
                leadId: l.id,
                eventType: 'RIDATO_PARCHEGGIATO',
                userId: null,
                timestamp: now,
                metadata: {
                    nota: NOTA,
                    motivo: MOTIVO,
                    uscita: motivoDi.get(l.id) ?? null,
                    tolto_a: lorenzo.id,
                    stato: l.status,
                    callCount: l.callCount,
                    recallDate: l.recallDate ? l.recallDate.toISOString() : null,
                },
                companyId: FENICE,
            })))
            totale += daFare.length
        }
        return totale
    })
    console.log(`\nScritto: ${parcheggiati} lead parcheggiati (assignedToId → null, evento RIDATO_PARCHEGGIATO).`)

    try {
        // Il WHERE riafferma chi è: mai il bot, mai un altro ruolo.
        await db.update(users)
            .set({
                acAutoIntake: false,
                botReturnIntake: false,
                freshOverflowScorta: false,
                dailyFreshCap: tetto,
                dailyReturnCap: tetto,
            })
            .where(and(
                eq(users.id, lorenzo.id),
                eq(users.companyId, FENICE),
                eq(users.role, 'GDO'),
                eq(users.isBot, false),
            ))
        console.log(`Scritto: interruttori di ${nome} spenti, tetti a ${tetto} al giorno.`)
    } catch (e) {
        console.error(`\nInterruttori NON scritti: manca la migrazione 0049 (users."dailyReturnCap")? Applicala e rilancia con --esegui: i lead sono già a posto e non si toccano di nuovo.`)
        console.error(e)
        process.exitCode = 1
    }
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
