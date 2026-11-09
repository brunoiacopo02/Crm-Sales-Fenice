// Regia dei lead (PO 09/11/2026): letture e scritture sul DB per
// /admin/diretta/regia-lead. Le regole sono in regia.ts (pure, testate).
// Non è un file "use server": non controlla il ruolo, lo fanno le action
// (regiaLeadActions.ts) e la pagina.
//
// Carico sul DB: la panoramica è UNA lettura aggregata dei lead aperti (indice
// leads_company_status_idx), una dei non assegnati, una delle chiamate di oggi
// e una dell'ultima chiamata per GDO, in cache 45 secondi (unstable_cache con
// tag: "Aggiorna ora" e ogni operazione la buttano). L'elenco dei lead di un
// GDO si legge solo quando lo si apre, al massimo 500 righe.
//
// Scritture: come gli script di scripts/diretta (ridistribuzione-*, accantona-*,
// assegna-bf-fermi-09-11, chiusura-doppioni-29-10), in una transazione con il
// lock consultivo della scorta per ogni GDO coinvolto e la rilettura FOR UPDATE:
// un lead cambiato fra l'anteprima e la conferma si salta e si dice.
// Ogni operazione lascia una riga in "regiaOperazioni" con prima e dopo dei
// campi toccati, da cui si annulla.

import crypto from 'node:crypto'
import { unstable_cache } from 'next/cache'
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { callLogs, leadEvents, leads, regiaOperazioni, users } from '@/db/schema'
import { dayBoundsRome } from '@/lib/dateUtils'
import { nonToltoAlBotSql } from '@/lib/toltiAlBot'
import { personName } from './config'
import {
    APERTI, CAMPI_APPUNTAMENTO, CAMPI_DATA, CAMPI_GDO, CAMPI_LEAD, MASSIMO_AL_BOT, MASSIMO_PER_OPERAZIONE,
    annullabile, fotografa, motivoEsclusione, ripartisci, ripristino, tettoValido,
    type FiltriLead, type Fotografia, type LeadControllo, type Valore,
} from './regia'

export const FENICE = 'fenice'
export const TAG_REGIA = 'regia-lead'
const CACHE_SECONDI = 45
/** Chiave della riga "senza assegnatario" (sorgente virtuale). */
export const NESSUNO = 'nessuno'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const BF_SQL = sql`upper(btrim(coalesce("leads"."funnel", ''))) = 'BLACK FRIDAY'`
const RIDATO_SQL = sql`exists (select 1 from "leadEvents" rf where rf."leadId" = "leads"."id" and rf."eventType" = 'REASSIGNED_FROM_BOT')`
const VERGINE_SQL = sql`("leads"."status" = 'NEW' and "leads"."callCount" = 0 and "leads"."source" = 'activecampaign' and "leads"."launchBucket" is null
    and not exists (select 1 from "leadEvents" vb where vb."leadId" = "leads"."id" and vb."eventType" in ('REASSIGNED_FROM_BOT', 'BOT_PUSHED'))
    and not exists (select 1 from "botContactRequests" vc where vc."leadId" = "leads"."id" and vc."status" <> 'closed'))`

// ── Persone ──────────────────────────────────────────────────────────────

export interface PersonaRegia {
    id: string
    nome: string
    codice: number | null
    isBot: boolean
    isActive: boolean
    acAutoIntake: boolean
    botReturnIntake: boolean
    freshOverflowScorta: boolean
    dailyFreshCap: number | null
    scortaAttiva: boolean
}

/** GDO veri di Fenice (attivi e no) e il bot. L'account di prova resta fuori. */
export async function leggiPersone(ex: typeof db | Tx = db): Promise<PersonaRegia[]> {
    const righe = await ex.select({
        id: users.id, firstName: users.firstName, displayName: users.displayName, name: users.name, gdoCode: users.gdoCode,
        isBot: users.isBot, isActive: users.isActive, acAutoIntake: users.acAutoIntake, botReturnIntake: users.botReturnIntake,
        freshOverflowScorta: users.freshOverflowScorta, dailyFreshCap: users.dailyFreshCap, scortaAttiva: users.scortaAttiva,
    }).from(users).where(and(eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isTest, false)))
    return righe.map(r => ({
        id: r.id,
        nome: r.isBot ? `Bot ${r.gdoCode ?? ''}`.trim() : (personName(r) || `GDO ${r.gdoCode ?? '?'}`),
        codice: r.gdoCode,
        isBot: r.isBot,
        isActive: r.isActive,
        acAutoIntake: r.acAutoIntake,
        botReturnIntake: r.botReturnIntake,
        freshOverflowScorta: r.freshOverflowScorta,
        dailyFreshCap: r.dailyFreshCap,
        scortaAttiva: r.scortaAttiva,
    })).sort((a, b) => (a.codice ?? 9999) - (b.codice ?? 9999))
}

// ── Panoramica ───────────────────────────────────────────────────────────

export interface ContiLead {
    aperti: number
    prime: number
    primeVisibili: number
    primeScorta: number
    t1: number
    t2: number
    richiamiOggi: number
    richiamiScaduti: number
    bfAperti: number
    bfMaiChiamati: number
}

export interface RigaPanoramica extends ContiLead {
    chiave: string
    tipo: 'gdo' | 'bot' | 'nessuno'
    persona: PersonaRegia | null
    chiamateOggi: number
    chiamatiOggi: number
    fissatiOggi: number
    ultimaChiamata: string | null
}

export interface PanoramicaRegia {
    calcolatoAlle: string
    righe: RigaPanoramica[]
    funnel: { funnel: string; n: number }[]
}

const zero = (): ContiLead => ({ aperti: 0, prime: 0, primeVisibili: 0, primeScorta: 0, t1: 0, t2: 0, richiamiOggi: 0, richiamiScaduti: 0, bfAperti: 0, bfMaiChiamati: 0 })

function contiSql(inizio: Date, fine: Date, ora: Date) {
    return {
        aperti: sql<number>`count(*)::int`,
        prime: sql<number>`(count(*) filter (where "leads"."callCount" = 0 and "leads"."recallDate" is null))::int`,
        primeScorta: sql<number>`(count(*) filter (where "leads"."callCount" = 0 and "leads"."recallDate" is null and "leads"."scortaStato" = 'scorta' and not ${BF_SQL}))::int`,
        t1: sql<number>`(count(*) filter (where "leads"."callCount" = 1))::int`,
        t2: sql<number>`(count(*) filter (where "leads"."callCount" >= 2))::int`,
        richiamiOggi: sql<number>`(count(*) filter (where "leads"."recallDate" >= ${inizio} and "leads"."recallDate" < ${fine}))::int`,
        richiamiScaduti: sql<number>`(count(*) filter (where "leads"."recallDate" < ${ora}))::int`,
        bfAperti: sql<number>`(count(*) filter (where ${BF_SQL}))::int`,
        bfMaiChiamati: sql<number>`(count(*) filter (where ${BF_SQL} and "leads"."callCount" = 0))::int`,
    }
}

const daConti = (r: Omit<ContiLead, 'primeVisibili'> | undefined): ContiLead =>
    r ? { ...r, primeVisibili: r.prime - r.primeScorta } : zero()

