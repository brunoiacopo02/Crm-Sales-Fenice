"use server"

// Centro di controllo della Diretta (/admin/diretta, PO 25/10/2026): i numeri
// che l'admin guarda in un colpo d'occhio e che non hanno già una action.
// Interruttori e obiettivi, citazioni e bonus Conferme arrivano dalle loro
// action (direttaActions, quoteActions, confermeDirettaActions).
//
// Solo ADMIN, letto dalla tabella users. Carico sul DB:
// - squadra di oggi: la stessa cache di 15 secondi della home GDO;
// - registro e controlli: unstable_cache di 30 secondi, con giorno e settimana
//   di Roma nella chiave (a mezzanotte e il lunedì ripartono da soli);
// - forzieri e richieste del negozio: tabelle piccole, lette fresche, così
//   dopo una consegna in /admin/premi il conto torna giusto subito.
// La pagina si ridisegna da sola al massimo una volta al minuto, a scheda visibile.
//
// L'economia della Diretta è di Fenice: Serenamente per GDO e Conferme non esiste.
//
// La prova (migr. 0050) resta fuori da registro, saldi, storni e persone: qui
// si guarda l'economia vera. Le richieste del negozio dell'account di prova
// restano in conto, come in /admin/premi, dove si annullano.

import { unstable_cache } from "next/cache"
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm"
import { db } from "@/db"
import { callLogs, currencyLedger, leads, rewardItems, rewardPurchases, teamChestAwards, teamChests, users } from "@/db/schema"
import { conRuoloDb } from "@/lib/auth/ruoloDb"
import { accountVero, nonDaAccountDiProva } from "@/lib/prova/sql"
import { dayBoundsRome, toRomeDateStr, weekBoundsRome } from "@/lib/dateUtils"
import { personName } from "@/lib/diretta/config"
import { leggiSquadra, type DirettaSquadra } from "@/lib/diretta/live"
import { leggiMembriSquadra } from "@/lib/diretta/fissatiDb"
import {
    controlloFissati, esitoDopo, totaliRegistro,
    type ControlloPersona, type TotaliValuta, type Valuta,
} from "@/lib/diretta/centro"

const FENICE = 'fenice'
const CACHE_SECONDI = 30
const TAG_CENTRO = 'diretta-centro'

export interface ForziereOggi {
    id: string
    /** giorno_1, giorno_2, punta_1, punta_2 */
    kind: string
    /** raro o leggendario */
    tier: string
    /** Fissati di squadra (o dell'ora di punta) quando si è aperto. */
    raggiunto: number
    apertoAlle: string
    persone: number
    /** Quante persone ci hanno trovato una Piuma. */
    piume: number
}

export interface RichiestaCentro {
    id: string
    persona: string
    articolo: string
    currency: 'S' | 'P'
    price: number
    createdAt: string
}

export interface MovimentoCentro {
    id: string
    at: string
    userId: string
    persona: string
    currency: 'S' | 'P'
    amount: number
    reason: string
}

export interface SaldoCentro {
    id: string
    persona: string
    ruolo: string
    valore: number
}

export interface ToltoCentro {
    leadId: string
    lead: string
    persona: string
    fissatoAlle: string
    stato: string | null
    /** Il primo esito dopo l'appuntamento, quello che l'ha tolto (se c'è). */
    poi: { outcome: string; at: string; persona: string | null } | null
}

export interface RegistroCentro {
    totali: Record<Valuta, TotaliValuta>
    ultimi: MovimentoCentro[]
    topScintille: SaldoCentro[]
    topPiume: SaldoCentro[]
}

export interface ControlliCentro {
    persone: (ControlloPersona & { nome: string })[]
    tolti: ToltoCentro[]
    storni: {
        righe: Record<Valuta, number>
        totale: Record<Valuta, number>
        ultimi: MovimentoCentro[]
    }
}

export interface CentroDiretta {
    calcolatoAlle: string
    /** Giorno di Roma, YYYY-MM-DD. */
    giorno: string
    squadra: DirettaSquadra | null
    forzieri: ForziereOggi[] | null
    negozio: { daGestire: number; prime: RichiestaCentro[] } | null
    registro: RegistroCentro | null
    controlli: ControlliCentro | null
}

const asValuta = (c: string): 'S' | 'P' => (c === 'P' ? 'P' : 'S')

/** Una sezione che non si legge diventa null: le altre restano in pagina. */
async function sezione<T>(nome: string, f: () => Promise<T>): Promise<T | null> {
    try {
        return await f()
    } catch (e) {
        console.error(`[centro diretta] ${nome}`, e)
        return null
    }
}

