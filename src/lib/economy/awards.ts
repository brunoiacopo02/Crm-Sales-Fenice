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
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, callLogs, currencyLedger, leadEvents, leads, teamChestAwards, teamChests, users } from '@/db/schema'
import { dayBoundsRome, toRomeDateStr, weekBoundsRome } from '@/lib/dateUtils'
import { isTeamMember, peakWindow, stepReached, type GamificationTargets } from '@/lib/diretta/config'
import { readGamificationTargets } from '@/lib/diretta/settings'
import { contaFissati } from '@/lib/diretta/fissati'
import { leggiFissati, leggiMembriSquadra } from '@/lib/diretta/fissatiDb'
import { countPresences } from '@/lib/presenceCounting'
import { creditOnce, reverseOnce } from './ledger'
import {
    ECONOMY_RULES_KEY, parseEconomyRules, inizioEconomia,
    pianoFissato, fissatiDaStornare, inizioStorno, pianoScalini, rewardFissato,
    piumeDovute, pianoPiuma, piumePresenza, isPersonaleUmano, puoAccreditarePiume,
    forzieriRaggiunti, tierForziere, contenutoForziere, destinatariForziere, chestIdemKey,
    type EconomyRules, type EventoCiclo, type FissatoReward, type TipoPiuma, type ChestTier,
} from './rules'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Causali del registro (colonna reason). Gli storni hanno 'storno ...'. */
export const CAUSALI = {
    fissato: 'fissato',
    scalino: 'scalino_personale',
    forziere: 'forziere',
    benvenuto: 'benvenuto',
    azzeramento: 'azzeramento',
} as const

const TIPI_PIUMA: TipoPiuma[] = ['conferma', 'presenza', 'chiusura']

/** Margine fra l'orologio dell'app (createdAt del callLog) e quello del DB (createdAt del registro). */
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
 * manager): per loro niente premio e niente forzieri. Il callLog dell'esito e
 * lo stato APPOINTMENT del lead devono essere già scritti, perché i fissati del
 * giorno si contano da lì (fissati validi, src/lib/diretta/fissati.ts).
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

        // Fissati validi del giorno: la stessa query della home e della pagina
        // Squadra, quindi lo scalino segue il numero che il GDO vede.
        const fissatiOggi = contaFissati(await leggiFissati({ companyId, userIds: [userId], start, end }, tx)).totale
        const scalini = await allineaScalini(tx, { userId, companyId, giorno, fissati: fissatiOggi, targets, rules, righe: righeOggi })
        guadagnate += scalini.accreditate

        return rewardFissato({
            scintille: guadagnate,
            fissatiOggi,
            scalino: stepReached(fissatiOggi, targets.personale),
            saldo: u.scintille + guadagnate - scalini.stornate,
        })
    })
}

/**
 * Allinea gli scalini personali del giorno ai fissati validi (pianoScalini):
 * accredita quelli raggiunti, storna quelli non più raggiunti. Va chiamata
 * dentro la transazione che tiene il lock sulla riga della persona; `righe`
 * sono le righe del registro della persona nel giorno.
 */
async function allineaScalini(tx: Tx, p: {
    userId: string
    companyId: string
    giorno: string
    fissati: number
    targets: GamificationTargets
    rules: EconomyRules
    righe: { idemKey: string; amount: number }[]
}): Promise<{ accreditate: number; stornate: number }> {
    const piano = pianoScalini(p.righe, p.userId, p.giorno, p.fissati, p.targets.personale, p.rules.scaliniPersonali)
    let accreditate = 0
    let stornate = 0
    for (const k of piano.storna) {
        if (await reverseOnce(k, `storno scalino: fissati validi scesi a ${p.fissati}`, tx)) {
            stornate += p.righe.find(r => r.idemKey === k)?.amount ?? 0
        }
    }
    for (const a of piano.accredita) {
        const ok = await creditOnce({
            userId: p.userId, currency: 'S', amount: a.scintille, reason: CAUSALI.scalino,
            idemKey: a.idemKey, companyId: p.companyId, metadata: { giorno: p.giorno, scalino: a.scalino, fissatiOggi: p.fissati },
        }, tx)
        if (ok) accreditate += a.scintille
    }
    return { accreditate, stornate }
}

/**
 * Un lead è uscito dall'appuntamento (altro esito, annullamento dell'admin):
 * per chi l'aveva fissato oggi è un fissato valido in meno, e gli scalini di
 * oggi sopra il nuovo conteggio si stornano (si riprendono se il conteggio
 * risale). I giorni passati restano come sono, come i forzieri già aperti.
 */
export async function riallineaScaliniDopoUscita(leadId: string, companyId: string, at: Date): Promise<void> {
    const { start, end } = dayBoundsRome(at)
    const chi = await db.select({ userId: callLogs.userId }).from(callLogs).where(and(
        eq(callLogs.leadId, leadId),
        eq(callLogs.outcome, 'APPUNTAMENTO'),
        gte(callLogs.createdAt, start),
        lt(callLogs.createdAt, end),
    ))
    const ids = [...new Set(chi.map(c => c.userId).filter((x): x is string => !!x))]
    if (ids.length === 0) return
    const [targets, rules] = await Promise.all([readGamificationTargets(), readEconomyRules()])
    const giorno = toRomeDateStr(at)
    for (const userId of ids) {
        await db.transaction(async (tx) => {
            // Stesso lock di awardFissato: un fissato e un'uscita simultanei
            // della stessa persona non si incrociano sugli scalini.
            const [u] = await tx.select({
                id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, firstName: users.firstName,
            }).from(users).where(eq(users.id, userId)).for('no key update')
            if (!u || !isTeamMember(u)) return
            const righe = await tx.select({ idemKey: currencyLedger.idemKey, amount: currencyLedger.amount })
                .from(currencyLedger).where(and(
                    eq(currencyLedger.userId, userId),
                    gte(currencyLedger.createdAt, start),
                    lt(currencyLedger.createdAt, end),
                ))
            const fissati = contaFissati(await leggiFissati({ companyId, userIds: [userId], start, end }, tx)).totale
            await allineaScalini(tx, { userId, companyId, giorno, fissati, targets, rules, righe })
        }).catch((e: unknown) => console.error('[economia] riallineo scalini err', userId, e))
    }
}