export async function calcolaPanoramica(giornoInizio: string): Promise<PanoramicaRegia> {
    const ora = new Date()
    const inizio = new Date(giornoInizio)
    const { end: fine } = dayBoundsRome(ora)
    const persone = await leggiPersone()
    const ids = persone.map(p => p.id)
    const conti = contiSql(inizio, fine, ora)
    const base = and(eq(leads.companyId, FENICE), inArray(leads.status, [...APERTI]), eq(leads.isTest, false))

    const [perTitolare, senza, chiamate, ultime, funnel] = await Promise.all([
        db.select({ chiave: leads.assignedToId, ...conti }).from(leads)
            .where(and(base, sql`"leads"."assignedToId" is not null`)).groupBy(leads.assignedToId),
        db.select(conti).from(leads).where(and(base, isNull(leads.assignedToId), nonToltoAlBotSql())),
        ids.length === 0 ? [] : db.select({
            userId: callLogs.userId,
            chiamate: sql<number>`count(*)::int`,
            chiamati: sql<number>`count(distinct ${callLogs.leadId})::int`,
            fissati: sql<number>`(count(distinct ${callLogs.leadId}) filter (where ${callLogs.outcome} = 'APPUNTAMENTO'))::int`,
        }).from(callLogs).where(and(inArray(callLogs.userId, ids), gte(callLogs.createdAt, inizio))).groupBy(callLogs.userId),
        ids.length === 0 ? [] : db.select({ userId: callLogs.userId, ultima: sql<string>`max(${callLogs.createdAt})` })
            .from(callLogs).where(and(inArray(callLogs.userId, ids), gte(callLogs.createdAt, new Date(ora.getTime() - 30 * 86_400_000))))
            .groupBy(callLogs.userId),
        db.select({ funnel: leads.funnel, n: sql<number>`count(*)::int` }).from(leads).where(base).groupBy(leads.funnel),
    ])

    const perChiave = new Map(perTitolare.map(r => [r.chiave!, r]))
    const chiamateDi = new Map(chiamate.map(r => [r.userId!, r]))
    const ultimaDi = new Map(ultime.map(r => [r.userId!, r.ultima]))
    const righe: RigaPanoramica[] = []
    for (const p of persone) {
        const c = perChiave.get(p.id)
        // Gli spenti compaiono solo se hanno ancora lead aperti addosso.
        if (!p.isActive && !c) continue
        const ch = chiamateDi.get(p.id)
        const ultima = ultimaDi.get(p.id)
        righe.push({
            chiave: p.id, tipo: p.isBot ? 'bot' : 'gdo', persona: p, ...daConti(c),
            chiamateOggi: ch?.chiamate ?? 0, chiamatiOggi: ch?.chiamati ?? 0, fissatiOggi: ch?.fissati ?? 0,
            ultimaChiamata: ultima ? new Date(ultima).toISOString() : null,
        })
    }
    righe.push({ chiave: NESSUNO, tipo: 'nessuno', persona: null, ...daConti(senza[0]), chiamateOggi: 0, chiamatiOggi: 0, fissatiOggi: 0, ultimaChiamata: null })
    return {
        calcolatoAlle: ora.toISOString(),
        righe,
        funnel: funnel.map(f => ({ funnel: f.funnel ?? '', n: f.n })).filter(f => f.funnel).sort((a, b) => b.n - a.n),
    }
}

const panoramicaInCache = unstable_cache(calcolaPanoramica, ['regia-lead-panoramica-v1'], { revalidate: CACHE_SECONDI, tags: [TAG_REGIA] })

/** Panoramica per GDO, in cache 45 secondi (chiave: il giorno di Roma). */
export function leggiPanoramica(): Promise<PanoramicaRegia> {
    return panoramicaInCache(dayBoundsRome(new Date()).start.toISOString())
}

// ── Elenco lead di una sorgente ──────────────────────────────────────────

/** Sorgente: id di un GDO o del bot, oppure NESSUNO (lead aperti senza assegnatario, tranne i tolti per decisione PO). */
function condizioneSorgente(sorgente: string): SQL {
    return sorgente === NESSUNO ? and(isNull(leads.assignedToId), nonToltoAlBotSql())! : eq(leads.assignedToId, sorgente)
}

function condizioniFiltri(f: FiltriLead, ora: Date): SQL[] {
    const c: SQL[] = []
    if (f.funnel) c.push(eq(leads.funnel, f.funnel))
    if (f.tentativi === '0') c.push(eq(leads.callCount, 0))
    if (f.tentativi === '1') c.push(eq(leads.callCount, 1))
    if (f.tentativi === '2+') c.push(sql`"leads"."callCount" >= 2`)
    if (f.bf === 'si') c.push(BF_SQL)
    if (f.bf === 'no') c.push(sql`not ${BF_SQL}`)
    if (f.provenienza === 'ridati') c.push(RIDATO_SQL)
    if (f.provenienza === 'vergini') c.push(VERGINE_SQL)
    if (f.provenienza === 'altri') c.push(sql`not ${RIDATO_SQL} and not ${VERGINE_SQL}`)
    if (f.richiamo === 'con') c.push(sql`"leads"."recallDate" is not null`)
    if (f.richiamo === 'senza') c.push(isNull(leads.recallDate))
    if (f.richiamo === 'scaduti') c.push(lt(leads.recallDate, ora))
    if (f.etaMin !== null) c.push(sql`"leads"."createdAt" <= ${new Date(ora.getTime() - f.etaMin * 86_400_000)}`)
    if (f.etaMax !== null) c.push(sql`"leads"."createdAt" > ${new Date(ora.getTime() - (f.etaMax + 1) * 86_400_000)}`)
    return c
}

const COLONNE_CONTROLLO = {
    id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel, source: leads.source,
    assignedToId: leads.assignedToId, status: leads.status, callCount: leads.callCount,
    appointmentDate: leads.appointmentDate, presentedAt: leads.presentedAt,
    confirmationsUserId: leads.confirmationsUserId, confirmationsOutcome: leads.confirmationsOutcome, confCall1At: leads.confCall1At,
    isTest: leads.isTest, lastCallDate: leads.lastCallDate, updatedAt: leads.updatedAt,
    launchBucket: leads.launchBucket, lancioPool: leads.lancioPool, humanTestCohort: leads.humanTestCohort, lancioIngresso: leads.lancioIngresso,
    recallDate: leads.recallDate, recallNote: leads.recallNote, recallMissedAt: leads.recallMissedAt, assignedAt: leads.assignedAt,
    scortaStato: leads.scortaStato, scortaDal: leads.scortaDal, discardReason: leads.discardReason, createdAt: leads.createdAt,
    ultimoEventoDelTitolare: sql<string | null>`(select max(te."timestamp") from "leadEvents" te where te."leadId" = "leads"."id"
        and te."userId" = "leads"."assignedToId" and te."timestamp" > now() - interval '2 hours')`,
}

type RigaDb = Awaited<ReturnType<typeof leggiRighe>>[number]

async function leggiRighe(ex: typeof db | Tx, dove: SQL, limite: number, perAggiornare = false) {
    const q = ex.select(COLONNE_CONTROLLO).from(leads).where(dove).orderBy(desc(leads.createdAt), asc(leads.id)).limit(limite)
    return perAggiornare ? q.for('update', { of: leads }) : q
}

