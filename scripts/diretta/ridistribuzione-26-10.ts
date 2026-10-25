/**
 * Ridistribuzione per lunedì 26/10/2026 (PO, domenica 25/10 sera).
 *
 * Bruno: "bilancia i lead ridati dal bot di tutti e fai arrivare tutti a 40
 * nuovi; Christel e Beatrice dal pool dei ridati parcheggiati, senza levarli
 * agli altri; Noemi e Lavinia prima dagli eccessi, poi dal pool. Seconde e
 * terze al massimo 40 a testa, Noemi e Lavinia da rimpolpare, anche con quelle
 * di Lorenzo (118), che si svuota."
 *
 * Colonne = quelle della pipeline GDO (getPipelineLeads): lead aperti senza
 * richiamo; "Prima chiamata" callCount 0 oppure "Ti ha cercato" aperto,
 * "Seconda" callCount 1, "Terza" callCount 2. Un ridato dal bot riparte da
 * callCount 0: si riconosce solo dall'evento REASSIGNED_FROM_BOT.
 *
 * Chi NON si sposta mai (resta a chi lo ha e conta nella sua colonna):
 *   - i lead con un richiamo (recallDate): vincolo del PO, di qualunque GDO;
 *   - "Ti ha cercato" aperto: la richiesta è stata data a quella persona;
 *   - i lead del lancio (eLeadDelLancio): tolti ai GDO il 24/10;
 *   - le infornate fuori KPI/senso unico, i lead di prova.
 *
 * Algoritmo, nell'ordine:
 *   1. Prima chiamata, obiettivo 40. Chi ne ha più di 40 cede l'eccesso (i
 *      ridati restituiti da più tempo); Lorenzo cede tutto. L'eccesso va prima
 *      a Noemi e Lavinia, poi a chi è sotto (mai Christel e Beatrice). Poi il
 *      pool parcheggiato: Noemi e Lavinia, Christel e Beatrice, poi gli altri.
 *   2. Seconde e terze, tetto 40. Chi è sopra cede le chiamate più recenti (tiene
 *      quelle in cima alla sua coda, ferme da più tempo); Lorenzo cede tutto,
 *      anche le seconde e terze parcheggiate stamattina da lead-lorenzo.ts.
 *      Vanno prima a Noemi e Lavinia, poi a chi è sotto 40.
 *   Ogni lead si sposta una volta sola; dentro un gruppo si dà a turno il lead
 *   migliore a chi ne ha meno, così la qualità resta pari.
 *
 * Pool parcheggiato (assignedToId null, ultimo RIDATO_PARCHEGGIATO), in ordine
 * di preferenza: stella_fuori_selezione (chat interrotta, parcheggiati il
 * 20/10 "da riassegnare"), lorenzo_solo_ridati_migliori (stamattina),
 * mai_risposto_al_bot (dal 19/10). Il lancio (lancio_tolto_a_tutti) non si usa.
 * Esclusi anche i lead che nel DB del bot risultano scartati o con
 * appuntamento (lista ESCLUSI_DAL_BOT, letta il 25/10 sera): questo script non
 * vede il DB del bot.
 *
 * Scrittura (--esegui), in transazione, rileggendo ogni lead sotto lock con lo
 * stesso predicato: assignedToId nuovo, assignedAt come il CRM (COALESCE: la
 * prima presa in carico non si riscrive), stato/tentativi/storico invariati,
 * evento REASSIGNED_ADMIN con chi lo aveva, colonna e assignedAt di prima.
 * updatedAt sfalsato di 1 ms per lead: il feed /api/bot/lead-status ha il
 * cursore solo su updatedAt e si blocca con 200+ righe allo stesso istante.
 * Nessuna notifica ai GDO, nessun webhook marketing, nessuna chiamata al bot.
 *
 * --ripristina annulla: rimette ogni lead spostato da questo script, se è
 * ancora aperto e ancora del GDO che lo ha ricevuto, a chi lo aveva (null per
 * il pool) con l'assignedAt di prima.
 *
 *   node --import tsx --env-file=.env.local scripts/diretta/ridistribuzione-26-10.ts
 *        [--esegui | --ripristina] [--obiettivo=40] [--elenco]
 *
 * Dry-run di default: solo letture, stampa il piano.
 */

