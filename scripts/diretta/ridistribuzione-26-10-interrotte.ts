/**
 * Ritocco della prima chiamata dopo la ridistribuzione 26/10 (PO, domenica
 * 25/10/2026 sera, dopo ridistribuzione-26-10.ts).
 *
 * La ridistribuzione ha dato in prima chiamata 187 ridati dal pool, tutti
 * "mai_risposto_al_bot" (i più recenti). Le chat interrotte (parcheggio
 * "stella_fuori_selezione": hanno parlato col bot e poi si sono fermate, di
 * solito lead migliori) sono andate solo in seconde e terze. Qui:
 *
 *   1. Chat interrotte ancora nel pool parcheggiato (assignedToId null, ultimo
 *      RIDATO_PARCHEGGIATO con motivo stella_fuori_selezione), adatte alla
 *      prima chiamata: callCount 0, nessun richiamo, nessun "Ti ha cercato",
 *      ridate dal bot e senza telefonate vere di una persona dopo l'ultima
 *      restituzione; niente lancio, fuori KPI/senso unico, Serenamente o prova;
 *      niente lead in lavorazione/scartati/fissati nel DB del bot
 *      (ESCLUSI_DAL_BOT). In ordine dalle migliori (confrontaMigliori, che
 *      finisce sulla più recente).
 *   2. Si danno a turno in quest'ordine: Riccardo 119, Zora 106, Christian 115,
 *      Anthony 105, Alessandro 110, Lavinia 116, Noemi 107. Beatrice 112 e
 *      Christel 114 solo con quelle che avanzano dopo aver servito i primi
 *      sette (a turno tra loro due, stesse regole).
 *   3. Ogni chat interrotta data a un GDO sostituisce uno dei suoi
 *      "mai_risposto_al_bot" in prima chiamata (callCount 0, nessun richiamo,
 *      nessun "Ti ha cercato", nessuna telefonata di una persona in tutta la
 *      storia), dal meno recente (ultima restituzione più vecchia). Si
 *      sostituiscono solo quelli arrivati dal pool stasera (presenti nel file di
 *      ripristino della ridistribuzione con da = pool): tornano nel pool
 *      esattamente come erano, assignedToId null, assignedAt e stato di prima.
 *      Chi non ha più mai_risposto sostituibili salta il turno; quando sono
 *      finiti per tutti ci si ferma e si contano le chat interrotte avanzate.
 *
 * Scrittura (--esegui): file di ripristino suo prima di scrivere, poi in
 * transazione ogni coppia (entra/esce) si riscrive solo se entrambi i lead sono
 * ancora come letti (stesso assegnatario, callCount 0, nessun richiamo): così
 * ognuno resta a 40. Eventi REASSIGNED_ADMIN (anche per chi torna nel pool:
 * niente nuovo RIDATO_PARCHEGGIATO, così motivo e data di parcheggio restano
 * quelli di prima). updatedAt sfalsato di 1 ms per lead. Nessuna notifica,
 * nessun webhook, nessuna chiamata al bot o ad AC.
 *
 * --ripristina [--file=...] rimette ogni coppia ancora come l'ha lasciata lo
 * script (prova a vuoto senza --esegui).
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/ridistribuzione-26-10-interrotte.ts
 *        [--esegui | --ripristina [--file=...] [--esegui]] [--elenco] [--candidati=file.json]
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { botContactRequests, callLogs, leadEvents, leads, users } from '../../src/db/schema'
import { eLeadDelLancio } from '../../src/lib/diretta/instradamento'
import { contaNeiKpi, BATCH_SENSO_UNICO } from '../../src/lib/intakeBatch'
import { confrontaMigliori, type LeadEreditato } from '../../src/lib/diretta/ridatiDaTenere'

const FENICE = 'fenice'
const MOTIVO = 'ridistribuzione_26_10_interrotte'
const NOTA = 'PO 25/10/2026 sera: chat interrotte in prima chiamata al posto dei mai risposto meno recenti'
const LOTTO = 300
const CARTELLA_RIPRISTINO = path.resolve('scripts/diretta/ripristino')
const FILE_RIDISTRIBUZIONE = path.join(CARTELLA_RIPRISTINO, 'ridistribuzione-26-10-2026-10-25T21-17-05-995Z.json')

/** Ordine del giro: la prima chat interrotta a Riccardo, la seconda a Zora, ecc. */
const GIRO = [119, 106, 115, 105, 110, 116, 107] as const
/** In coda: solo se ne avanzano dopo aver servito tutto GIRO, a turno tra loro due. */
const GIRO_CODA = [112, 114] as const
/** Tutta la squadra di lunedì, per i conteggi di controllo. */
const SQUADRA = [105, 106, 107, 110, 112, 114, 115, 116, 119] as const