const controllo = (r: RigaDb): LeadControllo => ({
    ...r,
    ultimoEventoDelTitolare: r.ultimoEventoDelTitolare ? new Date(r.ultimoEventoDelTitolare) : null,
})

export interface RigaLeadRegia {
    id: string
    nome: string
    telefono: string
    funnel: string | null
    status: string
    tentativi: number
    richiamo: string | null
    entrato: string
    ultimaChiamata: string | null
    scorta: string | null
    bf: boolean
    ridato: boolean
    vergine: boolean
    /** Perché adesso non si sposterebbe (null = si sposta). */
    bloccato: string | null
}

export interface ElencoRegia {
    totale: number
    righe: RigaLeadRegia[]
    limite: number
}

const LIMITE_ELENCO = 500

/** I lead aperti della sorgente che passano i filtri: totale e primi 500 dal più recente. */
export async function leggiElenco(sorgente: string, f: FiltriLead, persone: PersonaRegia[]): Promise<ElencoRegia> {
    const ora = new Date()
    const dove = and(eq(leads.companyId, FENICE), inArray(leads.status, [...APERTI]), eq(leads.isTest, false), condizioneSorgente(sorgente), ...condizioniFiltri(f, ora))!
    const [conto, righe] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(leads).where(dove),
        db.select({
            ...COLONNE_CONTROLLO,
            bf: sql<boolean>`${BF_SQL}`,
            ridato: sql<boolean>`${RIDATO_SQL}`,
            vergine: sql<boolean>`${VERGINE_SQL}`,
        }).from(leads).where(dove).orderBy(desc(leads.createdAt), asc(leads.id)).limit(LIMITE_ELENCO),
    ])
    const umano = persone.some(p => p.id === sorgente && !p.isBot)
    const mittenteId = sorgente === NESSUNO ? null : sorgente
    return {
        totale: conto[0]?.n ?? 0,
        limite: LIMITE_ELENCO,
        righe: righe.map(r => ({
            id: r.id,
            nome: r.name,
            telefono: r.phone,
            funnel: r.funnel,
            status: r.status,
            tentativi: r.callCount,
            richiamo: r.recallDate?.toISOString() ?? null,
            entrato: r.createdAt.toISOString(),
            ultimaChiamata: r.lastCallDate?.toISOString() ?? null,
            scorta: r.scortaStato,
            bf: !!r.bf,
            ridato: !!r.ridato,
            vergine: !!r.vergine,
            bloccato: motivoEsclusione(controllo(r), { mittenteId, titolareUmano: umano, ora }),
        })),
    }
}

// ── Piano di un'operazione di massa ──────────────────────────────────────

export type TipoMassa = 'sposta' | 'al_bot' | 'accantona' | 'cima'
export type Posizione = 'cima' | 'scorta'

export interface RichiestaMassa {
    tipo: TipoMassa
    sorgente: string
    /** Selezione a mano (ids) oppure i primi N che passano i filtri. */
    ids: string[] | null
    filtri: FiltriLead | null
    quanti: number | null
    destinatari: string[]
    posizione: Posizione
    motivo: string
    /** Dai al bot anche chi il bot ha già contattato (seconda apertura WhatsApp alla stessa persona). */
    ancheGiaContattati: boolean
}

export interface VocePiano { id: string; nome: string; a: string | null }
export interface VoceEsclusa { id: string; nome: string; motivo: string }

export interface PianoMassa {
    tipo: TipoMassa
    sorgente: string
    sorgenteNome: string
    inclusi: VocePiano[]
    esclusi: VoceEsclusa[]
    perDestinatario: { id: string | null; nome: string; quanti: number }[]
    avvisi: string[]
}

export class ErroreRegia extends Error {}

function nomeSorgente(sorgente: string, persone: PersonaRegia[]): string {
    if (sorgente === NESSUNO) return 'Senza assegnatario'
    const p = persone.find(x => x.id === sorgente)
    return p ? `${p.nome}${p.codice && !p.isBot ? ` (${p.codice})` : ''}` : 'sconosciuto'
}

/** Il bot (GDO 201): unico account isBot attivo di Fenice. */
function botDi(persone: PersonaRegia[]): PersonaRegia | null {
    return persone.find(p => p.isBot && p.isActive) ?? null
}

/** Chi della selezione il bot ha già contattato: stesso telefono con push, restituzione o note del bot. */
async function giaContattatiDalBot(ex: typeof db | Tx, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const r = await ex.select({ id: leads.id }).from(leads).where(and(inArray(leads.id, ids), sql`exists (
        select 1 from leads al join "leadEvents" ae on ae."leadId" = al.id
        where al.phone = "leads"."phone" and ae."eventType" in ('BOT_PUSHED', 'REASSIGNED_FROM_BOT', 'BOT_CALL_ATTEMPT', 'BOT_NOTE', 'BOT_REPORT'))`))
    return new Set(r.map(x => x.id))
}

/**
 * Il piano: quali lead, dove vanno, chi resta fuori e perché. Si calcola per
 * l'anteprima e di nuovo, sotto lock, alla conferma (eseguiMassa): quello che
 * è cambiato in mezzo si salta.
 */