import crypto from 'node:crypto'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../../src/db'
import { botContactRequests, callLogs, leadEvents, leads, users } from '../../src/db/schema'
import { eLeadDelLancio } from '../../src/lib/diretta/instradamento'
import { contaNeiKpi, BATCH_SENSO_UNICO } from '../../src/lib/intakeBatch'
import { confrontaMigliori, type LeadEreditato } from '../../src/lib/diretta/ridatiDaTenere'

const FENICE = 'fenice'
const MOTIVO = 'ridistribuzione_26_10'
const NOTA = 'PO 25/10/2026 sera: ridati bilanciati a 40 in prima chiamata, seconde e terze al massimo 40, Lorenzo svuotato'
const LOTTO = 300

// Squadra di lunedì. Lorenzo (118) si svuota.
const SQUADRA = [105, 106, 107, 110, 112, 114, 115, 116, 119] as const
const SVUOTA = 118
const PRIORITA = [107, 116] as const          // Noemi, Lavinia
const SOLO_DAL_POOL = [114, 112] as const     // Christel, Beatrice: prima chiamata solo dal pool

const MOTIVI_POOL = ['stella_fuori_selezione', 'lorenzo_solo_ridati_migliori', 'mai_risposto_al_bot'] as const

// Dal DB del bot (25/10/2026 sera): esito DA_SCARTARE o APPUNTAMENTO sulla
// conversazione, oppure chat ripresa dal bot (ai_status active). Fra i
// candidati del pool in prima chiamata ne è risultato uno solo.
const ESCLUSI_DAL_BOT = new Set<string>(['f5259f82-0448-4f7f-8200-1a1288ff1303'])

type Colonna = 'P' | 'S' | 'T'
const NOME_COLONNA: Record<Colonna, string> = { P: 'Prima Chiamata', S: 'Seconda Chiamata', T: 'Terza Chiamata' }

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
    lastCallDate: Date | null
    assignedAt: Date | null
    funnel: string | null
    lancio: boolean
    contaKpi: boolean
    sensoUnico: boolean
    motivoParcheggio: string | null
}

interface Mossa {
    lead: Lead
    colonna: Colonna
    da: string | null
    a: string
    origine: string
}

const ms = (d: Date | null) => d?.getTime() ?? 0

