// Premi della nuova economia scritti sul registro (Scintille e Piume, PO 25/10/2026).
//
// Funzioni lato server chiamate dalle action degli esiti. Questo file NON è
// "use server": nessuna funzione qui dentro è raggiungibile dal browser, e
// l'unica strada per muovere un saldo resta un esito vero scritto da chi ha il
// ruolo giusto. Le regole e i calcoli puri sono in ./rules.ts.
//
// Chi chiama avvolge sempre queste funzioni in try/catch: un premio fallito
// non deve mai bloccare un esito.

import { randomInt, randomUUID } from 'crypto'
import { and, countDistinct, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, callLogs, currencyLedger, leads, teamChestAwards, teamChests, users } from '@/db/schema'
import { dayBoundsRome, toRomeDateStr, weekBoundsRome } from '@/lib/dateUtils'
import { isTeamMember, peakWindow, stepReached } from '@/lib/diretta/config'
import { readGamificationTargets } from '@/lib/diretta/settings'
import { countPresences } from '@/lib/presenceCounting'
import { creditOnce, reverseOnce } from './ledger'
import {
    ECONOMY_RULES_KEY, parseEconomyRules, inizioEconomia,
    pianoFissato, fissatiDaStornare, bonusScalini, scalinoIdemKey, rewardFissato,
    piumeDovute, pianoPiuma, piumePresenza, isPersonaleUmano, puoAccreditarePiume,
    contaFissatiPerPersona, sommaFissati, forzieriRaggiunti, tierForziere,
    contenutoForziere, destinatariForziere, chestIdemKey,
    type EconomyRules, type FissatoReward, type TipoPiuma, type ChestTier,
} from './rules'

/** Causali del registro (colonna reason). Gli storni hanno 'storno ...'. */
export const CAUSALI = {
    fissato: 'fissato',
    scalino: 'scalino_personale',
    forziere: 'forziere',
    benvenuto: 'benvenuto',
    azzeramento: 'azzeramento',
} as const

const TIPI_PIUMA: TipoPiuma[] = ['conferma', 'presenza', 'chiusura']

/** Margine fra l'orologio dell'app (appointmentCreatedAt) e quello del DB (createdAt del registro). */
const MARGINE_OROLOGI_MS = 10 * 60 * 1000

export async function readEconomyRules(): Promise<EconomyRules> {
    try {
        const [row] = await db.select({ value: appSettings.value }).from(appSettings)
            .where(eq(appSettings.key, ECONOMY_RULES_KEY)).limit(1)
        return parseEconomyRules(row?.value)
    } catch {
        return parseEconomyRules(null)
    }
}

// ── Scintille del fissato e scalini personali ───────────────────────────

/**
 * Premia un APPUNTAMENTO appena registrato da `userId`: 10 Scintille se il lead
 * non ha già pagato negli ultimi 30 giorni e la persona non ha superato il
 * tetto del giorno, più i bonus degli scalini personali (8 e 10 fissati).
 *
 * Restituisce null se `userId` non è un GDO della squadra (bot, 108, admin,
 * manager): per loro niente premio e niente forzieri. Il callLog dell'esito
 * deve essere già scritto, perché i fissati del giorno si contano da lì.
 */