export async function pianificaMassa(r: RichiestaMassa, persone: PersonaRegia[], ex: typeof db | Tx = db, perAggiornare = false): Promise<{ piano: PianoMassa; righe: Map<string, RigaDb> }> {
    const ora = new Date()
    const bot = botDi(persone)
    const sorgentePersona = persone.find(p => p.id === r.sorgente) ?? null
    if (r.sorgente !== NESSUNO && !sorgentePersona) throw new ErroreRegia('Sorgente sconosciuta.')
    const umano = !!sorgentePersona && !sorgentePersona.isBot
    const mittenteId = r.sorgente === NESSUNO ? null : r.sorgente
    const avvisi: string[] = []

    // Destinatari ammessi per tipo.
    let destinatari: string[] = []
    if (r.tipo === 'sposta') {
        destinatari = [...new Set(r.destinatari)].filter(id => persone.some(p => p.id === id && p.isActive && !p.isBot))
        if (destinatari.length !== new Set(r.destinatari).size) throw new ErroreRegia('Fra i destinatari c\'è un GDO spento o non valido.')
        if (destinatari.includes(r.sorgente)) throw new ErroreRegia('Chi ha i lead non può essere anche destinatario.')
        if (destinatari.length === 0) throw new ErroreRegia('Scegli almeno un GDO a cui darli.')
    } else if (r.tipo === 'al_bot') {
        if (!bot) throw new ErroreRegia('Account del bot non trovato o spento.')
        if (sorgentePersona?.isBot) throw new ErroreRegia('Questi lead sono già del bot.')
    } else if (r.tipo === 'accantona') {
        if (r.sorgente === NESSUNO) throw new ErroreRegia('Questi lead sono già senza assegnatario.')
        if (r.motivo.trim().length < 3) throw new ErroreRegia('Scrivi il motivo dell\'accantonamento.')
    } else if (r.tipo === 'cima') {
        if (!umano) throw new ErroreRegia('"In cima" vale solo per i lead di un GDO.')
    }

    const base = and(eq(leads.companyId, FENICE), eq(leads.isTest, false))!
    let righe: RigaDb[]
    let quanti: number
    if (r.ids && r.ids.length > 0) {
        const ids = [...new Set(r.ids)].slice(0, MASSIMO_PER_OPERAZIONE)
        righe = await leggiRighe(ex, and(base, inArray(leads.id, ids))!, ids.length, perAggiornare)
        quanti = ids.length
    } else if (r.filtri && r.quanti && r.quanti > 0) {
        quanti = Math.min(r.quanti, MASSIMO_PER_OPERAZIONE)
        righe = await leggiRighe(ex, and(base, inArray(leads.status, [...APERTI]), condizioneSorgente(r.sorgente), ...condizioniFiltri(r.filtri, ora))!, MASSIMO_PER_OPERAZIONE, perAggiornare)
    } else {
        throw new ErroreRegia('Scegli i lead: a mano dall\'elenco oppure quanti con i filtri.')
    }
    if (r.tipo === 'al_bot') quanti = Math.min(quanti, MASSIMO_AL_BOT)

    const gia = r.tipo === 'al_bot' && !r.ancheGiaContattati ? await giaContattatiDalBot(ex, righe.map(x => x.id)) : new Set<string>()
    const buoni: RigaDb[] = []
    const esclusi: VoceEsclusa[] = []
    for (const l of righe) {
        let motivo = r.tipo === 'cima'
            // In cima non toglie il lead a nessuno: basta che sia ancora suo e aperto.
            ? motivoEsclusione(controllo(l), { mittenteId, titolareUmano: false, ora })
            : motivoEsclusione(controllo(l), { mittenteId, titolareUmano: umano, ora })
        if (!motivo && r.tipo === 'cima' && (l.callCount !== 0 || l.recallDate)) motivo = 'non è in prima chiamata'
        if (!motivo && gia.has(l.id)) motivo = 'il bot ha già scritto a questa persona'
        if (!motivo && r.tipo === 'al_bot' && !l.phone?.trim()) motivo = 'senza telefono'
        if (motivo) esclusi.push({ id: l.id, nome: l.name, motivo })
        else if (buoni.length < quanti) buoni.push(l)
    }
    if (r.ids) for (const id of new Set(r.ids)) if (!righe.some(x => x.id === id)) esclusi.push({ id, nome: '(non trovato)', motivo: 'lead non trovato' })

    let inclusi: VocePiano[]
    if (r.tipo === 'sposta') {
        const giro = ripartisci(buoni.map(b => b.id), destinatari)
        const nomi = new Map(buoni.map(b => [b.id, b.name]))
        inclusi = giro.map(g => ({ id: g.id, nome: nomi.get(g.id) ?? '', a: g.a }))
    } else {
        const a = r.tipo === 'al_bot' ? bot!.id : r.tipo === 'cima' ? r.sorgente : null
        inclusi = buoni.map(b => ({ id: b.id, nome: b.name, a }))
    }

    const conteggio = new Map<string | null, number>()
    for (const v of inclusi) conteggio.set(v.a, (conteggio.get(v.a) ?? 0) + 1)
    const nomeDi = (id: string | null) => (id === null ? 'Senza assegnatario (lead accantonati)' : nomeSorgente(id, persone))
    if (r.tipo === 'al_bot') avvisi.push(`Il bot scriverà su WhatsApp a ${inclusi.length} persone, a 30 al minuto: questo non si può annullare. L'annulla riporta solo il lead a chi lo aveva.`)
    if (r.tipo === 'al_bot' && r.ancheGiaContattati) avvisi.push('Hai incluso anche chi il bot ha già contattato: per loro è una seconda apertura WhatsApp.')
    if (r.tipo === 'sposta' && sorgentePersona?.isBot) avvisi.push('Tolti al bot: ripartono come nuovi (0 tentativi, senza richiamo), come quando il bot li restituisce. Al lead non parte nessun messaggio.')
    if (r.tipo === 'sposta') {
        const spentaScorta = destinatari.filter(d => !persone.find(p => p.id === d)?.scortaAttiva)
        if (r.posizione === 'scorta' && spentaScorta.length) avvisi.push(`${spentaScorta.map(nomeDi).join(', ')}: scorta spenta, li vede comunque tutti.`)
    }
    if (r.tipo === 'cima') avvisi.push('In cima alla prima chiamata, sopra i lead usciti dalla scorta. Black Friday, vergini, stelle e "Ti ha cercato" restano comunque sopra.')

    return {
        piano: {
            tipo: r.tipo, sorgente: r.sorgente, sorgenteNome: nomeSorgente(r.sorgente, persone),
            inclusi, esclusi,
            perDestinatario: [...conteggio].map(([id, n]) => ({ id, nome: nomeDi(id), quanti: n })),
            avvisi,
        },
        righe: new Map(righe.map(x => [x.id, x])),
    }
}

// ── Scrittura ────────────────────────────────────────────────────────────