const MOTIVO_INTERROTTE = 'stella_fuori_selezione'
const MOTIVO_MAI_RISPOSTO = 'mai_risposto_al_bot'

// Dal DB del bot (25/10/2026 sera), sui candidati di questo piano: chat in
// lavorazione (ai_status active), esito DA_SCARTARE o APPUNTAMENTO.
// Controllo sui 202 candidati: 197 chiusi INTERROTTO, 4 senza conversazione,
// 1 DA_SCARTARE.
const ESCLUSI_DAL_BOT = new Set<string>([
    'f5259f82-0448-4f7f-8200-1a1288ff1303', // DA_SCARTARE
])

type Colonna = 'P' | 'S' | 'T' | 'R' | 'X'

function opzione(nome: string): string | undefined {
    const pref = `--${nome}=`
    return process.argv.find((a) => a.startsWith(pref))?.slice(pref.length)
}

function lotti<T>(lista: readonly T[]): T[][] {
    const out: T[][] = []
    for (let i = 0; i < lista.length; i += LOTTO) out.push(lista.slice(i, i + LOTTO))
    return out
}

interface Lead extends LeadEreditato {
    assignedToId: string | null
    status: string
    recallDate: Date | null
    assignedAt: Date | null
    lancio: boolean
    contaKpi: boolean
    sensoUnico: boolean
    /** Motivo dell'ultimo RIDATO_PARCHEGGIATO (anche se oggi è assegnato). */
    motivoParcheggio: string | null
    chiamateUmaneGiro: number
    chiamateUmaneTotali: number
}

interface Coppia {
    gdo: string
    entra: Lead
    esce: Lead
    /** assignedAt dell'uscente prima della ridistribuzione (dal suo file). */
    esceAssignedAtPrima: string | null
    esceStatusPrima: string
}

interface RigaRipristino {
    gdo: string
    entra: { id: string; status: string; callCount: number; assignedAt: string | null }
    esce: { id: string; status: string; callCount: number; assignedAt: string | null }
}

const ms = (d: Date | null) => d?.getTime() ?? 0