export async function awardFissato(input: { userId: string; leadId: string; companyId: string; at: Date }): Promise<FissatoReward | null> {
    const { userId, leadId, companyId, at } = input
    const [targets, rules] = await Promise.all([readGamificationTargets(), readEconomyRules()])
    const giorno = toRomeDateStr(at)
    const { start, end } = dayBoundsRome(at)

    return db.transaction(async (tx) => {
        // Lock sulla riga della persona: due fissati simultanei della stessa
        // persona passano uno alla volta, così il tetto del giorno non si sfora.
        // 'no key update' non blocca le chiavi esterne del registro.
        const [u] = await tx.select({
            id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot,
            firstName: users.firstName, scintille: users.scintille,
        }).from(users).where(eq(users.id, userId)).for('no key update')
        if (!u || !isTeamMember(u)) return null

        const righeLead = await tx.select({
            idemKey: currencyLedger.idemKey, amount: currencyLedger.amount, createdAt: currencyLedger.createdAt,
        }).from(currencyLedger).where(eq(currencyLedger.leadId, leadId))
        const righeOggi = await tx.select({
            idemKey: currencyLedger.idemKey, reason: currencyLedger.reason, amount: currencyLedger.amount,
        }).from(currencyLedger).where(and(
            eq(currencyLedger.userId, userId),
            gte(currencyLedger.createdAt, start),
            lt(currencyLedger.createdAt, end),
        ))

        let guadagnate = 0
        const piano = pianoFissato(righeLead, leadId, at, giorno, rules.fissato.finestraGiorni)
        // Il tetto conta anche i fissati poi stornati: un giro di fissa e togli
        // consuma il tetto invece di rigenerarlo.
        const pagatiOggi = righeOggi.filter(r => r.reason === CAUSALI.fissato && r.amount > 0).length
        if (!piano.bloccato && pagatiOggi < rules.fissato.tettoGiorno && rules.fissato.scintille > 0) {
            const ok = await creditOnce({
                userId, currency: 'S', amount: rules.fissato.scintille, reason: CAUSALI.fissato,
                idemKey: piano.idemKey, leadId, companyId, metadata: { giorno },
            }, tx)
            if (ok) guadagnate += rules.fissato.scintille
        }

        // Fissati del giorno = lead distinti con un callLog APPUNTAMENTO della
        // persona (stessa definizione dei contatori della Diretta).
        const [{ n }] = await tx.select({ n: countDistinct(callLogs.leadId) }).from(callLogs).where(and(
            eq(callLogs.companyId, companyId),
            eq(callLogs.userId, userId),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            gte(callLogs.createdAt, start),
            lt(callLogs.createdAt, end),
        ))
        const fissatiOggi = Number(n) || 0
        const giaPresi = new Set(righeOggi.map(r => r.idemKey))
        for (const b of bonusScalini(fissatiOggi, targets.personale, rules.scaliniPersonali)) {
            const idemKey = scalinoIdemKey(userId, giorno, b.scalino)
            if (giaPresi.has(idemKey)) continue
            const ok = await creditOnce({
                userId, currency: 'S', amount: b.scintille, reason: CAUSALI.scalino,
                idemKey, companyId, metadata: { giorno, scalino: b.scalino, fissatiOggi },
            }, tx)
            if (ok) guadagnate += b.scintille
        }

        return rewardFissato({
            scintille: guadagnate,
            fissatiOggi,
            scalino: stepReached(fissatiOggi, targets.personale),
            saldo: u.scintille + guadagnate,
        })
    })
}

/**
 * Storna le Scintille del fissato quando l'appuntamento sparisce (annullato
 * dall'admin, o tolto dal GDO prima che le Conferme lo vedessero). `dal` è
 * l'appointmentCreatedAt del ciclo che si chiude: i fissati di cicli
 * precedenti, già lavorati dalle Conferme, restano. Ritorna quanti storni ha scritto.
 */
export async function reverseFissato(leadId: string, dal: Date | null, motivo: string): Promise<number> {
    const righe = await db.select({
        idemKey: currencyLedger.idemKey, amount: currencyLedger.amount, createdAt: currencyLedger.createdAt,
    }).from(currencyLedger).where(eq(currencyLedger.leadId, leadId))
    const daStornare = fissatiDaStornare(righe, leadId, dal ? new Date(dal.getTime() - MARGINE_OROLOGI_MS) : null)
    let scritti = 0
    for (const k of daStornare) {
        if (await reverseOnce(k, `storno fissato: ${motivo}`)) scritti++
    }
    return scritti
}

// ── Piume del GDO assegnatario ──────────────────────────────────────────

/**
 * Allinea le Piume di un lead al suo stato attuale: 1 per la conferma, 2 o 4
 * per la presenza, 5 per la chiusura, al GDO assegnatario. Se l'esito non c'è
 * più (conferma cambiata, presenza o chiusura tolte, appuntamento annullato)
 * storna. Va chiamata DOPO aver scritto l'esito, da tutti i punti che toccano
 * conferma, presenza o esito del venditore.
 *
 * Gli accrediti richiedono che a scrivere l'esito sia lo staff (Conferme,
 * venditori, manager, admin: ruolo letto dal DB) e che a confermare
 * l'appuntamento sia stata una persona, non il bot. Gli storni valgono sempre.
 */