/** Lock consultivo della scorta di ogni GDO coinvolto, in ordine fisso (niente stalli fra due operazioni). */
async function lockScorta(tx: Tx, userIds: (string | null)[]) {
    for (const id of [...new Set(userIds.filter((x): x is string => !!x))].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'scorta:' + id}))`)
    }
}

export interface VoceLog { id: string; nome: string; prima: Fotografia; dopo: Fotografia }
interface DettaglioOperazione {
    lead: VoceLog[]
    gdo: VoceLog[]
    extra: Record<string, unknown>
}

async function registraOperazione(tx: Tx, adminId: string, tipo: string, descrizione: string, d: DettaglioOperazione): Promise<string> {
    const id = crypto.randomUUID()
    await tx.insert(regiaOperazioni).values({
        id, companyId: FENICE, adminId, tipo, descrizione, quanti: d.lead.length || d.gdo.length, dettaglio: d,
    })
    return id
}

/** Scrive scortaStato/scortaDal a parte: nello stesso UPDATE dell'assegnatario il trigger leads_scorta_reset li azzererebbe se uguali a prima. */
async function scriviScorta(tx: Tx, id: string, stato: string | null, dal: Date | null) {
    await tx.update(leads).set({ scortaStato: stato, scortaDal: dal }).where(eq(leads.id, id))
}

export interface EsitoMassa {
    operazioneId: string | null
    fatti: number
    saltati: VoceEsclusa[]
    push?: { inviati: number; esiti: Record<string, number>; restanti: number }
}

/**
 * Esegue il piano confermato. Rilegge e ricontrolla tutto sotto lock: entra
 * solo chi era nell'anteprima, con lo stesso destinatario, ed è ancora
 * spostabile. Il push al bot (al_bot) parte dopo la transazione, come il giro
 * di riscaldamento: se un push fallisce il lead resta del bot.
 */
export async function eseguiMassa(r: RichiestaMassa, confermati: VocePiano[], adminId: string, persone: PersonaRegia[]): Promise<EsitoMassa> {
    if (confermati.length === 0) throw new ErroreRegia('Niente da fare: nessun lead nell\'anteprima.')
    const voluto = new Map(confermati.map(v => [v.id, v.a]))
    const bot = botDi(persone)
    const ora = new Date()

    const risultato = await db.transaction(async (tx) => {
        await lockScorta(tx, [r.sorgente === NESSUNO ? null : r.sorgente, ...confermati.map(v => v.a)])
        const { piano, righe } = await pianificaMassa({ ...r, ids: [...voluto.keys()], filtri: null, quanti: null }, persone, tx, true)
        const saltati: VoceEsclusa[] = [...piano.esclusi]
        const log: VoceLog[] = []
        let i = 0
        for (const v of piano.inclusi) {
            const l = righe.get(v.id)!
            // Il giro a turno si ricalcola sui soli confermati: vale il destinatario dell'anteprima.
            const a = r.tipo === 'sposta' ? voluto.get(v.id) ?? null : v.a
            if (r.tipo === 'sposta' && (!a || !r.destinatari.includes(a))) { saltati.push({ id: v.id, nome: v.nome, motivo: 'destinatario cambiato' }); continue }
            const prima = fotografa(l, CAMPI_LEAD)
            const ts = new Date(ora.getTime() + i++)
            let dopo: Fotografia
            if (r.tipo === 'sposta' && l.assignedToId && l.assignedToId === bot?.id) {
                // Tolto al bot verso un GDO: come la restituzione del bot (reassign.ts) e assegna-bf-fermi-09-11.
                await tx.update(leads).set({
                    assignedToId: a, assignedAt: sql`COALESCE(${leads.assignedAt}, ${ts})`, status: 'NEW', callCount: 0,
                    recallDate: null, recallNote: null, recallMissedAt: null, updatedAt: ts, version: sql`${leads.version} + 1`,
                }).where(eq(leads.id, l.id))
                const stato = r.posizione === 'cima' ? 'visibile' : 'scorta'
                await scriviScorta(tx, l.id, stato, stato === 'scorta' ? ts : null)
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: l.id, eventType: 'REASSIGNED_FROM_BOT', userId: a, timestamp: ts, companyId: FENICE,
                    metadata: { reason: 'regia_admin', motivo: 'regia_lead', botNote: null, fromBot: l.assignedToId, toGdo: a, toAssigneeId: a, fromAssigneeId: l.assignedToId, posizione: r.posizione, adminId },
                })
                dopo = { assignedToId: a, status: 'NEW', callCount: 0, recallDate: null, recallNote: null, recallMissedAt: null, scortaStato: stato, scortaDal: stato === 'scorta' ? ts.toISOString() : null, assignedAt: l.assignedAt?.toISOString() ?? ts.toISOString() }
            } else if (r.tipo === 'sposta') {
                // Fra GDO o dai senza assegnatario: come ridistribuzione-*. updatedAt intatto.
                await tx.update(leads).set({ assignedToId: a, assignedAt: sql`COALESCE(${leads.assignedAt}, ${ts})`, version: sql`${leads.version} + 1` }).where(eq(leads.id, l.id))
                const stato = r.posizione === 'cima' ? 'visibile' : 'scorta'
                await scriviScorta(tx, l.id, stato, stato === 'scorta' ? ts : null)
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: l.id, eventType: 'REASSIGNED_ADMIN', userId: adminId, timestamp: ts, companyId: FENICE,
                    metadata: { reason: 'regia_lead', fromAssigneeId: l.assignedToId, toAssigneeId: a, posizione: r.posizione },
                })
                dopo = { assignedToId: a, scortaStato: stato, scortaDal: stato === 'scorta' ? ts.toISOString() : null, assignedAt: l.assignedAt?.toISOString() ?? ts.toISOString() }
            } else if (r.tipo === 'al_bot') {
                // Come il giro di riscaldamento (cron bot-warmup): assegnato al bot, evento ASSIGNED, poi il push.
                await tx.update(leads).set({ assignedToId: bot!.id, assignedAt: sql`COALESCE(${leads.assignedAt}, ${ts})`, updatedAt: ts, version: sql`${leads.version} + 1` }).where(eq(leads.id, l.id))
                await scriviScorta(tx, l.id, null, null)
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: l.id, eventType: 'ASSIGNED', userId: bot!.id, timestamp: ts, companyId: FENICE,
                    metadata: { via: 'regia_lead', da: l.assignedToId, a: bot!.id, assignedToUser: bot!.id, adminId },
                })
                dopo = { assignedToId: bot!.id, scortaStato: null, scortaDal: null, assignedAt: l.assignedAt?.toISOString() ?? ts.toISOString() }
            } else if (r.tipo === 'accantona') {
                // Come accantona-ridati-oltre-8gg-06-11: nel pool "Lead accantonati" di /import. updatedAt intatto.
                await tx.update(leads).set({ assignedToId: null, version: sql`${leads.version} + 1` }).where(eq(leads.id, l.id))
                await scriviScorta(tx, l.id, null, null)
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: l.id, eventType: 'RIDATO_PARCHEGGIATO', userId: adminId, timestamp: ts, companyId: FENICE,
                    metadata: { motivo: 'regia_lead', nota: r.motivo.trim().slice(0, 300), tolto_a: l.assignedToId, recallDate: l.recallDate?.toISOString() ?? null, adminId },
                })
                dopo = { assignedToId: null, scortaStato: null, scortaDal: null }
            } else {
                // In cima: solo la scorta, il lead resta suo. Niente assegnatario, stato, tentativi o updatedAt.
                await scriviScorta(tx, l.id, 'visibile', null)
                await tx.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: l.id, eventType: 'REGIA_IN_CIMA', userId: adminId, timestamp: ts, companyId: FENICE,
                    metadata: { reason: 'regia_lead', gdo: l.assignedToId, scortaPrima: l.scortaStato },
                })
                dopo = { scortaStato: 'visibile', scortaDal: null }
            }
            log.push({ id: l.id, nome: l.name, prima: soloChiavi(prima, dopo), dopo: { ...dopo, ...guardia(l, dopo) } })
        }
        if (log.length === 0) return { operazioneId: null, fatti: 0, saltati }
        const descrizione = descriviMassa(r, log.length, persone, piano.perDestinatario)
        const operazioneId = await registraOperazione(tx, adminId, r.tipo, descrizione, {
            lead: log, gdo: [],
            extra: { sorgente: r.sorgente, destinatari: r.destinatari, posizione: r.posizione, motivo: r.motivo || null, saltati },
        })
        return { operazioneId, fatti: log.length, saltati }
    })

    if (r.tipo === 'al_bot' && risultato.operazioneId && risultato.fatti > 0) {
        const push = await spingiAlBot(confermati.map(v => v.id), risultato.operazioneId, bot!.id)
        return { ...risultato, push }
    }
    return risultato
}

/** I campi di `prima` che l'operazione ha toccato. */
function soloChiavi(prima: Fotografia, dopo: Fotografia): Fotografia {
    const out: Fotografia = {}
    for (const k of Object.keys(dopo)) out[k] = prima[k] ?? null
    // stato e tentativi servono sempre alla guardia dell'annulla
    for (const k of ['status', 'callCount', 'assignedToId']) if (!(k in out)) out[k] = prima[k] ?? null
    return out
}

/** Valori di guardia che l'operazione non ha cambiato: l'annulla controlla che siano ancora quelli. */
function guardia(l: RigaDb, dopo: Fotografia): Fotografia {
    const g: Fotografia = {}
    if (!('status' in dopo)) g.status = l.status
    if (!('callCount' in dopo)) g.callCount = l.callCount
    if (!('assignedToId' in dopo)) g.assignedToId = l.assignedToId
    return g
}

function descriviMassa(r: RichiestaMassa, n: number, persone: PersonaRegia[], per: { nome: string; quanti: number }[]): string {
    const da = nomeSorgente(r.sorgente, persone)
    const dove = per.map(p => `${p.nome} ${p.quanti}`).join(', ')
    switch (r.tipo) {
        case 'sposta': return `Spostati ${n} lead da ${da} a ${dove} (${r.posizione === 'cima' ? 'in cima' : 'in scorta'})`
        case 'al_bot': return `Dati al bot ${n} lead di ${da}`
        case 'accantona': return `Accantonati ${n} lead di ${da}: ${r.motivo.trim()}`
        case 'cima': return `Messi in cima ${n} lead di ${da}`
    }
}

/** Push al bot dei lead appena assegnati (stesso percorso di /api/admin/bot-push-leads: pushLeadsToBotPaced, 30/min). */
async function spingiAlBot(ids: string[], operazioneId: string, botId: string) {
    const { pushLeadsToBotPaced } = await import('@/lib/bot-fissatore/push')
    const { lancioFieldForLead } = await import('@/lib/lancio/intake')
    const candidati = await db.select({
        id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, funnel: leads.funnel,
        launchBucket: leads.launchBucket, lancioIngresso: leads.lancioIngresso,
    }).from(leads).where(and(inArray(leads.id, ids), eq(leads.assignedToId, botId), eq(leads.companyId, FENICE)))
    const { results, remaining } = await pushLeadsToBotPaced(candidati.map(c => ({
        leadId: c.id, name: c.name, phone: c.phone, email: c.email, funnel: c.funnel, companyId: FENICE,
        lancio: lancioFieldForLead(c),
    })), { budgetMs: 200_000 })
    const esiti: Record<string, number> = {}
    for (const x of results) esiti[x.result] = (esiti[x.result] ?? 0) + 1
    const push = { inviati: results.length, esiti, restanti: remaining.length }
    await db.update(regiaOperazioni)
        .set({ dettaglio: sql`jsonb_set(${regiaOperazioni.dettaglio}, '{extra,push}', ${JSON.stringify({ ...push, restantiIds: remaining })}::jsonb)` })
        .where(eq(regiaOperazioni.id, operazioneId))
    return push
}

// ── Operazioni sul singolo lead ──────────────────────────────────────────

export type TipoSingolo = 'scarta' | 'doppione' | 'togli_appuntamento'

export interface RichiestaSingolo {
    tipo: TipoSingolo
    leadId: string
    motivo: string
    /** doppione: il lead che si tiene. */
    tenutoId: string | null
}

export interface AnteprimaSingolo {
    leadId: string
    nome: string
    titolare: string
    stato: string
    appuntamento: string | null
    cosaSuccede: string
    bloccato: string | null
    tenuto: { id: string; nome: string; stato: string } | null
}

async function leggiUno(ex: typeof db | Tx, id: string, perAggiornare = false) {
    const [r] = await leggiRighe(ex, and(eq(leads.companyId, FENICE), eq(leads.id, id))!, 1, perAggiornare)
    return r ?? null
}

export async function anteprimaSingolo(r: RichiestaSingolo, persone: PersonaRegia[]): Promise<AnteprimaSingolo> {
    const l = await leggiUno(db, r.leadId)
    if (!l) throw new ErroreRegia('Lead non trovato.')
    const titolare = l.assignedToId ? nomeSorgente(l.assignedToId, persone) : 'Senza assegnatario'
    const umano = persone.some(p => p.id === l.assignedToId && !p.isBot)
    let bloccato: string | null = null
    let cosaSuccede = ''
    let tenuto: AnteprimaSingolo['tenuto'] = null
    const ora = new Date()
    if (r.tipo === 'togli_appuntamento') {
        if (!l.appointmentDate && l.status !== 'APPOINTMENT') bloccato = 'non ha un appuntamento'
        cosaSuccede = `L'appuntamento si toglie con conferma, venditore ed esito; il lead torna in pipeline a ${titolare} come ${l.callCount > 0 ? 'in lavorazione' : 'nuovo'}. Le monete del fissato tornano indietro (come l'annullamento admin di sempre).`
    } else {
        bloccato = motivoEsclusione(controllo(l), { mittenteId: l.assignedToId, titolareUmano: umano, ora })
        if (r.tipo === 'scarta') {
            if (r.motivo.trim().length < 3) bloccato = bloccato ?? 'scrivi il motivo dello scarto'
            cosaSuccede = `Il lead si chiude come scartato ("${r.motivo.trim()}"), esce dalla pipeline di ${titolare} e dal bot. Nessuna chiamata registrata: le statistiche del GDO non cambiano.`
        } else {
            if (!r.tenutoId) bloccato = bloccato ?? 'scegli il lead da tenere'
            else if (r.tenutoId === r.leadId) bloccato = bloccato ?? 'il lead da tenere è lo stesso'
            else {
                const t = await leggiUno(db, r.tenutoId)
                if (!t) bloccato = bloccato ?? 'il lead da tenere non esiste'
                else tenuto = { id: t.id, nome: t.name, stato: t.status }
            }
            cosaSuccede = `Il lead si chiude come doppione${tenuto ? ` di "${tenuto.nome}"` : ''}: esce dalla pipeline di ${titolare} e dal bot, non si cancella.`
        }
    }
    return {
        leadId: l.id, nome: l.name, titolare, stato: l.status, appuntamento: l.appointmentDate?.toISOString() ?? null,
        cosaSuccede, bloccato, tenuto,
    }
}

const scartoDi = (r: RichiestaSingolo, tenutoNome: string | null) =>
    r.tipo === 'doppione' ? `doppione - tenuto ${r.tenutoId!.slice(0, 8)}${tenutoNome ? ` (${tenutoNome})` : ''}`.slice(0, 200) : r.motivo.trim().slice(0, 200)

/** Scarta o chiudi come doppione: come chiusura-doppioni-29-10 (REJECTED, motivo, richiamo azzerato, nessuna callLog). */
export async function eseguiChiusura(r: RichiestaSingolo, adminId: string, persone: PersonaRegia[]): Promise<{ operazioneId: string }> {
    const a = await anteprimaSingolo(r, persone)
    if (a.bloccato) throw new ErroreRegia(`Non si può: ${a.bloccato}.`)
    return db.transaction(async (tx) => {
        const l = await leggiUno(tx, r.leadId, true)
        if (!l) throw new ErroreRegia('Lead non trovato.')
        await lockScorta(tx, [l.assignedToId])
        const umano = persone.some(p => p.id === l.assignedToId && !p.isBot)
        const ancora = motivoEsclusione(controllo(l), { mittenteId: l.assignedToId, titolareUmano: umano, ora: new Date() })
        if (ancora) throw new ErroreRegia(`Non si può più: ${ancora}.`)
        const prima = fotografa(l, CAMPI_LEAD)
        const t = new Date()
        const discardReason = scartoDi(r, a.tenuto?.nome ?? null)
        await tx.update(leads).set({
            status: 'REJECTED', discardReason, recallDate: null, recallNote: null, recallMissedAt: null,
            updatedAt: t, version: sql`${leads.version} + 1`,
        }).where(eq(leads.id, l.id))
        await tx.insert(leadEvents).values({
            id: crypto.randomUUID(), leadId: l.id, eventType: r.tipo === 'doppione' ? 'LEAD_CHIUSO_DOPPIONE' : 'LEAD_SCARTATO_ADMIN',
            userId: adminId, timestamp: t, companyId: FENICE,
            metadata: { reason: 'regia_lead', motivo: discardReason, tenuto: r.tenutoId, assignedToId: l.assignedToId, statoPrima: l.status },
        })
        const dopo: Fotografia = { status: 'REJECTED', discardReason, recallDate: null, recallNote: null, recallMissedAt: null, callCount: l.callCount, assignedToId: l.assignedToId }
        const operazioneId = await registraOperazione(tx, adminId, r.tipo,
            r.tipo === 'doppione' ? `Chiuso come doppione "${l.name}" (tenuto "${a.tenuto?.nome ?? ''}")` : `Scartato "${l.name}": ${discardReason}`,
            { lead: [{ id: l.id, nome: l.name, prima: soloChiavi(prima, dopo), dopo }], gdo: [], extra: { tenuto: r.tenutoId } })
        return { operazioneId }
    })
}

/** Fotografia dei campi dell'appuntamento (prima di togliere l'appuntamento). */
export async function fotografiaAppuntamento(leadId: string): Promise<{ nome: string; foto: Fotografia; assignedToId: string | null; callCount: number } | null> {
    const [l] = await db.select().from(leads).where(and(eq(leads.companyId, FENICE), eq(leads.id, leadId))).limit(1)
    if (!l) return null
    return { nome: l.name, foto: fotografa(l as unknown as Record<string, unknown>, CAMPI_APPUNTAMENTO), assignedToId: l.assignedToId, callCount: l.callCount }
}

export async function registraToltoAppuntamento(adminId: string, leadId: string, nome: string, prima: Fotografia, extra: { assignedToId: string | null; callCount: number }): Promise<string> {
    const dopo = await fotografiaAppuntamento(leadId)
    return db.transaction(async (tx) => registraOperazione(tx, adminId, 'togli_appuntamento', `Tolto l'appuntamento a "${nome}"`, {
        lead: [{ id: leadId, nome, prima: { ...prima, callCount: extra.callCount, assignedToId: extra.assignedToId }, dopo: { ...(dopo?.foto ?? {}), callCount: extra.callCount, assignedToId: extra.assignedToId } }],
        gdo: [], extra: {},
    }))
}