async function main() {
    const esegui = process.argv.includes('--esegui')
    const ripristina = process.argv.includes('--ripristina')
    const elenco = process.argv.includes('--elenco')
    const obiettivo = Number(opzione('obiettivo') ?? 40)
    if (!Number.isInteger(obiettivo) || obiettivo < 0 || obiettivo > 500) throw new Error(`--obiettivo non valido`)
    if (esegui && ripristina) throw new Error('--esegui e --ripristina insieme non hanno senso')

    if (ripristina) return annulla()

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
    const chiamate = new Map<string, number>()
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
        const cl = await db.select({ leadId: callLogs.leadId, n: sql<number>`count(*)::int` })
            .from(callLogs).where(inArray(callLogs.leadId, blocco)).groupBy(callLogs.leadId)
        for (const c of cl) chiamate.set(c.leadId, c.n)
    }

    const lead: Lead[] = righe.map((r) => {
        const rit = ritorni.get(r.id) ?? null
        return {
            id: r.id,
            assignedToId: r.assignedToId,
            status: r.status,
            callCount: r.callCount,
            recallDate: r.recallDate,
            lastCallDate: r.lastCallDate,
            assignedAt: r.assignedAt,
            funnel: r.funnel,
            chiamateTotali: chiamate.get(r.id) ?? 0,
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

    // ── Conteggi di partenza ────────────────────────────────────────────────
    const conta = new Map<string, Record<Colonna | 'R' | 'X', number>>()
    for (const id of tutti) conta.set(id, { P: 0, S: 0, T: 0, R: 0, X: 0 })
    const bloccati = new Map<string, { cercati: number; lancio: number; altro: number }>()
    for (const id of tutti) bloccati.set(id, { cercati: 0, lancio: 0, altro: 0 })
    for (const l of lead) {
        if (!l.assignedToId) continue
        conta.get(l.assignedToId)![colonnaDi(l)]++
        const c = colonnaDi(l)
        if (c === 'P' || c === 'S' || c === 'T') {
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
        if (!l.motivoParcheggio || !(MOTIVI_POOL as readonly string[]).includes(l.motivoParcheggio)) return `motivo ${l.motivoParcheggio ?? '—'} non usato`
        if (l.lancio) return 'lancio'
        // In prima chiamata si danno solo ridati; le seconde e terze di Lorenzo
        // valgono anche se non sono passate dal bot (pool database compresi).
        if (!l.ridatoIl && colonnaDi(l) === 'P') return 'mai ridato dal bot (prima chiamata)'
        if (l.recallDate) return 'con richiamo'
        if (l.tiHaCercato) return '"Ti ha cercato" aperto'
        if (ESCLUSI_DAL_BOT.has(l.id)) return 'scartato/fissato nel bot'
        if (!l.contaKpi || l.sensoUnico) return 'infornata fuori KPI'
        if (l.callCount > 2) return '3+ tentativi'
        return null
    }
    const ordinePool = (a: Lead, b: Lead) => {
        const ma = MOTIVI_POOL.indexOf(a.motivoParcheggio as typeof MOTIVI_POOL[number])
        const mb = MOTIVI_POOL.indexOf(b.motivoParcheggio as typeof MOTIVI_POOL[number])
        if (ma !== mb) return ma - mb
        return confrontaMigliori(a, b)
    }
    const poolUsabile: Record<Colonna, Lead[]> = { P: [], S: [], T: [] }
    for (const l of pool) {
        if (esclusionePool(l)) continue
        const c = colonnaDi(l)
        if (c === 'P' || c === 'S' || c === 'T') poolUsabile[c].push(l)
    }
    poolUsabile.P.sort(ordinePool)
    // Seconde e terze dal pool: solo quelle di Lorenzo (il PO non ha chiesto le altre).
    poolUsabile.S = poolUsabile.S.filter((l) => l.motivoParcheggio === 'lorenzo_solo_ridati_migliori')
    poolUsabile.T = poolUsabile.T.filter((l) => l.motivoParcheggio === 'lorenzo_solo_ridati_migliori')

    // ── Piano ───────────────────────────────────────────────────────────────
    const mosse: Mossa[] = []
    const usati = new Set<string>()
    const lorenzo = idDi(SVUOTA)
    const priorita = PRIORITA.map(idDi)
    const soloPool = new Set<string>(SOLO_DAL_POOL.map(idDi))
    const squadra = SQUADRA.map(idDi)

    // Dà i lead (già in ordine, migliori prima) a turno a chi ne ha meno nel gruppo, fino all'obiettivo.
    const distribuisci = (col: Colonna, offerta: { lead: Lead; origine: string }[], gruppo: string[]) => {
        const resto: { lead: Lead; origine: string }[] = []
        for (const o of offerta) {
            if (usati.has(o.lead.id)) continue
            const sotto = gruppo.filter((g) => conta.get(g)![col] < obiettivo)
            if (sotto.length === 0) { resto.push(o); continue }
            sotto.sort((x, y) => conta.get(x)![col] - conta.get(y)![col] || gruppo.indexOf(x) - gruppo.indexOf(y))
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
            const quanti = g === lorenzo ? miei.length : Math.max(0, conta.get(g)![col] - obiettivo)
            if (quanti === 0) continue
            // Prima: cede i restituiti da più tempo. Seconde/terze: tiene la cima
            // della sua coda (chiamati da più tempo) e cede i chiamati per ultimi.
            const ordine = col === 'P'
                ? [...miei].sort((a, b) => ms(a.ridatoIl ?? a.assignedAt) - ms(b.ridatoIl ?? b.assignedAt) || (a.id < b.id ? -1 : 1))
                : [...miei].sort((a, b) => ms(b.lastCallDate) - ms(a.lastCallDate) || (a.id < b.id ? -1 : 1))
            for (const l of ordine.slice(0, quanti)) out.push({ lead: l, origine: g === lorenzo ? 'lorenzo' : 'eccesso' })
        }
        return out
    }
    const migliorePrima = (a: { lead: Lead }, b: { lead: Lead }) => confrontaMigliori(a.lead, b.lead)
    const piuFermoPrima = (a: { lead: Lead }, b: { lead: Lead }) =>
        ms(a.lead.lastCallDate) - ms(b.lead.lastCallDate) || (a.lead.id < b.lead.id ? -1 : 1)

    // 1. Prima chiamata
    {
        const offerta = eccessi('P').sort(migliorePrima)
        const altri = squadra.filter((g) => !priorita.includes(g) && !soloPool.has(g))
        let resto = distribuisci('P', offerta, priorita)
        resto = distribuisci('P', resto, altri)
        const dalPool = poolUsabile.P.map((l) => ({ lead: l, origine: `pool:${l.motivoParcheggio}` }))
        let rp = distribuisci('P', dalPool, priorita)
        rp = distribuisci('P', rp, [...soloPool])
        distribuisci('P', rp, altri)
        // Eccessi che non trovano posto restano a chi li ha (Lorenzo compreso: lo dice il rapporto).
        void resto
    }
    // 2. Seconde e terze
    for (const col of ['S', 'T'] as const) {
        const offerta = [
            ...eccessi(col),
            ...poolUsabile[col].map((l) => ({ lead: l, origine: 'pool:lorenzo_solo_ridati_migliori' })),
        ].sort(piuFermoPrima)
        const resto = distribuisci(col, offerta, priorita)
        distribuisci(col, resto, squadra.filter((g) => !priorita.includes(g)))
    }

    // ── Rapporto ────────────────────────────────────────────────────────────
    const pad = (s: string | number, n: number) => String(s).padStart(n)
    console.log(`Ridistribuzione 26/10 — obiettivo ${obiettivo} in prima, tetto ${obiettivo} in seconde e terze.`)
    console.log(`Lead aperti Fenice dei GDO: ${deiGdo.length}; parcheggiati non assegnati: ${parcheggiati.length}.\n`)
    console.log('GDO                 | Prima        | Seconde      | Terze        | Richiami (fermi)')
    console.log('                    | prima → dopo | prima → dopo | prima → dopo |')
    for (const g of [...squadra, lorenzo]) {
        const p = prima.get(g)!, d = conta.get(g)!
        console.log(`${nomeDi(g).padEnd(20)}| ${pad(p.P, 4)} → ${pad(d.P, 4)}  | ${pad(p.S, 4)} → ${pad(d.S, 4)}  | ${pad(p.T, 4)} → ${pad(d.T, 4)}  | ${pad(p.R, 4)}`)
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
        const uP = u.filter((m) => m.colonna === 'P').length
        const uST = u.length - uP
        const tot = usabili.P + usabili.S + usabili.T
        console.log(`  ${motivo}: ${lista.length} — utilizzabili ${tot} (prima ${usabili.P}, seconde ${usabili.S}, terze ${usabili.T})`
            + `${cause.size ? `; esclusi: ${[...cause].map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`)
        if (u.length) console.log(`      usati dal piano ${u.length} (prima ${uP}, seconde/terze ${uST}); restano utilizzabili ${tot - u.length}`)
    }

    const noSotto = [...squadra].filter((g) => conta.get(g)!.P < obiettivo)
    if (noSotto.length) console.log(`\nSotto ${obiettivo} in prima chiamata perché i lead non bastano: ${noSotto.map(nomeDi).join(', ')}`)
    const lorRes = conta.get(lorenzo)!
    console.log(`\n${nomeDi(lorenzo)} dopo: prima ${lorRes.P}, seconde ${lorRes.S}, terze ${lorRes.T}, richiami ${lorRes.R}.`)
    console.log(`Totale lead da spostare: ${mosse.length} (prima ${mosse.filter((m) => m.colonna === 'P').length}, seconde ${mosse.filter((m) => m.colonna === 'S').length}, terze ${mosse.filter((m) => m.colonna === 'T').length}).`)

    if (elenco) {
        console.log('\nElenco:')
        for (const m of mosse) console.log(`  ${m.lead.id}  ${m.colonna}  ${nomeDi(m.da).padEnd(18)} → ${nomeDi(m.a).padEnd(18)} ${m.origine}`)
    }

    if (!esegui) {
        console.log('\nDry-run: nessuna scrittura. --esegui per applicare, --elenco per vedere i lead uno per uno.')
        return
    }

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
                        reason: MOTIVO,
                        nota: NOTA,
                        origine: m.origine,
                        fromAssigneeId: m.da,
                        toAssigneeId: m.a,
                        toGdoCode: codiceDi.get(m.a) ?? null,
                        colonna: m.colonna,
                        stato: r.status,
                        callCount: r.callCount,
                        recallDate: null,
                        assignedAtPrima: r.assignedAt ? r.assignedAt.toISOString() : null,
                    },
                    companyId: FENICE,
                })
                n++
            }
            if (eventi.length) await tx.insert(leadEvents).values(eventi)
        }
        return n
    })
    console.log(`\nScritto: ${scritti} lead spostati su ${mosse.length} pianificati (evento REASSIGNED_ADMIN, reason ${MOTIVO}).`)
    console.log('Per annullare: --ripristina.')
}

async function annulla() {
    const ev = await db.select({
        leadId: leadEvents.leadId,
        timestamp: leadEvents.timestamp,
        da: sql<string | null>`${leadEvents.metadata}->>'fromAssigneeId'`,
        a: sql<string | null>`${leadEvents.metadata}->>'toAssigneeId'`,
        assignedAtPrima: sql<string | null>`${leadEvents.metadata}->>'assignedAtPrima'`,
        colonna: sql<string | null>`${leadEvents.metadata}->>'colonna'`,
    }).from(leadEvents).where(and(
        eq(leadEvents.companyId, FENICE),
        eq(leadEvents.eventType, 'REASSIGNED_ADMIN'),
        sql`${leadEvents.metadata}->>'reason' = ${MOTIVO}`,
    ))
    // L'ultimo spostamento di questo script per lead.
    const ultimo = new Map<string, (typeof ev)[number]>()
    for (const e of ev) {
        const p = ultimo.get(e.leadId)
        if (!p || p.timestamp < e.timestamp) ultimo.set(e.leadId, e)
    }
    console.log(`Spostamenti di ${MOTIVO} trovati: ${ultimo.size}.`)
    if (!process.argv.includes('--esegui-ripristino')) {
        console.log('Prova a vuoto del ripristino. Aggiungi --esegui-ripristino per scrivere.')
        return
    }
    const base = Date.now()
    const n = await db.transaction(async (tx) => {
        let k = 0
        let i = 0
        for (const e of ultimo.values()) {
            if (!e.a) continue
            const t = new Date(base + i++)
            const res = await tx.update(leads)
                .set({
                    assignedToId: e.da,
                    assignedAt: e.assignedAtPrima ? new Date(e.assignedAtPrima) : null,
                    updatedAt: t,
                    version: sql`${leads.version} + 1`,
                })
                .where(and(
                    eq(leads.id, e.leadId), eq(leads.companyId, FENICE), eq(leads.assignedToId, e.a),
                    inArray(leads.status, ['NEW', 'IN_PROGRESS']), isNull(leads.appointmentDate), isNull(leads.presentedAt),
                ))
                .returning({ id: leads.id })
            if (res.length === 0) continue
            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId: e.leadId,
                eventType: 'REASSIGNED_ADMIN',
                userId: null,
                timestamp: t,
                metadata: { reason: `${MOTIVO}_annullata`, fromAssigneeId: e.a, toAssigneeId: e.da, colonna: e.colonna },
                companyId: FENICE,
            })
            k++
        }
        return k
    })
    console.log(`Ripristinati: ${n} (gli altri sono già stati lavorati, fissati o spostati di nuovo e restano dove sono).`)
}

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