export async function syncLeadPiume(leadId: string, actorUserId: string | null): Promise<void> {
    const [targets, rules] = await Promise.all([readGamificationTargets(), readEconomyRules()])
    const inizio = inizioEconomia(rules)

    await db.transaction(async (tx) => {
        // Lock sul lead: due sincronizzazioni dello stesso lead non si incrociano
        // e lo stato letto è quello appena scritto dall'esito.
        const [lead] = await tx.select({
            id: leads.id,
            companyId: leads.companyId,
            assignedToId: leads.assignedToId,
            confirmationsOutcome: leads.confirmationsOutcome,
            confirmationsUserId: leads.confirmationsUserId,
            confirmationsTimestamp: leads.confirmationsTimestamp,
            presentedAt: leads.presentedAt,
            appointmentDate: leads.appointmentDate,
            salespersonOutcome: leads.salespersonOutcome,
        }).from(leads).where(eq(leads.id, leadId)).for('no key update')
        if (!lead) return

        const righe = await tx.select({ idemKey: currencyLedger.idemKey, amount: currencyLedger.amount })
            .from(currencyLedger).where(eq(currencyLedger.leadId, leadId))

        const ids = [...new Set([lead.confirmationsUserId, lead.assignedToId, actorUserId].filter((x): x is string => !!x))]
        const persone = ids.length
            ? await tx.select({
                id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, firstName: users.firstName,
            }).from(users).where(inArray(users.id, ids))
            : []
        const persona = (id: string | null) => (id ? persone.find(p => p.id === id) : undefined)

        const dovute = piumeDovute({
            confirmationsOutcome: lead.confirmationsOutcome,
            confermatoDaPersona: isPersonaleUmano(persona(lead.confirmationsUserId)),
            confirmationsTimestamp: lead.confirmationsTimestamp,
            presentedAt: lead.presentedAt,
            appointmentDate: lead.appointmentDate,
            salespersonOutcome: lead.salespersonOutcome,
        }, inizio)
        const destinatario = persona(lead.assignedToId)
        const accreditabile = puoAccreditarePiume(persona(actorUserId), destinatario)

        for (const tipo of TIPI_PIUMA) {
            const piano = pianoPiuma(righe, tipo, leadId, dovute[tipo])
            for (const k of piano.storna) await reverseOnce(k, `storno ${tipo}`, tx)
            if (!piano.accredita || !accreditabile || !destinatario) continue

            let amount = rules.piume[tipo]
            let ordinale: number | null = null
            if (tipo === 'presenza' && lead.presentedAt) {
                // La presenza vale di più dalla 5ª della settimana (soglia degli
                // euro della Diretta): conta le presenze già maturate, questa compresa.
                const sett = weekBoundsRome(lead.presentedAt)
                ordinale = (await countPresences(destinatario.id, sett.start, sett.end, lead.companyId)).total
                amount = piumePresenza(ordinale, targets.presenzeSogliaEuro, rules)
            }
            if (amount <= 0) continue
            await creditOnce({
                userId: destinatario.id, currency: 'P', amount, reason: tipo,
                idemKey: piano.accredita, leadId, companyId: lead.companyId,
                metadata: { autore: actorUserId, ...(ordinale !== null ? { presenzaSettimana: ordinale } : {}) },
            }, tx)
        }
    })
}

/** Come syncLeadPiume su più lead, uno alla volta: un errore su un lead non ferma gli altri. */
export async function syncPiumeForLeads(leadIds: string[], actorUserId: string | null): Promise<void> {
    for (const id of new Set(leadIds)) {
        await syncLeadPiume(id, actorUserId).catch(e => console.error('[economia] sync Piume err', id, e))
    }
}

// ── Forzieri di squadra ─────────────────────────────────────────────────

/** Numero casuale in [0, 1) da crypto: il contenuto dei forzieri non si indovina dal client. */
const casuale = () => randomInt(0, 1_000_000) / 1_000_000

const asTier = (t: string): ChestTier => (t === 'leggendario' ? 'leggendario' : 'raro')

/**
 * Dopo un APPUNTAMENTO della squadra: conta i fissati di squadra del giorno e
 * dell'ora di punta, crea i forzieri degli scalini raggiunti (uno per tipo al
 * giorno: lo garantisce l'indice unico azienda/giorno/tipo, anche con due esiti
 * simultanei) e li consegna a chi ne ha diritto. Chi arriva dopo (primo fissato
 * della giornata a forziere già aperto) lo riceve al suo primo fissato.
 */