// ── Interruttori del GDO ─────────────────────────────────────────────────

export interface RichiestaInterruttori {
    userId: string
    isActive: boolean
    acAutoIntake: boolean
    botReturnIntake: boolean
    dailyFreshCap: number | null
}

export interface AnteprimaInterruttori {
    userId: string
    nome: string
    cambi: { campo: string; etichetta: string; prima: string; dopo: string }[]
    bloccato: string | null
}

const ETICHETTE_GDO: Record<string, string> = {
    isActive: 'Account attivo', acAutoIntake: 'Riceve freschi', botReturnIntake: 'Riceve ridati dal bot',
    freshOverflowScorta: 'Riceve l\'eccedenza dei freschi', dailyFreshCap: 'Tetto freschi al giorno',
}
const testo = (v: Valore) => (v === true ? 'sì' : v === false ? 'no' : v === null ? 'nessun tetto' : String(v))

function datiInterruttori(r: RichiestaInterruttori, p: PersonaRegia): Fotografia {
    // Spegnere l'account lo toglie da tutti i pool, come /gestione (setGdoActive).
    return r.isActive
        ? { isActive: true, acAutoIntake: r.acAutoIntake, botReturnIntake: r.botReturnIntake, freshOverflowScorta: p.freshOverflowScorta, dailyFreshCap: r.dailyFreshCap }
        : { isActive: false, acAutoIntake: false, botReturnIntake: false, freshOverflowScorta: false, dailyFreshCap: r.dailyFreshCap }
}