async function main() {
    const esegui = process.argv.includes('--esegui')
    const elenco = process.argv.includes('--elenco')
    const fileCandidati = opzione('candidati')
    if (process.argv.includes('--ripristina')) return annulla(esegui)

    // ── GDO ────────────────────────────────────────────────────────────────
    const gdoRows = await db.select({
        id: users.id, gdoCode: users.gdoCode, firstName: users.firstName, isBot: users.isBot, isTest: users.isTest,
    }).from(users).where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO'), inArray(users.gdoCode, [...SQUADRA])))
    const perCodice = new Map(gdoRows.map((g) => [g.gdoCode!, g]))
    for (const c of SQUADRA) {
        const g = perCodice.get(c)
        if (!g) throw new Error(`GDO ${c} non trovato`)
        if (g.isBot || g.isTest) throw new Error(`GDO ${c} è bot o prova`)
    }
    const idDi = (c: number) => perCodice.get(c)!.id
    const codiceDi = new Map(gdoRows.map((g) => [g.id, g.gdoCode!]))
    const nomeDi = (id: string | null) => {
        if (!id) return 'pool'
        const g = gdoRows.find((x) => x.id === id)
        return g ? `${g.firstName?.trim() || 'GDO'} (${g.gdoCode})` : id.slice(0, 8)
    }
    const squadra = SQUADRA.map(idDi)
    const giroTesta = GIRO.map(idDi)
    const giroCoda = GIRO_CODA.map(idDi)
    const giro = [...giroTesta, ...giroCoda]
    const bot = new Set((await db.select({ id: users.id }).from(users).where(eq(users.isBot, true))).map((u) => u.id))

    // ── Stato di prima della ridistribuzione (lead arrivati dal pool stasera) ──
    const ridistr = JSON.parse(fs.readFileSync(FILE_RIDISTRIBUZIONE, 'utf8')) as {
        mosse: { id: string; colonna: string; da: string | null; a: string | null; status: string; callCount: number; assignedAt: string | null }[]
    }
    const dalPoolStasera = new Map(ridistr.mosse.filter((m) => m.da === null && m.a && m.colonna === 'P').map((m) => [m.id, m]))

    // ── Lead: aperti della squadra + parcheggiati non assegnati ─────────────
    const aperti = and(
        eq(leads.companyId, FENICE), eq(leads.isTest, false),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.appointmentDate), isNull(leads.presentedAt),
    )
    const colonne = {
        id: leads.id, assignedToId: leads.assignedToId, status: leads.status, callCount: leads.callCount,
        recallDate: leads.recallDate, assignedAt: leads.assignedAt,
        createdAt: leads.createdAt, funnel: leads.funnel, launchBucket: leads.launchBucket,
        lancioPool: leads.lancioPool, humanTestCohort: leads.humanTestCohort, intakeBatch: leads.intakeBatch,
        isTest: leads.isTest, reservedSalespersonId: leads.reservedSalespersonId,
    }
    const deiGdo = await db.select(colonne).from(leads).where(and(aperti, inArray(leads.assignedToId, squadra)))
    const parcheggiati = await db.select(colonne).from(leads).where(and(
        aperti, isNull(leads.assignedToId),
        sql`exists (select 1 from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = 'RIDATO_PARCHEGGIATO')`,
    ))
    const righe = [...deiGdo, ...parcheggiati]

    const ritorni = new Map<string, { t: Date; reason: string | null }>()
    const segnali = new Map<string, Date>()
    const parcheggio = new Map<string, { t: Date; motivo: string | null }>()
    const cercati = new Set<string>()
    const chiamateLog = new Map<string, { userId: string | null; t: Date }[]>()
    for (const blocco of lotti(righe.map((r) => r.id))) {
        const ev = await db.select({
            leadId: leadEvents.leadId, eventType: leadEvents.eventType, timestamp: leadEvents.timestamp,
            reason: sql<string | null>`${leadEvents.metadata}->>'reason'`,
            motivo: sql<string | null>`${leadEvents.metadata}->>'motivo'`,
        }).from(leadEvents).where(and(
            inArray(leadEvents.leadId, blocco),
            inArray(leadEvents.eventType, ['REASSIGNED_FROM_BOT', 'RIDATO_PARCHEGGIATO', 'BOT_NOTE', 'INBOUND_MESSAGE', 'BOT_CONTACT_REQUEST']),
        ))
        for (const e of ev) {
            if (e.eventType === 'REASSIGNED_FROM_BOT') {
                const p = ritorni.get(e.leadId)
                if (!p || p.t < e.timestamp) ritorni.set(e.leadId, { t: e.timestamp, reason: e.reason })
            } else if (e.eventType === 'RIDATO_PARCHEGGIATO') {
                const p = parcheggio.get(e.leadId)
                if (!p || p.t < e.timestamp) parcheggio.set(e.leadId, { t: e.timestamp, motivo: e.motivo })
            } else {
                const p = segnali.get(e.leadId)
                if (!p || p < e.timestamp) segnali.set(e.leadId, e.timestamp)
            }
        }
        const cr = await db.select({ leadId: botContactRequests.leadId }).from(botContactRequests)
            .where(and(inArray(botContactRequests.leadId, blocco), ne(botContactRequests.status, 'closed')))
        for (const c of cr) cercati.add(c.leadId)
        const cl = await db.select({ leadId: callLogs.leadId, userId: callLogs.userId, t: callLogs.createdAt })
            .from(callLogs).where(inArray(callLogs.leadId, blocco))
        for (const c of cl) chiamateLog.set(c.leadId, [...(chiamateLog.get(c.leadId) ?? []), { userId: c.userId, t: c.t }])
    }

    const lead: Lead[] = righe.map((r) => {
        const rit = ritorni.get(r.id) ?? null
        const log = chiamateLog.get(r.id) ?? []
        const umane = log.filter((c) => c.userId && !bot.has(c.userId))
        return {
            id: r.id, assignedToId: r.assignedToId, status: r.status, callCount: r.callCount,
            recallDate: r.recallDate, assignedAt: r.assignedAt,
            chiamateTotali: log.length,
            ridatoIl: rit?.t ?? null,
            ultimoSegnale: segnali.get(r.id) ?? null,
            tiHaCercato: cercati.has(r.id),
            chatInterrotta: rit?.reason === 'chat_interrotta',
            richiamo: r.recallDate !== null,
            giaLavorato: false,
            lancio: eLeadDelLancio(r) || !!r.reservedSalespersonId,
            contaKpi: contaNeiKpi(r),
            sensoUnico: !!r.intakeBatch && BATCH_SENSO_UNICO.includes(r.intakeBatch),
            motivoParcheggio: parcheggio.get(r.id)?.motivo ?? null,
            chiamateUmaneGiro: umane.filter((c) => !rit || c.t > rit.t).length,
            chiamateUmaneTotali: umane.length,
        }
    })
    const colonnaDi = (l: Lead): Colonna => {
        if (l.recallDate) return 'R'
        if (l.tiHaCercato || l.callCount === 0) return 'P'
        if (l.callCount === 1) return 'S'
        if (l.callCount === 2) return 'T'
        return 'X'
    }
    const contaGdo = () => {
        const c = new Map<string, Record<Colonna, number>>()
        for (const g of squadra) c.set(g, { P: 0, S: 0, T: 0, R: 0, X: 0 })
        for (const l of lead) if (l.assignedToId) c.get(l.assignedToId)![colonnaDi(l)]++
        return c
    }
    const prima = contaGdo()

    // ── Chat interrotte nel pool ────────────────────────────────────────────
    const esclusioneInterrotta = (l: Lead): string | null => {
        if (l.recallDate) return 'con richiamo'
        if (l.tiHaCercato) return '"Ti ha cercato" aperto'
        if (l.callCount !== 0) return 'non in prima chiamata'
        if (l.lancio) return 'lancio'
        if (!l.contaKpi || l.sensoUnico) return 'infornata fuori KPI'
        if (!l.ridatoIl) return 'mai ridato dal bot'
        if (l.chiamateUmaneGiro > 0) return 'chiamato da una persona dopo la restituzione'
        if (ESCLUSI_DAL_BOT.has(l.id)) return 'in lavorazione/scartato/fissato nel bot'
        return null
    }
    const interrotteNelPool = lead.filter((l) => !l.assignedToId && l.motivoParcheggio === MOTIVO_INTERROTTE)
    const causeInterrotte = new Map<string, number>()
    const interrotte: Lead[] = []
    for (const l of interrotteNelPool) {
        const e = esclusioneInterrotta(l)
        if (e) causeInterrotte.set(e, (causeInterrotte.get(e) ?? 0) + 1)
        else interrotte.push(l)
    }
    interrotte.sort(confrontaMigliori)

    if (fileCandidati) {
        fs.writeFileSync(fileCandidati, JSON.stringify(interrotte.map((l) => l.id)))
        console.log(`Candidati (chat interrotte) scritti in ${fileCandidati}: ${interrotte.length}`)
    }

    // ── mai_risposto sostituibili per GDO del giro ──────────────────────────
    const causeSost = new Map<string, number>()
    const sostituibili = new Map<string, Lead[]>()
    for (const g of giro) {
        const miei = lead.filter((l) => l.assignedToId === g && colonnaDi(l) === 'P' && l.motivoParcheggio === MOTIVO_MAI_RISPOSTO)
        const ok: Lead[] = []
        for (const l of miei) {
            const e = l.recallDate ? 'con richiamo'
                : l.tiHaCercato ? '"Ti ha cercato" aperto'
                : l.callCount !== 0 ? 'tentativi'
                : l.chiamateUmaneTotali > 0 ? 'chiamato da una persona'
                : !dalPoolStasera.has(l.id) ? 'non arrivato dal pool stasera'
                : dalPoolStasera.get(l.id)!.a !== g ? 'stasera dato a un altro GDO'
                : null
            if (e) causeSost.set(e, (causeSost.get(e) ?? 0) + 1)
            else ok.push(l)
        }
        // Dal meno recente: ultima restituzione più vecchia.
        ok.sort((a, b) => ms(a.ridatoIl) - ms(b.ridatoIl) || (a.id < b.id ? -1 : 1))
        sostituibili.set(g, ok)
    }

    // ── Piano: giro a turno ─────────────────────────────────────────────────
    const coppie: Coppia[] = []
    const resto = new Map(giro.map((g) => [g, [...sostituibili.get(g)!]]))
    // Prima tutto il giro di testa; solo quando i suoi sostituibili sono finiti
    // si passa alla coda (Beatrice e Christel), sempre a turno.
    const turni = [giroTesta, giroCoda].map(() => 0)
    let usate = 0
    for (const entra of interrotte) {
        let g: string | null = null
        for (const [f, fascia] of [giroTesta, giroCoda].entries()) {
            for (let k = 0; k < fascia.length; k++) {
                const cand = fascia[(turni[f] + k) % fascia.length]
                if (resto.get(cand)!.length > 0) { g = cand; turni[f] = (turni[f] + k + 1) % fascia.length; break }
            }
            if (g) break
        }
        if (!g) break
        const esce = resto.get(g)!.shift()!
        const st = dalPoolStasera.get(esce.id)!
        coppie.push({ gdo: g, entra, esce, esceAssignedAtPrima: st.assignedAt, esceStatusPrima: st.status })
        usate++
    }
    const avanzate = interrotte.length - usate

    // ── Rapporto ────────────────────────────────────────────────────────────
    console.log(`Chat interrotte (${MOTIVO_INTERROTTE}) nel pool: ${interrotteNelPool.length}; adatte alla prima chiamata: ${interrotte.length}.`)
    if (causeInterrotte.size) console.log(`  escluse: ${[...causeInterrotte].map(([k, n]) => `${k} ${n}`).join(', ')}`)
    console.log(`mai_risposto in prima chiamata del giro: sostituibili ${[...sostituibili.values()].reduce((s, x) => s + x.length, 0)}`
        + `${causeSost.size ? `; non sostituibili: ${[...causeSost].map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}\n`)

    const dopo = new Map([...prima].map(([k, v]) => [k, { ...v }]))
    console.log('GDO                 | interrotte | mai_risposto | Prima chiamata | Seconde | Terze | Richiami')
    console.log('                    |  ricevute  |    tolti     |  prima → dopo  |         |       |')
    for (const g of squadra) {
        const ric = coppie.filter((c) => c.gdo === g).length
        const p = prima.get(g)!, d = dopo.get(g)!
        console.log(`${nomeDi(g).padEnd(20)}| ${String(ric).padStart(10)} | ${String(ric).padStart(12)} | ${String(p.P).padStart(6)} → ${String(d.P).padStart(4)}  | ${String(p.S).padStart(7)} | ${String(p.T).padStart(5)} | ${String(p.R).padStart(8)}`
            + `${giro.includes(g) ? `   (sostituibili ${sostituibili.get(g)!.length})` : '   (non si tocca)'}`)
    }
    console.log(`\nChat interrotte date: ${usate}; avanzate nel pool: ${avanzate}. Lead mai_risposto che tornano nel pool: ${coppie.length}.`)

    // Controlli delle regole
    const violazioni: string[] = []
    const visti = new Set<string>()
    for (const c of coppie) {
        for (const l of [c.entra, c.esce]) {
            if (visti.has(l.id)) violazioni.push(`${l.id}: usato due volte`)
            visti.add(l.id)
            if (l.recallDate) violazioni.push(`${l.id}: ha un richiamo`)
            if (l.tiHaCercato) violazioni.push(`${l.id}: "Ti ha cercato"`)
            if (l.lancio) violazioni.push(`${l.id}: lancio`)
            if (l.callCount !== 0) violazioni.push(`${l.id}: callCount ${l.callCount}`)
        }
        if (c.entra.assignedToId) violazioni.push(`${c.entra.id}: interrotta non nel pool`)
        if (c.entra.chiamateUmaneGiro > 0) violazioni.push(`${c.entra.id}: interrotta già chiamata`)
        if (c.esce.chiamateUmaneTotali > 0) violazioni.push(`${c.esce.id}: uscente chiamato da una persona`)
        if (c.esce.assignedToId !== c.gdo) violazioni.push(`${c.esce.id}: uscente non del GDO`)
        if (!giro.includes(c.gdo)) violazioni.push(`${c.gdo}: GDO fuori dal giro`)
        if (c.esceStatusPrima !== c.esce.status) violazioni.push(`${c.esce.id}: stato cambiato da stasera (${c.esceStatusPrima} → ${c.esce.status})`)
    }
    console.log(`Controlli: ${violazioni.length ? `${violazioni.length} VIOLAZIONI` : 'ok (nessun richiamo, nessun chiamato, nessun lancio/"Ti ha cercato", uscenti tutti dal pool di stasera, a coppie: prima chiamata invariata)'}`)
    for (const v of violazioni.slice(0, 20)) console.log(`  ${v}`)

    if (elenco) {
        console.log('\nElenco (entra ← esce):')
        for (const c of coppie) {
            console.log(`  ${nomeDi(c.gdo).padEnd(18)} + ${c.entra.id} (ridato ${c.entra.ridatoIl?.toISOString().slice(0, 16)})  − ${c.esce.id} (ridato ${c.esce.ridatoIl?.toISOString().slice(0, 16)})`)
        }
    }

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. --esegui per applicare.')
        return
    }
    if (violazioni.length) throw new Error('Violazioni delle regole: non scrivo.')
    if (ESCLUSI_DAL_BOT.size === 0 && !process.argv.includes('--bot-controllato')) {
        throw new Error('ESCLUSI_DAL_BOT vuoto: controlla prima i candidati sul DB del bot (poi --bot-controllato se davvero nessuno).')
    }

    // ── File di ripristino ──────────────────────────────────────────────────
    fs.mkdirSync(CARTELLA_RIPRISTINO, { recursive: true })
    const fileRipristino = path.join(CARTELLA_RIPRISTINO, `ridistribuzione-26-10-interrotte-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    const righeRipristino: RigaRipristino[] = coppie.map((c) => ({
        gdo: c.gdo,
        entra: { id: c.entra.id, status: c.entra.status, callCount: c.entra.callCount, assignedAt: c.entra.assignedAt?.toISOString() ?? null },
        esce: { id: c.esce.id, status: c.esce.status, callCount: c.esce.callCount, assignedAt: c.esce.assignedAt?.toISOString() ?? null },
    }))
    fs.writeFileSync(fileRipristino, JSON.stringify({ creato: new Date().toISOString(), motivo: MOTIVO, coppie: righeRipristino }, null, 1))
    console.log(`\nFile di ripristino: ${fileRipristino}`)

    // ── Scrittura ───────────────────────────────────────────────────────────
    const base = Date.now()
    const scritte = await db.transaction(async (tx) => {
        let n = 0
        let i = 0
        for (const blocco of lotti(coppie)) {
            const idsBlocco = blocco.flatMap((c) => [c.entra.id, c.esce.id])
            const rilettura = await tx.select({
                id: leads.id, assignedToId: leads.assignedToId, status: leads.status, callCount: leads.callCount,
                recallDate: leads.recallDate, assignedAt: leads.assignedAt,
            }).from(leads).where(and(aperti, inArray(leads.id, idsBlocco))).for('update')
            const ora = new Map(rilettura.map((r) => [r.id, r]))
            const eventi: (typeof leadEvents.$inferInsert)[] = []
            for (const c of blocco) {
                const re = ora.get(c.entra.id)
                const ru = ora.get(c.esce.id)
                if (!re || re.assignedToId !== null || re.callCount !== 0 || re.recallDate) continue
                if (!ru || ru.assignedToId !== c.gdo || ru.callCount !== 0 || ru.recallDate) continue
                const te = new Date(base + i++)
                const tu = new Date(base + i++)
                await tx.update(leads).set({
                    assignedToId: c.gdo,
                    assignedAt: sql`COALESCE(${leads.assignedAt}, ${te})`,
                    updatedAt: te,
                    version: sql`${leads.version} + 1`,
                }).where(and(aperti, eq(leads.id, c.entra.id)))
                await tx.update(leads).set({
                    assignedToId: null,
                    assignedAt: c.esceAssignedAtPrima ? new Date(c.esceAssignedAtPrima) : null,
                    status: c.esceStatusPrima,
                    updatedAt: tu,
                    version: sql`${leads.version} + 1`,
                }).where(and(aperti, eq(leads.id, c.esce.id)))
                eventi.push({
                    id: crypto.randomUUID(), leadId: c.entra.id, eventType: 'REASSIGNED_ADMIN', userId: null,
                    fromSection: 'Prima Chiamata', toSection: 'Prima Chiamata', timestamp: te,
                    metadata: {
                        reason: MOTIVO, nota: NOTA, origine: `pool:${MOTIVO_INTERROTTE}`,
                        fromAssigneeId: null, toAssigneeId: c.gdo, toGdoCode: codiceDi.get(c.gdo) ?? null,
                        colonna: 'P', stato: re.status, callCount: 0, recallDate: null,
                        sostituisce: c.esce.id,
                        assignedAtPrima: re.assignedAt ? re.assignedAt.toISOString() : null,
                    },
                    companyId: FENICE,
                }, {
                    id: crypto.randomUUID(), leadId: c.esce.id, eventType: 'REASSIGNED_ADMIN', userId: null,
                    fromSection: 'Prima Chiamata', toSection: 'Prima Chiamata', timestamp: tu,
                    metadata: {
                        reason: MOTIVO, nota: NOTA, origine: 'torna_nel_pool',
                        fromAssigneeId: c.gdo, toAssigneeId: null, fromGdoCode: codiceDi.get(c.gdo) ?? null,
                        colonna: 'P', stato: c.esceStatusPrima, callCount: 0, recallDate: null,
                        sostituitoDa: c.entra.id,
                        assignedAtPrima: ru.assignedAt ? ru.assignedAt.toISOString() : null,
                        assignedAtRimesso: c.esceAssignedAtPrima,
                    },
                    companyId: FENICE,
                })
                n++
            }
            if (eventi.length) await tx.insert(leadEvents).values(eventi)
        }
        return n
    })
    console.log(`\nScritto: ${scritte} coppie su ${coppie.length} pianificate (REASSIGNED_ADMIN, reason ${MOTIVO}).`)
    console.log(`Per annullare: --ripristina --file=${fileRipristino} --esegui`)
}

