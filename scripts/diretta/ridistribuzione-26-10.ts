/**
 * Ridistribuzione per lunedì 26/10/2026 (PO, domenica 25/10 sera, decisioni finali).
 *
 * Squadra di lunedì, tutti presenti e trattati allo stesso modo (Christel 114
 * e Beatrice 112 in malattia ma contate come presenti): 105, 106, 107, 110,
 * 112, 114, 115, 116, 119. Lorenzo (118) si svuota: prima, seconde e terze a
 * 0; gli restano solo i richiami, che non si spostano mai.
 *
 * Colonne = quelle della pipeline GDO (getPipelineLeads): lead aperti senza
 * richiamo; "Prima chiamata" callCount 0 oppure "Ti ha cercato" aperto,
 * "Seconda" callCount 1, "Terza" callCount 2. Un ridato dal bot riparte da
 * callCount 0: si riconosce solo dall'evento REASSIGNED_FROM_BOT.
 *
 * Chi NON si sposta mai (resta a chi lo ha e conta nella sua colonna):
 *   - i lead con un richiamo (recallDate), di qualunque GDO;
 *   - "Ti ha cercato" aperto: la richiesta è stata data a quella persona;
 *   - i lead del lancio (eLeadDelLancio): tolti ai GDO il 24/10;
 *   - le infornate fuori KPI/senso unico, i lead di prova, Serenamente
 *     (solo companyId fenice).
 *
 * Algoritmo, nell'ordine:
 *   1. Prima chiamata, obiettivo 40 per tutti e 9. Fonti: le eccedenze (tutto
 *      Lorenzo e chi è sopra 40, che cede i ridati restituiti da più tempo),
 *      poi il pool parcheggiato, i ridati dal bot più recenti per primi
 *      (ultima REASSIGNED_FROM_BOT).
 *   2. Seconde e terze, obiettivo 30 e 30. Chi è sopra cede l'eccedenza (le
 *      chiamate più recenti: tiene la cima della coda, ferma da più tempo);
 *      Lorenzo cede tutto. Chi è sotto riceve prima le eccedenze degli altri,
 *      poi i parcheggiati (chiamati per ultimi prima).
 *      Solo lead coerenti col tentativo: almeno callCount chiamate VERE di una
 *      persona (callLogs di un utente non bot) dopo l'ultima restituzione del
 *      bot. callCount da solo non basta (il bot lo azzera e lo può muovere).
 *   3. Le eccedenze che non servono a nessuno (e quelle non coerenti)
 *      tornano nel pool: assignedToId null + RIDATO_PARCHEGGIATO.
 *   Ogni lead si sposta una volta sola; dentro un gruppo si dà a turno a chi
 *   ne ha meno, così la qualità resta pari. Se i lead adatti non bastano, chi
 *   resta scoperto resta sotto obiettivo.
 *
 * Pool parcheggiato: assignedToId null con un RIDATO_PARCHEGGIATO, qualunque
 * motivo tranne il lancio (lancio_tolto_a_tutti). Esclusi i lead che nel DB
 * del bot sono in lavorazione, scartati o con appuntamento (ESCLUSI_DAL_BOT,
 * letti dal DB del bot il 25/10 sera: questo script non vede il DB del bot).
 *
 * Scrittura (--esegui): prima salva in scripts/diretta/ripristino/ lo stato di
 * ogni lead da spostare, poi in transazione rilegge ogni lead sotto lock con
 * lo stesso predicato e salta chi è cambiato: assignedToId nuovo, assignedAt
 * come il CRM (COALESCE), stato/tentativi/storico invariati, evento
 * REASSIGNED_ADMIN (o RIDATO_PARCHEGGIATO per chi torna nel pool).
 * updatedAt sfalsato di 1 ms per lead: il feed /api/bot/lead-status ha il
 * cursore solo su updatedAt e si blocca con 200+ righe allo stesso istante.
 * Nessuna notifica ai GDO, nessun webhook marketing, nessuna chiamata al bot.
 *
 * --ripristina [--file=...] legge il file di ripristino (di default l'ultimo)
 * e rimette a chi lo aveva ogni lead ancora aperto, ancora dove questo script
 * lo ha messo e con gli stessi tentativi. Prova a vuoto senza --esegui.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/ridistribuzione-26-10.ts
 *        [--esegui | --ripristina [--file=...] [--esegui]] [--prima=40] [--seconde-terze=30]
 *        [--elenco] [--candidati=file.json]
 *
 * Dry-run di default: solo letture, stampa il piano.
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
const MOTIVO = 'ridistribuzione_26_10'
const MOTIVO_PARCHEGGIO = 'ridistribuzione_26_10_eccedenza'
const NOTA = 'PO 25/10/2026 sera: tutti a 40 in prima chiamata, 30 in seconde e 30 in terze, Lorenzo svuotato'
const LOTTO = 300
const CARTELLA_RIPRISTINO = path.resolve('scripts/diretta/ripristino')

// Squadra di lunedì, tutti uguali. Lorenzo (118) si svuota.
const SQUADRA = [105, 106, 107, 110, 112, 114, 115, 116, 119] as const
const SVUOTA = 118

/** Motivi di parcheggio che NON fanno parte del pool usabile. */
const MOTIVI_FUORI_POOL = ['lancio_tolto_a_tutti'] as const