export async function anteprimaInterruttori(r: RichiestaInterruttori, persone: PersonaRegia[]): Promise<AnteprimaInterruttori> {
    const p = persone.find(x => x.id === r.userId && !x.isBot)
    if (!p) throw new ErroreRegia('GDO non trovato.')
    let bloccato: string | null = null
    if (!tettoValido(r.dailyFreshCap)) bloccato = 'il tetto deve essere un numero fra 0 e 1000, oppure vuoto'
    if (!r.isActive && p.isActive) {
        const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(leads)
            .where(and(eq(leads.companyId, FENICE), eq(leads.assignedToId, p.id), inArray(leads.status, [...APERTI])))
        if ((c?.n ?? 0) > 0) bloccato = `ha ancora ${c.n} lead aperti: spostali prima di spegnere l'account (per un'assenza basta spegnere freschi e ridati)`
    }
    const prima = fotografa(p as unknown as Record<string, unknown>, CAMPI_GDO)
    const dopo = datiInterruttori(r, p)
    const cambi = Object.keys(dopo).filter(k => prima[k] !== dopo[k])
        .map(k => ({ campo: k, etichetta: ETICHETTE_GDO[k] ?? k, prima: testo(prima[k]), dopo: testo(dopo[k]) }))
    return { userId: p.id, nome: `${p.nome}${p.codice ? ` (${p.codice})` : ''}`, cambi, bloccato }
}

export async function eseguiInterruttori(r: RichiestaInterruttori, adminId: string, persone: PersonaRegia[]): Promise<{ operazioneId: string | null }> {
    const a = await anteprimaInterruttori(r, persone)
    if (a.bloccato) throw new ErroreRegia(`Non si può: ${a.bloccato}.`)
    if (a.cambi.length === 0) return { operazioneId: null }
    const p = persone.find(x => x.id === r.userId)!
    return db.transaction(async (tx) => {
        const [att] = await leggiPersone(tx).then(l => l.filter(x => x.id === p.id))
        const prima = fotografa(att as unknown as Record<string, unknown>, CAMPI_GDO)
        const dopo = datiInterruttori(r, att)
        await tx.update(users).set({
            isActive: dopo.isActive as boolean, acAutoIntake: dopo.acAutoIntake as boolean, botReturnIntake: dopo.botReturnIntake as boolean,
            freshOverflowScorta: dopo.freshOverflowScorta as boolean, dailyFreshCap: dopo.dailyFreshCap as number | null,
        }).where(and(eq(users.id, p.id), eq(users.companyId, FENICE), eq(users.role, 'GDO')))
        const operazioneId = await registraOperazione(tx, adminId, 'interruttori',
            `${a.nome}: ${a.cambi.map(c => `${c.etichetta.toLowerCase()} ${c.prima} → ${c.dopo}`).join(', ')}`,
            { lead: [], gdo: [{ id: p.id, nome: a.nome, prima, dopo }], extra: {} })
        return { operazioneId }
    })
}

// ── Storico e annulla ────────────────────────────────────────────────────

export interface OperazioneStorico {
    id: string
    tipo: string
    descrizione: string
    quanti: number
    quando: string
    admin: string
    annullataAlle: string | null
    esitoAnnulla: { ripristinati: number; saltati: VoceEsclusa[] } | null
    push: { inviati: number; esiti: Record<string, number>; restanti: number } | null
}