export async function evaluateTeamChests(input: { companyId: string; at: Date }): Promise<void> {
    const { companyId, at } = input
    const [targets, rules] = await Promise.all([readGamificationTargets(), readEconomyRules()])

    const squadra = (await db.select({
        id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, firstName: users.firstName,
    }).from(users).where(and(
        eq(users.role, 'GDO'),
        eq(users.isActive, true),
        eq(users.isBot, false),
        isNotNull(users.firstName),
    ))).filter(isTeamMember)
    if (!squadra.length) return
    const ids = squadra.map(u => u.id)

    const { start, end } = dayBoundsRome(at)
    const righe = await db.select({ userId: callLogs.userId, leadId: callLogs.leadId, createdAt: callLogs.createdAt })
        .from(callLogs)
        .where(and(
            eq(callLogs.companyId, companyId),
            eq(callLogs.outcome, 'APPUNTAMENTO'),
            inArray(callLogs.userId, ids),
            gte(callLogs.createdAt, start),
            lt(callLogs.createdAt, end),
        ))
    const delGiorno = contaFissatiPerPersona(righe)
    const punta = peakWindow(at, targets)
    const inPunta = punta ? contaFissatiPerPersona(righe, punta) : null
    const raggiunti = forzieriRaggiunti(sommaFissati(delGiorno), inPunta ? sommaFissati(inPunta) : null, targets)
    if (!raggiunti.length) return

    const giorno = toRomeDateStr(at)
    for (const kind of raggiunti) {
        const conteggi = kind.startsWith('punta') ? inPunta! : delGiorno
        await db.insert(teamChests).values({
            id: randomUUID(),
            companyId,
            day: giorno,
            kind,
            tier: tierForziere(kind),
            reached: sommaFissati(conteggi),
        }).onConflictDoNothing({ target: [teamChests.companyId, teamChests.day, teamChests.kind] })
    }

    const forzieri = await db.select().from(teamChests).where(and(
        eq(teamChests.companyId, companyId),
        eq(teamChests.day, giorno),
        inArray(teamChests.kind, raggiunti),
    ))
    if (!forzieri.length) return
    const consegnati = await db.select({ chestId: teamChestAwards.chestId, userId: teamChestAwards.userId })
        .from(teamChestAwards).where(inArray(teamChestAwards.chestId, forzieri.map(f => f.id)))
    const giaDati = new Set(consegnati.map(c => `${c.chestId}:${c.userId}`))

    for (const f of forzieri) {
        const diPunta = f.kind.startsWith('punta')
        const conteggi = diPunta ? (inPunta ?? new Map<string, number>()) : delGiorno
        const minimo = diPunta ? rules.forzieri.minFissatiPunta : rules.forzieri.minFissatiGiorno
        for (const userId of destinatariForziere(conteggi, ids, minimo)) {
            if (giaDati.has(`${f.id}:${userId}`)) continue
            await consegnaForziere(f, userId, rules)
                .catch(e => console.error('[economia] consegna forziere err', f.id, userId, e))
        }
    }
}

/**
 * Consegna idempotente: la riga del premio (unica per forziere e persona) e
 * l'accredito nascono nella stessa transazione. Se due valutazioni arrivano
 * insieme, la seconda trova la riga già scritta e non accredita niente.
 */
async function consegnaForziere(
    f: { id: string; companyId: string; kind: string; tier: string; day: string },
    userId: string,
    rules: EconomyRules,
): Promise<void> {
    const contenuto = contenutoForziere(asTier(f.tier), rules, casuale)
    await db.transaction(async (tx) => {
        const [award] = await tx.insert(teamChestAwards).values({
            id: randomUUID(),
            chestId: f.id,
            userId,
            currency: contenuto.currency,
            amount: contenuto.amount,
        }).onConflictDoNothing({ target: [teamChestAwards.chestId, teamChestAwards.userId] })
            .returning({ id: teamChestAwards.id })
        if (!award) return
        await creditOnce({
            userId,
            currency: contenuto.currency,
            amount: contenuto.amount,
            reason: CAUSALI.forziere,
            idemKey: chestIdemKey(f.id, userId),
            companyId: f.companyId,
            metadata: { chestId: f.id, kind: f.kind, tier: f.tier, giorno: f.day },
        }, tx)
    })
}