async function annulla(esegui: boolean) {
    let file = opzione('file')
    if (!file) {
        const nomi = fs.existsSync(CARTELLA_RIPRISTINO)
            ? fs.readdirSync(CARTELLA_RIPRISTINO).filter((f) => f.startsWith('ridistribuzione-26-10-interrotte-') && f.endsWith('.json')).sort()
            : []
        if (!nomi.length) throw new Error(`Nessun file di ripristino in ${CARTELLA_RIPRISTINO}`)
        file = path.join(CARTELLA_RIPRISTINO, nomi[nomi.length - 1])
    }
    const dati = JSON.parse(fs.readFileSync(file, 'utf8')) as { coppie: RigaRipristino[] }
    console.log(`Ripristino da ${file}: ${dati.coppie.length} coppie.`)
    const aperti = and(
        eq(leads.companyId, FENICE), inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.appointmentDate), isNull(leads.presentedAt),
    )
    const ora = new Map<string, { assignedToId: string | null; callCount: number; recallDate: Date | null }>()
    for (const blocco of lotti(dati.coppie.flatMap((c) => [c.entra.id, c.esce.id]))) {
        const r = await db.select({ id: leads.id, assignedToId: leads.assignedToId, callCount: leads.callCount, recallDate: leads.recallDate })
            .from(leads).where(and(aperti, inArray(leads.id, blocco)))
        for (const x of r) ora.set(x.id, x)
    }
    // Solo le coppie ancora come le ha lasciate lo script.
    const daRimettere = dati.coppie.filter((c) => {
        const e = ora.get(c.entra.id), u = ora.get(c.esce.id)
        return e && u && e.assignedToId === c.gdo && e.callCount === 0 && !e.recallDate
            && u.assignedToId === null && u.callCount === 0 && !u.recallDate
    })
    console.log(`Coppie ancora come le ha lasciate lo script: ${daRimettere.length}; le altre restano dove sono.`)
    if (!esegui) {
        console.log('Prova a vuoto del ripristino. Aggiungi --esegui per scrivere.')
        return
    }
    const base = Date.now()
    const n = await db.transaction(async (tx) => {
        let k = 0
        let i = 0
        for (const c of daRimettere) {
            const te = new Date(base + i++)
            const tu = new Date(base + i++)
            const a = await tx.update(leads).set({
                assignedToId: null, assignedAt: c.entra.assignedAt ? new Date(c.entra.assignedAt) : null,
                updatedAt: te, version: sql`${leads.version} + 1`,
            }).where(and(aperti, eq(leads.id, c.entra.id), eq(leads.assignedToId, c.gdo), eq(leads.callCount, 0))).returning({ id: leads.id })
            const b = await tx.update(leads).set({
                assignedToId: c.gdo, assignedAt: c.esce.assignedAt ? new Date(c.esce.assignedAt) : null,
                updatedAt: tu, version: sql`${leads.version} + 1`,
            }).where(and(aperti, eq(leads.id, c.esce.id), isNull(leads.assignedToId), eq(leads.callCount, 0))).returning({ id: leads.id })
            if (a.length !== 1 || b.length !== 1) throw new Error(`Coppia ${c.entra.id}/${c.esce.id} cambiata durante il ripristino`)
            await tx.insert(leadEvents).values([
                { id: crypto.randomUUID(), leadId: c.entra.id, eventType: 'REASSIGNED_ADMIN', userId: null, timestamp: te,
                    metadata: { reason: `${MOTIVO}_annullata`, fromAssigneeId: c.gdo, toAssigneeId: null, colonna: 'P' }, companyId: FENICE },
                { id: crypto.randomUUID(), leadId: c.esce.id, eventType: 'REASSIGNED_ADMIN', userId: null, timestamp: tu,
                    metadata: { reason: `${MOTIVO}_annullata`, fromAssigneeId: null, toAssigneeId: c.gdo, colonna: 'P' }, companyId: FENICE },
            ])
            k++
        }
        return k
    })
    console.log(`Coppie ripristinate: ${n}.`)
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