export async function leggiStorico(limite = 30): Promise<OperazioneStorico[]> {
    const righe = await db.select({
        id: regiaOperazioni.id, tipo: regiaOperazioni.tipo, descrizione: regiaOperazioni.descrizione, quanti: regiaOperazioni.quanti,
        createdAt: regiaOperazioni.createdAt, annullataAt: regiaOperazioni.annullataAt, esitoAnnulla: regiaOperazioni.esitoAnnulla,
        push: sql<OperazioneStorico['push']>`${regiaOperazioni.dettaglio}->'extra'->'push'`,
        firstName: users.firstName, displayName: users.displayName, name: users.name,
    }).from(regiaOperazioni).leftJoin(users, eq(users.id, regiaOperazioni.adminId))
        .where(eq(regiaOperazioni.companyId, FENICE)).orderBy(desc(regiaOperazioni.createdAt)).limit(limite)
    return righe.map(r => ({
        id: r.id, tipo: r.tipo, descrizione: r.descrizione, quanti: r.quanti, quando: r.createdAt.toISOString(),
        admin: personName(r), annullataAlle: r.annullataAt?.toISOString() ?? null,
        esitoAnnulla: (r.esitoAnnulla as OperazioneStorico['esitoAnnulla']) ?? null,
        push: r.push ?? null,
    }))
}

const comeData = (k: string, v: Valore) => (CAMPI_DATA.has(k) && typeof v === 'string' ? new Date(v) : v)

/**
 * Annulla un'operazione: lead per lead, solo se è ancora come l'operazione
 * l'ha lasciato (annullabile); gli altri restano e si elencano. Scrive un
 * evento per ogni lead ripristinato, come i --ripristina degli script.
 */
export async function annullaOperazione(operazioneId: string, adminId: string, persone: PersonaRegia[]): Promise<{ ripristinati: number; saltati: VoceEsclusa[] }> {
    const bot = botDi(persone)
    return db.transaction(async (tx) => {
        const [op] = await tx.select().from(regiaOperazioni)
            .where(and(eq(regiaOperazioni.id, operazioneId), eq(regiaOperazioni.companyId, FENICE))).for('update').limit(1)
        if (!op) throw new ErroreRegia('Operazione non trovata.')
        if (op.annullataAt) throw new ErroreRegia('Questa operazione è già stata annullata.')
        const d = op.dettaglio as DettaglioOperazione
        const saltati: VoceEsclusa[] = []
        let ripristinati = 0
        const t = new Date()

        if (d.gdo.length) {
            for (const g of d.gdo) {
                const [att] = await leggiPersone(tx).then(l => l.filter(x => x.id === g.id))
                if (!att) { saltati.push({ id: g.id, nome: g.nome, motivo: 'GDO non trovato' }); continue }
                const ora = fotografa(att as unknown as Record<string, unknown>, CAMPI_GDO)
                if (Object.keys(g.dopo).some(k => ora[k] !== g.dopo[k])) { saltati.push({ id: g.id, nome: g.nome, motivo: 'gli interruttori sono cambiati da allora' }); continue }
                await tx.update(users).set(ripristino(g.prima, g.dopo) as Record<string, never>).where(eq(users.id, g.id))
                ripristinati++
            }
        }

        const coinvolti = new Set<string | null>()
        for (const v of d.lead) { coinvolti.add((v.prima.assignedToId as string | null) ?? null); coinvolti.add((v.dopo.assignedToId as string | null) ?? null) }
        await lockScorta(tx, [...coinvolti])
        const ids = d.lead.map(v => v.id)
        const attuali = ids.length === 0 ? [] : await tx.select().from(leads).where(inArray(leads.id, ids)).for('update')
        const perId = new Map(attuali.map(l => [l.id, l as unknown as Record<string, unknown>]))
        for (const v of d.lead) {
            const l = perId.get(v.id)
            if (!l) { saltati.push({ id: v.id, nome: v.nome, motivo: 'lead non trovato' }); continue }
            const attuale = fotografa(l, Object.keys(v.dopo))
            const motivo = annullabile(attuale, v.dopo)
            if (motivo) { saltati.push({ id: v.id, nome: v.nome, motivo }); continue }
            const indietro = ripristino(v.prima, v.dopo)
            const { scortaStato, scortaDal, ...resto } = indietro
            const set: Record<string, unknown> = {}
            for (const [k, x] of Object.entries(resto)) set[k] = comeData(k, x)
            const daBot = !!bot && v.dopo.assignedToId === bot.id && v.prima.assignedToId !== bot.id
            const alBot = !!bot && v.prima.assignedToId === bot.id && v.dopo.assignedToId !== bot.id
            // Il feed del bot (cursore su updatedAt) deve vedere i lead che entrano o escono dal bot.
            if (daBot || alBot || 'status' in resto) set.updatedAt = t
            await tx.update(leads).set({ ...set, version: sql`${leads.version} + 1` }).where(eq(leads.id, v.id))
            if ('scortaStato' in indietro || 'scortaDal' in indietro) {
                await scriviScorta(tx, v.id, (scortaStato as string | null) ?? null, scortaDal ? new Date(scortaDal as string) : null)
            }
            const prima = (v.prima.assignedToId as string | null) ?? null
            const dopo = (v.dopo.assignedToId as string | null) ?? null
            const meta = { reason: 'regia_lead_annullata', operazione: operazioneId, fromAssigneeId: dopo, toAssigneeId: prima }
            if (op.tipo === 'scarta' || op.tipo === 'doppione') {
                await tx.insert(leadEvents).values({ id: crypto.randomUUID(), leadId: v.id, eventType: 'LEAD_RIAPERTO', userId: adminId, timestamp: t, companyId: FENICE, metadata: meta })
            } else if (op.tipo === 'togli_appuntamento') {
                await tx.insert(leadEvents).values({ id: crypto.randomUUID(), leadId: v.id, eventType: 'appointment_restored_admin', userId: adminId, timestamp: t, companyId: FENICE, metadata: meta })
            } else if (daBot && prima) {
                // Il lead torna dal bot a un GDO: per la board è una restituzione dal bot.
                await tx.insert(leadEvents).values({ id: crypto.randomUUID(), leadId: v.id, eventType: 'REASSIGNED_FROM_BOT', userId: prima, timestamp: t, companyId: FENICE, metadata: { ...meta, botNote: null, fromBot: bot!.id, toGdo: prima } })
            } else if (prima !== dopo) {
                await tx.insert(leadEvents).values({ id: crypto.randomUUID(), leadId: v.id, eventType: 'REASSIGNED_ADMIN', userId: adminId, timestamp: t, companyId: FENICE, metadata: meta })
            } else {
                await tx.insert(leadEvents).values({ id: crypto.randomUUID(), leadId: v.id, eventType: 'REGIA_ANNULLATA', userId: adminId, timestamp: t, companyId: FENICE, metadata: meta })
            }
            ripristinati++
        }

        await tx.update(regiaOperazioni).set({ annullataAt: t, annullataDa: adminId, esitoAnnulla: { ripristinati, saltati } })
            .where(eq(regiaOperazioni.id, operazioneId))
        return { ripristinati, saltati }
    })
}