/** Il lead come serve allo storno: i lavori di Conferme e venditore letti PRIMA dell'uscita. */
export interface LeadPerStorno {
    id: string
    confCall1At: Date | null
    confCall2At: Date | null
    confCall3At: Date | null
    confirmationsTimestamp: Date | null
    presentedAt: Date | null
    salespersonOutcomeAt: Date | null
}

/** Eventi del lead che chiudono un ciclo d'appuntamento (vedi cicloInCorso in ./rules). */
const EVENTI_CHIUSURA = ['appointment_cancelled_admin', 'conferme_scarto_reset', 'APPOINTMENT_SET']

/**
 * Storna le Scintille del fissato quando l'appuntamento sparisce (annullato
 * dall'admin, o tolto dal GDO prima che le Conferme lo vedessero): tutti gli
 * accrediti non stornati del ciclo in corso, dal primo fissato della serie.
 * Il ciclo si ricostruisce dai callLog e dagli eventi del lead, non da
 * appointmentCreatedAt: rifissare un lead già in appuntamento lo riscrive, e
 * il limite si sposterebbe oltre l'accredito da stornare. I fissati di cicli
 * precedenti (chiusi, o lavorati dalle Conferme) restano.
 *
 * `prima` è l'istante dell'uscita: il callLog e gli eventi scritti da lì in
 * poi (l'esito che toglie l'appuntamento, l'annullamento) non contano.
 * Ritorna quanti storni ha scritto.
 */
export async function reverseFissato(lead: LeadPerStorno, prima: Date, motivo: string): Promise<number> {
    const [registro, chiamate, eventi] = await Promise.all([
        db.select({ idemKey: currencyLedger.idemKey, amount: currencyLedger.amount, createdAt: currencyLedger.createdAt })
            .from(currencyLedger).where(eq(currencyLedger.leadId, lead.id)),
        db.select({ outcome: callLogs.outcome, at: callLogs.createdAt })
            .from(callLogs).where(and(eq(callLogs.leadId, lead.id), lt(callLogs.createdAt, prima))),
        db.select({ at: leadEvents.timestamp })
            .from(leadEvents).where(and(
                eq(leadEvents.leadId, lead.id),
                inArray(leadEvents.eventType, EVENTI_CHIUSURA),
                lt(leadEvents.timestamp, prima),
            )),
    ])
    const lavori = [
        lead.confCall1At, lead.confCall2At, lead.confCall3At,
        lead.confirmationsTimestamp, lead.presentedAt, lead.salespersonOutcomeAt,
    ].filter((d): d is Date => !!d && d.getTime() < prima.getTime())
    const storia: EventoCiclo[] = [
        ...chiamate.map(c => ({ at: c.at, tipo: c.outcome === 'APPUNTAMENTO' ? 'fissato' as const : 'chiusura' as const })),
        ...eventi.map(e => ({ at: e.at, tipo: 'chiusura' as const })),
        ...lavori.map(at => ({ at, tipo: 'lavoro' as const })),
    ]
    const dal = inizioStorno(storia, MARGINE_OROLOGI_MS)
    if (!dal) return 0
    let scritti = 0
    for (const k of fissatiDaStornare(registro, lead.id, dal)) {
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
 * Dopo un APPUNTAMENTO della squadra: conta i fissati validi di squadra del
 * giorno e dell'ora di punta (gli stessi numeri della home e della pagina
 * Squadra), crea i forzieri degli scalini raggiunti (uno per tipo al giorno: lo
 * garantisce l'indice unico azienda/giorno/tipo, anche con due esiti
 * simultanei) e li consegna a chi ne ha diritto. Chi arriva dopo (primo fissato
 * della giornata a forziere già aperto) lo riceve al suo primo fissato. Un
 * forziere creato resta: se poi un appuntamento viene tolto non si storna.
 */
export async function evaluateTeamChests(input: { companyId: string; at: Date }): Promise<void> {
    const { companyId, at } = input
    const [targets, rules] = await Promise.all([readGamificationTargets(), readEconomyRules()])

    const squadra = await leggiMembriSquadra(companyId)
    if (!squadra.length) return
    const ids = squadra.map(u => u.id)

    const { start, end } = dayBoundsRome(at)
    const righe = await leggiFissati({ companyId, userIds: ids, start, end })
    const delGiorno = contaFissati(righe)
    const punta = peakWindow(at, targets)
    const inPunta = punta ? contaFissati(righe, punta.start, punta.end) : null
    const raggiunti = forzieriRaggiunti(delGiorno.totale, inPunta ? inPunta.totale : null, targets)
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
            reached: conteggi.totale,
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
        const conteggi = diPunta ? (inPunta?.perUtente ?? {}) : delGiorno.perUtente
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