// ── Letture ──────────────────────────────────────────────────────────────

const STORNO = sql<boolean>`left(${currencyLedger.idemKey}, 7) = 'storno:'`

async function movimenti(filtro: ReturnType<typeof and> | undefined, limite: number): Promise<MovimentoCentro[]> {
    const righe = await db.select({
        id: currencyLedger.id,
        at: currencyLedger.createdAt,
        userId: currencyLedger.userId,
        currency: currencyLedger.currency,
        amount: currencyLedger.amount,
        reason: currencyLedger.reason,
        firstName: users.firstName,
        displayName: users.displayName,
        name: users.name,
    })
        .from(currencyLedger)
        .innerJoin(users, eq(users.id, currencyLedger.userId))
        .where(and(eq(currencyLedger.companyId, FENICE), accountVero(), filtro))
        .orderBy(desc(currencyLedger.createdAt), desc(currencyLedger.id))
        .limit(limite)
    return righe.map(r => ({
        id: r.id,
        at: r.at.toISOString(),
        userId: r.userId,
        persona: personName(r),
        currency: asValuta(r.currency),
        amount: r.amount,
        reason: r.reason,
    }))
}

async function saldiPiuAlti(valuta: Valuta): Promise<SaldoCentro[]> {
    const col = valuta === 'S' ? users.scintille : users.piume
    const righe = await db.select({
        id: users.id, firstName: users.firstName, displayName: users.displayName, name: users.name,
        role: users.role, valore: col,
    })
        .from(users)
        .where(and(gt(col, 0), accountVero()))
        .orderBy(desc(col), asc(users.name))
        .limit(5)
    return righe.map(r => ({ id: r.id, persona: personName(r), ruolo: r.role, valore: r.valore }))
}

const registroInCache = unstable_cache(async (inizioSettimana: string): Promise<RegistroCentro> => {
    const da = new Date(inizioSettimana)
    const [gruppi, ultimi, topScintille, topPiume] = await Promise.all([
        db.select({
            currency: currencyLedger.currency,
            reason: currencyLedger.reason,
            storno: STORNO,
            positivi: sql<number>`coalesce(sum(${currencyLedger.amount}) filter (where ${currencyLedger.amount} > 0), 0)::int`,
            negativi: sql<number>`coalesce(sum(${currencyLedger.amount}) filter (where ${currencyLedger.amount} < 0), 0)::int`,
        })
            .from(currencyLedger)
            .where(and(eq(currencyLedger.companyId, FENICE), gte(currencyLedger.createdAt, da), nonDaAccountDiProva(currencyLedger.userId)))
            .groupBy(currencyLedger.currency, currencyLedger.reason, STORNO),
        movimenti(undefined, 10),
        saldiPiuAlti('S'),
        saldiPiuAlti('P'),
    ])
    return { totali: totaliRegistro(gruppi), ultimi, topScintille, topPiume }
}, ['diretta-centro-registro-v1'], { revalidate: CACHE_SECONDI, tags: [TAG_CENTRO] })