// Dal DB del bot (25/10/2026 sera): conversazione in lavorazione (ai_status
// active) oppure esito DA_SCARTARE / APPUNTAMENTO. Letti sui candidati del
// pool parcheggiato (prima, seconde e terze) con --candidati.
const ESCLUSI_DAL_BOT = new Set<string>([
    'f5259f82-0448-4f7f-8200-1a1288ff1303',
    // controllo del 25/10 sera sui candidati di questo piano (prima + seconde + terze, con margine)
    'c25a2475-a0d3-4421-80be-64e92c80af70', // DA_SCARTARE
    'cded1e1f-b8f2-4c49-ac95-48fdad207da8', // DA_SCARTARE
    '60fdbefe-ce99-476e-8c5d-0150327a114d', // DA_SCARTARE
    '6210d500-7b5c-4bd7-840b-caf4d71e6f2c', // chat attiva nel bot
])

type Colonna = 'P' | 'S' | 'T'
const NOME_COLONNA: Record<Colonna, string> = { P: 'Prima Chiamata', S: 'Seconda Chiamata', T: 'Terza Chiamata' }

function opzione(nome: string): string | undefined {
    const pref = `--${nome}=`
    return process.argv.find((a) => a.startsWith(pref))?.slice(pref.length)
}

function intero(nome: string, predefinito: number): number {
    const raw = opzione(nome)
    if (raw === undefined) return predefinito
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > 500) throw new Error(`--${nome} non valido (${raw})`)
    return n
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
    lastCallDate: Date | null
    assignedAt: Date | null
    updatedAt: Date | null
    funnel: string | null
    lancio: boolean
    contaKpi: boolean
    sensoUnico: boolean
    motivoParcheggio: string | null
    /** Chiamate vere di una persona (utente non bot) dopo l'ultima restituzione del bot. */
    chiamateUmaneGiro: number
}

interface Mossa {
    lead: Lead
    colonna: Colonna
    da: string | null
    /** null = torna nel pool parcheggiato. */
    a: string | null
    origine: string
}

interface RigaRipristino {
    id: string
    colonna: Colonna
    da: string | null
    a: string | null
    origine: string
    status: string
    callCount: number
    assignedAt: string | null
    updatedAt: string | null
}

const ms = (d: Date | null) => d?.getTime() ?? 0