const controlliInCache = unstable_cache(async (inizioGiorno: string, fineGiorno: string, inizioSettimana: string): Promise<ControlliCentro> => {
    const start = new Date(inizioGiorno)
    const end = new Date(fineGiorno)
    const settimana = new Date(inizioSettimana)

    const membri = await leggiMembriSquadra(FENICE)
    const ids = membri.map(m => m.id)

    // Appuntamenti fissati oggi dalla squadra, con lo stato attuale del lead:
    // la stessa query dei fissati validi, senza scartare quelli tolti.
    const righe = ids.length === 0 ? [] : await db.select({
        userId: callLogs.userId,
        leadId: callLogs.leadId,
        createdAt: callLogs.createdAt,
        stato: leads.status,
    })
        .from(callLogs)
        .innerJoin(leads, eq(leads.id, callLogs.leadId))
        .where(and(
            eq(callLogs.companyId, FENICE),
            inArray(callLogs.userId, ids),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            gte(callLogs.createdAt, start),
            lt(callLogs.createdAt, end),
        ))
    const { persone, tolti } = controlloFissati(righe)
    const ultimiTolti = tolti.slice(0, 8)
    const leadIds = [...new Set(ultimiTolti.map(t => t.leadId))]

    const [dopo, nomiLead, storniPerValuta, ultimiStorni] = await Promise.all([
        leadIds.length === 0 ? Promise.resolve([]) : db.select({
            leadId: callLogs.leadId, outcome: callLogs.outcome, createdAt: callLogs.createdAt, userId: callLogs.userId,
        }).from(callLogs).where(and(inArray(callLogs.leadId, leadIds), gte(callLogs.createdAt, start))),
        leadIds.length === 0 ? Promise.resolve([]) : db.select({ id: leads.id, name: leads.name })
            .from(leads).where(inArray(leads.id, leadIds)),
        db.select({
            currency: currencyLedger.currency,
            righe: sql<number>`count(*)::int`,
            totale: sql<number>`coalesce(sum(${currencyLedger.amount}), 0)::int`,
        })
            .from(currencyLedger)
            .where(and(eq(currencyLedger.companyId, FENICE), gte(currencyLedger.createdAt, settimana), STORNO, nonDaAccountDiProva(currencyLedger.userId)))
            .groupBy(currencyLedger.currency),
        movimenti(and(gte(currencyLedger.createdAt, settimana), STORNO), 6),
    ])

    // Nomi di chi ha scritto gli esiti dopo l'appuntamento (di solito la squadra).
    const nomi = new Map(membri.map(m => [m.id, personName(m)]))
    const altri = [...new Set(dopo.map(d => d.userId).filter((u): u is string => !!u && !nomi.has(u)))]
    if (altri.length > 0) {
        const extra = await db.select({ id: users.id, firstName: users.firstName, displayName: users.displayName, name: users.name })
            .from(users).where(inArray(users.id, altri))
        for (const u of extra) nomi.set(u.id, personName(u))
    }
    const lead = new Map(nomiLead.map(l => [l.id, l.name]))

    const storni = { righe: { S: 0, P: 0 }, totale: { S: 0, P: 0 }, ultimi: ultimiStorni }
    for (const s of storniPerValuta) {
        const v = asValuta(s.currency)
        storni.righe[v] += s.righe
        storni.totale[v] += -s.totale
    }

    return {
        persone: persone.map(p => ({ ...p, nome: nomi.get(p.userId) ?? '' })),
        tolti: ultimiTolti.map(t => {
            const e = esitoDopo(t, dopo)
            return {
                leadId: t.leadId,
                lead: lead.get(t.leadId) ?? '',
                persona: nomi.get(t.userId) ?? '',
                fissatoAlle: t.fissatoAlle,
                stato: t.stato,
                poi: e ? { outcome: e.outcome, at: new Date(e.createdAt).toISOString(), persona: e.userId ? nomi.get(e.userId) ?? null : null } : null,
            }
        }),
        storni,
    }
}, ['diretta-centro-controlli-v1'], { revalidate: CACHE_SECONDI, tags: [TAG_CENTRO] })

async function forzieriDiOggi(giorno: string): Promise<ForziereOggi[]> {
    const forzieri = await db.select({
        id: teamChests.id, kind: teamChests.kind, tier: teamChests.tier,
        reached: teamChests.reached, createdAt: teamChests.createdAt,
    })
        .from(teamChests)
        .where(and(eq(teamChests.companyId, FENICE), eq(teamChests.day, giorno)))
        .orderBy(asc(teamChests.createdAt))
    if (forzieri.length === 0) return []
    const consegne = await db.select({
        chestId: teamChestAwards.chestId,
        persone: sql<number>`count(*)::int`,
        piume: sql<number>`(count(*) filter (where ${teamChestAwards.currency} = 'P'))::int`,
    })
        .from(teamChestAwards)
        .where(inArray(teamChestAwards.chestId, forzieri.map(f => f.id)))
        .groupBy(teamChestAwards.chestId)
    const perForziere = new Map(consegne.map(c => [c.chestId, c]))
    return forzieri.map(f => ({
        id: f.id,
        kind: f.kind,
        tier: f.tier,
        raggiunto: f.reached,
        apertoAlle: f.createdAt.toISOString(),
        persone: perForziere.get(f.id)?.persone ?? 0,
        piume: perForziere.get(f.id)?.piume ?? 0,
    }))
}

async function richiesteNegozio(): Promise<{ daGestire: number; prime: RichiestaCentro[] }> {
    // Come squadra, registro e saldi: le richieste degli account di prova
    // (migr. 0050) restano fuori dal centro di controllo.
    const [conto, prime] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(rewardPurchases)
            .innerJoin(users, eq(rewardPurchases.userId, users.id))
            .where(and(eq(rewardPurchases.status, 'richiesto'), accountVero())),
        db.select({
            id: rewardPurchases.id, createdAt: rewardPurchases.createdAt, currency: rewardPurchases.currency,
            price: rewardPurchases.price, giftTo: rewardPurchases.giftTo, articolo: rewardItems.name,
            firstName: users.firstName, displayName: users.displayName, name: users.name,
        })
            .from(rewardPurchases)
            .innerJoin(rewardItems, eq(rewardPurchases.itemId, rewardItems.id))
            .innerJoin(users, eq(rewardPurchases.userId, users.id))
            .where(and(eq(rewardPurchases.status, 'richiesto'), accountVero()))
            .orderBy(asc(rewardPurchases.createdAt))
            .limit(3),
    ])
    return {
        daGestire: conto[0]?.n ?? 0,
        prime: prime.map(p => ({
            id: p.id,
            persona: personName(p),
            articolo: p.giftTo ? `${p.articolo}, da regalare a ${p.giftTo}` : p.articolo,
            currency: asValuta(p.currency),
            price: p.price,
            createdAt: p.createdAt.toISOString(),
        })),
    }
}

// ── Action ───────────────────────────────────────────────────────────────

const LIMITE_REGISTRO = 200

export interface PersonaRegistro {
    id: string
    persona: string
    ruolo: string
    isActive: boolean
    scintille: number
    piume: number
}

export interface RegistroDettaglio {
    movimenti: MovimentoCentro[]
    persone: PersonaRegistro[]
    scelta: PersonaRegistro | null
    limite: number
}

/**
 * Registro delle monete per la pagina di dettaglio: gli ultimi movimenti,
 * filtrati per persona, valuta e soli storni. Solo ADMIN. Filtrato per
 * persona passa dall'indice persona e data del registro.
 */
export async function getRegistroDettaglio(filtri: { persona?: string | null; valuta?: string | null; storni?: boolean }): Promise<RegistroDettaglio | null> {
    if (!(await conRuoloDb(['ADMIN']))) return null
    const persona = typeof filtri.persona === 'string' && filtri.persona.length > 0 && filtri.persona.length <= 100 ? filtri.persona : null
    const valuta = filtri.valuta === 'S' || filtri.valuta === 'P' ? filtri.valuta : null

    const [righe, utenti] = await Promise.all([
        movimenti(and(
            persona ? eq(currencyLedger.userId, persona) : undefined,
            valuta ? eq(currencyLedger.currency, valuta) : undefined,
            filtri.storni ? STORNO : undefined,
        ), LIMITE_REGISTRO),
        db.select({
            id: users.id, firstName: users.firstName, displayName: users.displayName, name: users.name,
            role: users.role, isActive: users.isActive, scintille: users.scintille, piume: users.piume,
        })
            .from(users)
            .where(and(inArray(users.role, ['GDO', 'CONFERME']), eq(users.isBot, false), accountVero())),
    ])
    // Nel menu Persona (collaudo 25/10/2026) chi ha un nome vero, anche se ora
    // è fuori, e le Conferme. Gli account senza nome (108, i codici dismessi)
    // solo se hanno un saldo o se sono quello scelto. Delle Conferme il nome è
    // in `name`: displayName porta già "(Conferme)", che il menu scrive da sé.
    const persone = utenti
        .filter(u => u.role === 'CONFERME' || !!u.firstName?.trim() || u.scintille !== 0 || u.piume !== 0 || u.id === persona)
        .map(u => ({
            id: u.id,
            persona: u.role === 'CONFERME' ? (u.firstName?.trim() || u.name || u.displayName || '') : personName(u),
            ruolo: u.role, isActive: u.isActive, scintille: u.scintille, piume: u.piume,
        }))
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.persona.localeCompare(b.persona, 'it'))
    return {
        movimenti: righe,
        persone,
        scelta: persona ? persone.find(p => p.id === persona) ?? null : null,
        limite: LIMITE_REGISTRO,
    }
}

/** Tutto quello che il centro di controllo mostra e che non ha già una action. Solo ADMIN. */
export async function getCentroDiretta(): Promise<CentroDiretta | null> {
    if (!(await conRuoloDb(['ADMIN']))) return null
    const now = new Date()
    const giorno = toRomeDateStr(now)
    const oggi = dayBoundsRome(now)
    const settimana = weekBoundsRome(now)

    const [squadra, forzieri, negozio, registro, controlli] = await Promise.all([
        sezione('squadra', () => leggiSquadra(FENICE)),
        sezione('forzieri', () => forzieriDiOggi(giorno)),
        sezione('negozio', richiesteNegozio),
        sezione('registro', () => registroInCache(settimana.start.toISOString())),
        sezione('controlli', () => controlliInCache(oggi.start.toISOString(), oggi.end.toISOString(), settimana.start.toISOString())),
    ])
    return { calcolatoAlle: now.toISOString(), giorno, squadra, forzieri, negozio, registro, controlli }
}