async function main() {
    const esegui = process.argv.includes('--esegui')
    const ripristina = process.argv.includes('--ripristina')
    const elenco = process.argv.includes('--elenco')
    const obiettivoP = intero('prima', 40)
    const obiettivoST = intero('seconde-terze', 30)
    const fileCandidati = opzione('candidati')

    if (ripristina) return annulla(esegui)

    // ── GDO ────────────────────────────────────────────────────────────────
    const gdoRows = await db.select({
        id: users.id, gdoCode: users.gdoCode, firstName: users.firstName,
        isBot: users.isBot, isTest: users.isTest, isActive: users.isActive,
    }).from(users).where(and(
        eq(users.companyId, FENICE), eq(users.role, 'GDO'),
        inArray(users.gdoCode, [...SQUADRA, SVUOTA]),
    ))
    const perCodice = new Map(gdoRows.map((g) => [g.gdoCode!, g]))
    for (const c of [...SQUADRA, SVUOTA]) {
        const g = perCodice.get(c)
        if (!g) throw new Error(`GDO ${c} non trovato`)
        if (g.isBot || g.isTest) throw new Error(`GDO ${c} è bot o prova: fuori`)
    }
    const idDi = (c: number) => perCodice.get(c)!.id
    const codiceDi = new Map(gdoRows.map((g) => [g.id, g.gdoCode!]))
    const nomeDi = (id: string | null) => {
        if (!id) return 'pool'
        const g = gdoRows.find((x) => x.id === id)
        return g ? `${g.firstName?.trim() || 'GDO'} (${g.gdoCode})` : id.slice(0, 8)
    }
    const tutti = [...SQUADRA, SVUOTA].map(idDi)
    const bot = new Set((await db.select({ id: users.id }).from(users).where(eq(users.isBot, true))).map((u) => u.id))

    // ── Lead: aperti dei GDO + parcheggiati non assegnati ───────────────────
    const aperti = and(
        eq(leads.companyId, FENICE),
        eq(leads.isTest, false),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
    )
    const colonne = {
        id: leads.id, assignedToId: leads.assignedToId, status: leads.status, callCount: leads.callCount,
        recallDate: leads.recallDate, lastCallDate: leads.lastCallDate, assignedAt: leads.assignedAt,
        updatedAt: leads.updatedAt,
        createdAt: leads.createdAt, funnel: leads.funnel, launchBucket: leads.launchBucket,
        lancioPool: leads.lancioPool, humanTestCohort: leads.humanTestCohort, intakeBatch: leads.intakeBatch,
        isTest: leads.isTest, reservedSalespersonId: leads.reservedSalespersonId,
    }
    const deiGdo = await db.select(colonne).from(leads).where(and(aperti, inArray(leads.assignedToId, tutti)))
    const parcheggiati = await db.select(colonne).from(leads).where(and(
        aperti, isNull(leads.assignedToId),
        sql`exists (select 1 from "leadEvents" e where e."leadId" = ${leads.id} and e."eventType" = 'RIDATO_PARCHEGGIATO')`,
    ))
    const righe = [...deiGdo, ...parcheggiati]
    const ids = righe.map((r) => r.id)

    const ritorni = new Map<string, { t: Date; reason: string | null }>()
    const segnali = new Map<string, Date>()
    const parcheggio = new Map<string, { t: Date; motivo: string | null }>()
    const cercati = new Set<string>()
    const chiamateLog = new Map<string, { userId: string | null; t: Date }[]>()
    for (const blocco of lotti(ids)) {
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
        const umaneGiro = log.filter((c) => c.userId && !bot.has(c.userId) && (!rit || c.t > rit.t)).length
        return {
            id: r.id,
            assignedToId: r.assignedToId,
            status: r.status,
            callCount: r.callCount,
            recallDate: r.recallDate,
            lastCallDate: r.lastCallDate,
            assignedAt: r.assignedAt,
            updatedAt: r.updatedAt,
            funnel: r.funnel,
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
            motivoParcheggio: r.assignedToId ? null : (parcheggio.get(r.id)?.motivo ?? null),
            chiamateUmaneGiro: umaneGiro,
        }
    })

    // Colonna come la board: richiamo fuori, "Ti ha cercato" in prima.
    const colonnaDi = (l: Lead): Colonna | 'R' | 'X' => {
        if (l.recallDate) return 'R'
        if (l.tiHaCercato || l.callCount === 0) return 'P'
        if (l.callCount === 1) return 'S'
        if (l.callCount === 2) return 'T'
        return 'X'
    }
    const spostabile = (l: Lead) => !l.recallDate && !l.tiHaCercato && !l.lancio && l.contaKpi && !l.sensoUnico
        && l.callCount <= 2 && !ESCLUSI_DAL_BOT.has(l.id)
    /** Si può mettere nella colonna di un GDO: in seconde/terze solo con le chiamate vere di quel tentativo. */
    const coerente = (l: Lead, col: Colonna) => col === 'P' || l.chiamateUmaneGiro >= l.callCount
    const obiettivoDi = (col: Colonna) => (col === 'P' ? obiettivoP : obiettivoST)

    // ── Conteggi di partenza ────────────────────────────────────────────────
    const conta = new Map<string, Record<Colonna | 'R' | 'X', number>>()
    for (const id of tutti) conta.set(id, { P: 0, S: 0, T: 0, R: 0, X: 0 })
    const bloccati = new Map<string, { cercati: number; lancio: number; altro: number }>()
    for (const id of tutti) bloccati.set(id, { cercati: 0, lancio: 0, altro: 0 })
    let incoerentiTenuti = 0
    for (const l of lead) {
        if (!l.assignedToId) continue
        const c = colonnaDi(l)
        conta.get(l.assignedToId)![c]++
        if (c === 'P' || c === 'S' || c === 'T') {
            if (!coerente(l, c)) incoerentiTenuti++
            if (!spostabile(l)) {
                const b = bloccati.get(l.assignedToId)!
                if (l.tiHaCercato) b.cercati++
                else if (l.lancio) b.lancio++
                else b.altro++
            }
        }
    }
    const prima = new Map([...conta].map(([k, v]) => [k, { ...v }]))

    // ── Pool parcheggiato ───────────────────────────────────────────────────
    const pool = lead.filter((l) => !l.assignedToId)
    const esclusionePool = (l: Lead): string | null => {
        if (!l.motivoParcheggio || (MOTIVI_FUORI_POOL as readonly string[]).includes(l.motivoParcheggio)) return `motivo ${l.motivoParcheggio ?? '—'} non usato`
        if (l.lancio) return 'lancio'
        if (l.recallDate) return 'con richiamo'
        if (l.tiHaCercato) return '"Ti ha cercato" aperto'
        if (ESCLUSI_DAL_BOT.has(l.id)) return 'in lavorazione/scartato/fissato nel bot'
        if (!l.contaKpi || l.sensoUnico) return 'infornata fuori KPI'
        if (l.callCount > 2) return '3+ tentativi'
        const c = colonnaDi(l) as Colonna
        // In prima chiamata si danno solo ridati dal bot.
        if (c === 'P' && !l.ridatoIl) return 'mai ridato dal bot (prima chiamata)'
        if (!coerente(l, c)) return 'tentativi senza chiamate vere di una persona'
        return null
    }
    const poolUsabile: Record<Colonna, Lead[]> = { P: [], S: [], T: [] }
    for (const l of pool) {
        if (esclusionePool(l)) continue
        const c = colonnaDi(l)
        if (c === 'P' || c === 'S' || c === 'T') poolUsabile[c].push(l)
    }
    // Prima: i ridati più recenti. Seconde/terze: i chiamati per ultimi.
    poolUsabile.P.sort((a, b) => ms(b.ridatoIl) - ms(a.ridatoIl) || (a.id < b.id ? -1 : 1))
    for (const c of ['S', 'T'] as const) poolUsabile[c].sort((a, b) => ms(b.lastCallDate) - ms(a.lastCallDate) || (a.id < b.id ? -1 : 1))

    if (fileCandidati) {
        // Per il controllo sul DB del bot: tutti i candidati del pool, nell'ordine in cui verrebbero usati.
        fs.writeFileSync(fileCandidati, JSON.stringify({
            P: poolUsabile.P.map((l) => l.id), S: poolUsabile.S.map((l) => l.id), T: poolUsabile.T.map((l) => l.id),
        }))
        console.log(`Candidati del pool scritti in ${fileCandidati}`)
    }

    // ── Piano ───────────────────────────────────────────────────────────────
    const mosse: Mossa[] = []
    const usati = new Set<string>()
    const lorenzo = idDi(SVUOTA)
    const squadra = SQUADRA.map(idDi)

    // Dà i lead (già in ordine) a turno a chi ne ha meno nella squadra, fino all'obiettivo.
    const distribuisci = (col: Colonna, offerta: { lead: Lead; origine: string }[]) => {
        const resto: { lead: Lead; origine: string }[] = []
        const obiettivo = obiettivoDi(col)
        for (const o of offerta) {
            if (usati.has(o.lead.id)) continue
            const sotto = squadra.filter((g) => g !== o.lead.assignedToId && conta.get(g)![col] < obiettivo)
            if (sotto.length === 0 || !coerente(o.lead, col)) { resto.push(o); continue }
            sotto.sort((x, y) => conta.get(x)![col] - conta.get(y)![col] || squadra.indexOf(x) - squadra.indexOf(y))
            const a = sotto[0]
            const da = o.lead.assignedToId
            mosse.push({ lead: o.lead, colonna: col, da, a, origine: o.origine })
            usati.add(o.lead.id)
            conta.get(a)![col]++
            if (da) conta.get(da)![col]--
        }
        return resto
    }

    // Cosa cede chi è sopra l'obiettivo (e tutto Lorenzo), già in ordine di cessione.
    const eccessi = (col: Colonna) => {
        const out: { lead: Lead; origine: string }[] = []
        for (const g of [...squadra, lorenzo]) {
            const miei = lead.filter((l) => l.assignedToId === g && colonnaDi(l) === col && spostabile(l))
            const quanti = g === lorenzo ? miei.length : Math.min(miei.length, Math.max(0, conta.get(g)![col] - obiettivoDi(col)))
            if (quanti === 0) continue
            // Prima: cede i restituiti da più tempo. Seconde/terze: tiene la cima
            // della sua coda (chiamati da più tempo) e cede i chiamati per ultimi.
            const ordine = col === 'P'
                ? [...miei].sort((a, b) => ms(a.ridatoIl ?? a.assignedAt) - ms(b.ridatoIl ?? b.assignedAt) || (a.id < b.id ? -1 : 1))
                : [...miei].sort((a, b) => ms(b.lastCallDate) - ms(a.lastCallDate) || (a.id < b.id ? -1 : 1))
            for (const l of ordine.slice(0, quanti)) out.push({ lead: l, origine: g === lorenzo ? 'lorenzo' : 'eccedenza' })
        }
        return out
    }
    // Le eccedenze rimaste: tornano nel pool (chi le cedeva scende all'obiettivo).
    const parcheggia = (col: Colonna, resto: { lead: Lead; origine: string }[]) => {
        for (const o of resto) {
            if (usati.has(o.lead.id) || !o.lead.assignedToId) continue
            mosse.push({ lead: o.lead, colonna: col, da: o.lead.assignedToId, a: null, origine: `${o.origine}:al_pool` })
            usati.add(o.lead.id)
            conta.get(o.lead.assignedToId)![col]--
        }
    }
    const migliorePrima = (a: { lead: Lead }, b: { lead: Lead }) => confrontaMigliori(a.lead, b.lead)
    const piuFermoPrima = (a: { lead: Lead }, b: { lead: Lead }) =>
        ms(a.lead.lastCallDate) - ms(b.lead.lastCallDate) || (a.lead.id < b.lead.id ? -1 : 1)

    for (const col of ['P', 'S', 'T'] as const) {
        const offerta = eccessi(col).sort(col === 'P' ? migliorePrima : piuFermoPrima)
        const resto = distribuisci(col, offerta)
        distribuisci(col, poolUsabile[col].map((l) => ({ lead: l, origine: `pool:${l.motivoParcheggio}` })))
        parcheggia(col, resto)
    }

    // ── Rapporto ────────────────────────────────────────────────────────────
    const pad = (s: string | number, n: number) => String(s).padStart(n)
    console.log(`Ridistribuzione 26/10 — prima chiamata ${obiettivoP}, seconde ${obiettivoST}, terze ${obiettivoST}.`)
    console.log(`Lead aperti Fenice dei GDO: ${deiGdo.length}; parcheggiati non assegnati: ${parcheggiati.length}.\n`)
    console.log('GDO                 | Prima        | Seconde      | Terze        | Richiami')
    console.log('                    | prima → dopo | prima → dopo | prima → dopo | prima → dopo')
    for (const g of [...squadra, lorenzo]) {
        const p = prima.get(g)!, d = conta.get(g)!
        console.log(`${nomeDi(g).padEnd(20)}| ${pad(p.P, 4)} → ${pad(d.P, 4)}  | ${pad(p.S, 4)} → ${pad(d.S, 4)}  | ${pad(p.T, 4)} → ${pad(d.T, 4)}  | ${pad(p.R, 4)} → ${pad(d.R, 4)}`)
    }

    console.log('\nMovimenti per GDO (entrano / escono, da dove):')
    for (const g of [...squadra, lorenzo]) {
        const parti: string[] = []
        for (const col of ['P', 'S', 'T'] as const) {
            const entr = mosse.filter((m) => m.a === g && m.colonna === col)
            const usc = mosse.filter((m) => m.da === g && m.colonna === col)
            if (!entr.length && !usc.length) continue
            const fonti = new Map<string, number>()
            for (const m of entr) {
                const k = m.da ? nomeDi(m.da) : m.origine.replace('pool:', 'pool ')
                fonti.set(k, (fonti.get(k) ?? 0) + 1)
            }
            const destin = new Map<string, number>()
            for (const m of usc) destin.set(nomeDi(m.a), (destin.get(nomeDi(m.a)) ?? 0) + 1)
            parti.push(`${NOME_COLONNA[col]}: +${entr.length}${fonti.size ? ` (${[...fonti].map(([k, n]) => `${n} da ${k}`).join(', ')})` : ''}`
                + `${usc.length ? `, −${usc.length} (${[...destin].map(([k, n]) => `${n} a ${k}`).join(', ')})` : ''}`)
        }
        if (parti.length) console.log(`  ${nomeDi(g)}\n    ${parti.join('\n    ')}`)
    }

    console.log('\nFermi dove sono (non si spostano, contano nella colonna):')
    for (const g of [...squadra, lorenzo]) {
        const b = bloccati.get(g)!, p = prima.get(g)!
        const v = [
            p.R ? `richiami ${p.R}` : null,
            b.cercati ? `"Ti ha cercato" ${b.cercati}` : null,
            b.lancio ? `lancio ${b.lancio}` : null,
            b.altro ? `altri ${b.altro}` : null,
            p.X ? `3+ tentativi fuori board ${p.X}` : null,
        ].filter(Boolean)
        if (v.length) console.log(`  ${nomeDi(g)}: ${v.join(', ')}`)
    }

    console.log('\nPool parcheggiato (non assegnati con RIDATO_PARCHEGGIATO):')
    const perMotivo = new Map<string, Lead[]>()
    for (const l of pool) perMotivo.set(l.motivoParcheggio ?? '—', [...(perMotivo.get(l.motivoParcheggio ?? '—') ?? []), l])
    for (const [motivo, lista] of [...perMotivo].sort((a, b) => b[1].length - a[1].length)) {
        const cause = new Map<string, number>()
        const usabili: Record<Colonna, number> = { P: 0, S: 0, T: 0 }
        for (const l of lista) {
            const e = esclusionePool(l)
            const c = colonnaDi(l)
            if (e) cause.set(e, (cause.get(e) ?? 0) + 1)
            else if (c === 'P' || c === 'S' || c === 'T') usabili[c]++
        }
        const u = mosse.filter((m) => !m.da && m.lead.motivoParcheggio === motivo)
        const per = (c: Colonna) => u.filter((m) => m.colonna === c).length
        const tot = usabili.P + usabili.S + usabili.T
        console.log(`  ${motivo}: ${lista.length} — utilizzabili ${tot} (prima ${usabili.P}, seconde ${usabili.S}, terze ${usabili.T})`
            + `${cause.size ? `; esclusi: ${[...cause].map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`)
        if (u.length) console.log(`      usati dal piano ${u.length} (prima ${per('P')}, seconde ${per('S')}, terze ${per('T')})`)
    }

    // Fonti
    console.log('\nLead spostati per fonte:')
    const perFonte = new Map<string, number>()
    for (const m of mosse) {
        const k = `${NOME_COLONNA[m.colonna]} · ${m.a === null ? 'torna nel pool' : m.da === null ? `dal ${m.origine}` : m.origine === 'lorenzo' ? 'da Lorenzo' : "dall'eccedenza di un GDO"}`
        perFonte.set(k, (perFonte.get(k) ?? 0) + 1)
    }
    for (const [k, n] of perFonte) console.log(`  ${k}: ${n}`)

    // Controlli delle regole
    const violazioni: string[] = []
    for (const m of mosse) {
        if (m.lead.recallDate) violazioni.push(`${m.lead.id}: ha un richiamo`)
        if (m.a && !coerente(m.lead, m.colonna)) violazioni.push(`${m.lead.id}: in ${NOME_COLONNA[m.colonna]} senza le chiamate vere`)
        if (m.lead.lancio || m.lead.tiHaCercato) violazioni.push(`${m.lead.id}: lancio o "Ti ha cercato"`)
        if (m.a === lorenzo) violazioni.push(`${m.lead.id}: dato a Lorenzo`)
    }
    for (const g of [...squadra, lorenzo]) if (prima.get(g)!.R !== conta.get(g)!.R) violazioni.push(`${nomeDi(g)}: richiami cambiati`)
    const lorRes = conta.get(lorenzo)!
    if (lorRes.P + lorRes.S + lorRes.T > 0) violazioni.push(`Lorenzo non a 0: prima ${lorRes.P}, seconde ${lorRes.S}, terze ${lorRes.T}`)
    console.log(`\nControlli: ${violazioni.length ? `${violazioni.length} VIOLAZIONI` : 'nessun richiamo spostato, nessun lead senza chiamate vere in seconde/terze, Lorenzo a 0'}`)
    for (const v of violazioni.slice(0, 20)) console.log(`  ${v}`)
    console.log(`(Lead già in seconde/terze di qualcuno senza le chiamate vere, lasciati dove sono: ${incoerentiTenuti})`)

    for (const col of ['P', 'S', 'T'] as const) {
        const sotto = squadra.filter((g) => conta.get(g)![col] < obiettivoDi(col))
        if (sotto.length) console.log(`Sotto obiettivo in ${NOME_COLONNA[col]} (lead adatti finiti): ${sotto.map((g) => `${nomeDi(g)} ${conta.get(g)![col]}`).join(', ')}`)
    }
    console.log(`\nTotale lead da spostare: ${mosse.length} (prima ${mosse.filter((m) => m.colonna === 'P').length}, seconde ${mosse.filter((m) => m.colonna === 'S').length}, terze ${mosse.filter((m) => m.colonna === 'T').length}; al pool ${mosse.filter((m) => !m.a).length}).`)

    if (elenco) {
        console.log('\nElenco:')
        for (const m of mosse) console.log(`  ${m.lead.id}  ${m.colonna}  ${nomeDi(m.da).padEnd(18)} → ${nomeDi(m.a).padEnd(18)} ${m.origine}`)
    }

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. --esegui per applicare, --elenco per vedere i lead uno per uno.')
        return
    }
    if (violazioni.length) throw new Error('Violazioni delle regole: non scrivo.')

    // ── File di ripristino (prima di scrivere) ──────────────────────────────
    fs.mkdirSync(CARTELLA_RIPRISTINO, { recursive: true })
    const fileRipristino = path.join(CARTELLA_RIPRISTINO, `ridistribuzione-26-10-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    const righeRipristino: RigaRipristino[] = mosse.map((m) => ({
        id: m.lead.id, colonna: m.colonna, da: m.da, a: m.a, origine: m.origine,
        status: m.lead.status, callCount: m.lead.callCount,
        assignedAt: m.lead.assignedAt ? m.lead.assignedAt.toISOString() : null,
        updatedAt: m.lead.updatedAt ? m.lead.updatedAt.toISOString() : null,
    }))
    fs.writeFileSync(fileRipristino, JSON.stringify({ creato: new Date().toISOString(), motivo: MOTIVO, mosse: righeRipristino }, null, 1))
    console.log(`\nFile di ripristino: ${fileRipristino}`)

    // ── Scrittura ───────────────────────────────────────────────────────────
    const base = Date.now()
    const scritti = await db.transaction(async (tx) => {
        let n = 0
        let i = 0
        for (const blocco of lotti(mosse)) {
            const rilettura = await tx.select({
                id: leads.id, assignedToId: leads.assignedToId, status: leads.status, callCount: leads.callCount,
                recallDate: leads.recallDate, assignedAt: leads.assignedAt,
            }).from(leads).where(and(aperti, inArray(leads.id, blocco.map((m) => m.lead.id)))).for('update')
            const ora = new Map(rilettura.map((r) => [r.id, r]))
            const eventi: (typeof leadEvents.$inferInsert)[] = []
            for (const m of blocco) {
                const r = ora.get(m.lead.id)
                // Cambiato da quando è stato letto (chiamato, richiamo, spostato): non si tocca.
                if (!r || r.assignedToId !== m.da || r.callCount !== m.lead.callCount || r.recallDate) continue
                const t = new Date(base + i++)
                if (m.a) {
                    await tx.update(leads)
                        .set({
                            assignedToId: m.a,
                            assignedAt: sql`COALESCE(${leads.assignedAt}, ${t})`,
                            updatedAt: t,
                            version: sql`${leads.version} + 1`,
                        })
                        .where(and(aperti, eq(leads.id, m.lead.id)))
                    eventi.push({
                        id: crypto.randomUUID(),
                        leadId: m.lead.id,
                        eventType: 'REASSIGNED_ADMIN',
                        userId: null,
                        fromSection: NOME_COLONNA[m.colonna],
                        toSection: NOME_COLONNA[m.colonna],
                        timestamp: t,
                        metadata: {
                            reason: MOTIVO, nota: NOTA, origine: m.origine,
                            fromAssigneeId: m.da, toAssigneeId: m.a, toGdoCode: codiceDi.get(m.a) ?? null,
                            colonna: m.colonna, stato: r.status, callCount: r.callCount, recallDate: null,
                            assignedAtPrima: r.assignedAt ? r.assignedAt.toISOString() : null,
                        },
                        companyId: FENICE,
                    })
                } else {
                    await tx.update(leads)
                        .set({ assignedToId: null, updatedAt: t, version: sql`${leads.version} + 1` })
                        .where(and(aperti, eq(leads.id, m.lead.id)))
                    eventi.push({
                        id: crypto.randomUUID(),
                        leadId: m.lead.id,
                        eventType: 'RIDATO_PARCHEGGIATO',
                        userId: null,
                        timestamp: t,
                        metadata: {
                            nota: NOTA, motivo: MOTIVO_PARCHEGGIO, reason: MOTIVO, colonna: m.colonna,
                            tolto_a: m.da, stato: r.status, callCount: r.callCount, recallDate: null,
                            assignedAtPrima: r.assignedAt ? r.assignedAt.toISOString() : null,
                        },
                        companyId: FENICE,
                    })
                }
                n++
            }
            if (eventi.length) await tx.insert(leadEvents).values(eventi)
        }
        return n
    })
    console.log(`\nScritto: ${scritti} lead su ${mosse.length} pianificati (REASSIGNED_ADMIN / RIDATO_PARCHEGGIATO, reason ${MOTIVO}).`)
    console.log(`Per annullare: --ripristina --file=${fileRipristino} --esegui`)
}

async function annulla(esegui: boolean) {
    let file = opzione('file')
    if (!file) {
        const nomi = fs.existsSync(CARTELLA_RIPRISTINO)
            ? fs.readdirSync(CARTELLA_RIPRISTINO).filter((f) => f.startsWith('ridistribuzione-26-10-') && f.endsWith('.json')).sort()
            : []
        if (!nomi.length) throw new Error(`Nessun file di ripristino in ${CARTELLA_RIPRISTINO}`)
        file = path.join(CARTELLA_RIPRISTINO, nomi[nomi.length - 1])
    }
    const dati = JSON.parse(fs.readFileSync(file, 'utf8')) as { mosse: RigaRipristino[] }
    console.log(`Ripristino da ${file}: ${dati.mosse.length} lead.`)
    const aperti = and(
        eq(leads.companyId, FENICE), inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        isNull(leads.appointmentDate), isNull(leads.presentedAt),
    )
    const ora = new Map<string, { assignedToId: string | null; callCount: number; recallDate: Date | null }>()
    for (const blocco of lotti(dati.mosse.map((m) => m.id))) {
        const r = await db.select({ id: leads.id, assignedToId: leads.assignedToId, callCount: leads.callCount, recallDate: leads.recallDate })
            .from(leads).where(and(aperti, inArray(leads.id, blocco)))
        for (const x of r) ora.set(x.id, x)
    }
    // Si rimette solo chi è ancora dove lo ha messo lo script, con gli stessi tentativi.
    const daRimettere = dati.mosse.filter((m) => {
        const r = ora.get(m.id)
        return r && r.assignedToId === m.a && r.callCount === m.callCount && !r.recallDate
    })
    console.log(`Ancora come li ha lasciati lo script: ${daRimettere.length}; gli altri sono stati lavorati o spostati e restano dove sono.`)
    if (!esegui) {
        console.log('Prova a vuoto del ripristino. Aggiungi --esegui per scrivere.')
        return
    }
    const base = Date.now()
    const n = await db.transaction(async (tx) => {
        let k = 0
        let i = 0
        for (const m of daRimettere) {
            const t = new Date(base + i++)
            const res = await tx.update(leads)
                .set({
                    assignedToId: m.da,
                    assignedAt: m.assignedAt ? new Date(m.assignedAt) : null,
                    updatedAt: t,
                    version: sql`${leads.version} + 1`,
                })
                .where(and(
                    aperti, eq(leads.id, m.id), eq(leads.callCount, m.callCount),
                    m.a ? eq(leads.assignedToId, m.a) : isNull(leads.assignedToId),
                ))
                .returning({ id: leads.id })
            if (res.length === 0) continue
            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId: m.id,
                eventType: 'REASSIGNED_ADMIN',
                userId: null,
                timestamp: t,
                metadata: { reason: `${MOTIVO}_annullata`, fromAssigneeId: m.a, toAssigneeId: m.da, colonna: m.colonna },
                companyId: FENICE,
            })
            k++
        }
        return k
    })
    console.log(`Ripristinati: ${n}.`)
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
