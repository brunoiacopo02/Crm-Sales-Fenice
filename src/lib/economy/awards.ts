// Premi della nuova economia scritti sul registro (Scintille e Piume, PO 25/10/2026,
// "economia v2" del 25/10 sera).
//
// Funzioni lato server chiamate dalle action degli esiti. Questo file NON è
// "use server": nessuna funzione qui dentro è raggiungibile dal browser, e
// l'unica strada per muovere un saldo resta un esito vero scritto da chi ha il
// ruolo giusto. Le regole e i calcoli puri sono in ./rules.ts.
//
// Chi chiama avvolge sempre queste funzioni in try/catch: un premio fallito
// non deve mai bloccare un esito.

import { randomInt, randomUUID } from 'crypto'
import { after } from 'next/server'
import { and, desc, eq, gte, inArray, isNotNull, like, lt, or } from 'drizzle-orm'
import { db } from '@/db'
import { appSettings, callLogs, currencyLedger, leadEvents, leads, teamChestAwards, teamChests, users } from '@/db/schema'
import { dayBoundsRome, toRomeDateStr } from '@/lib/dateUtils'
import { guadagnaPremiPersonali, peakWindow, stepReached, type GamificationTargets } from '@/lib/diretta/config'
import { stessoMondo } from '@/lib/prova/regole'
import { leadDelMondoDiAccount } from '@/lib/prova/sql'
import { readGamificationTargets } from '@/lib/diretta/settings'
import { contaFissati } from '@/lib/diretta/fissati'
import { leggiFissati, leggiMembriSquadra } from '@/lib/diretta/fissatiDb'
import { creditOnce, reverseOnce } from './ledger'
import { settimanaDaLunedi, settimanaLunSab } from './premiSettimana'
import {
    ECONOMY_RULES_KEY, parseEconomyRules, inizioEconomia,
    pianoFissato, fissatiDaStornare, inizioStorno, pianoScalini, rewardFissato,
    stadioGdo, importiGdo, causaleGradinoGdo, pianoStadi, PREFISSO_STADI,
    isPersonaleUmano, puoAccreditarePiume, isConfermePersona,
    stadioConferme, importiConferme, confermaInTempo, confermaUtile, confermaRegistrata, titolareConferma, sottoTettoConferme,
    obiettiviPersona, pianoObiettivo, contaObiettivi,
    forzieriRaggiunti, tierForziere, contenutoForziere, destinatariForziere, chestIdemKey,
    type EconomyRules, type EventoCiclo, type FissatoReward, type ChestTier, type LedgerRow, type LeadObiettivo, type TipoObiettivo,
    type Obiettivo,
} from './rules'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
/** db oppure una transazione: basta che sappia leggere. */
type Lettore = Pick<typeof db, 'select' | 'selectDistinctOn'>

/** Causali del registro (colonna reason). Gli storni hanno 'storno ...'. */
export const CAUSALI = {
    fissato: 'fissato',
    scalino: 'scalino_personale',
    forziere: 'forziere',
    benvenuto: 'benvenuto',
    azzeramento: 'azzeramento',
    confermeConferma: 'conferme_conferma',
    confermePresenza: 'conferme_presenza',
    obiettivoPresenze: 'obiettivo_presenze',
    obiettivoChiusure: 'obiettivo_chiusure',
} as const

const CAUSALE_OBIETTIVO: Record<TipoObiettivo, string> = {
    presenze: CAUSALI.obiettivoPresenze,
    chiusure: CAUSALI.obiettivoChiusure,
}

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
 * manager): per loro niente premio e niente forzieri. Il GDO di prova guadagna
 * le sue Scintille, solo sui lead di prova. Il callLog dell'esito e lo stato
 * APPOINTMENT del lead devono essere già scritti, perché i fissati del giorno
 * si contano da lì (fissati validi, src/lib/diretta/fissati.ts).
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
            id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, isTest: users.isTest,
            firstName: users.firstName, scintille: users.scintille,
        }).from(users).where(eq(users.id, userId)).for('no key update')
        if (!u || !guadagnaPremiPersonali(u)) return null
        // Prova con prova, vero con vero (src/lib/prova): un lead di prova non
        // paga un GDO vero, e un lead vero non paga l'account di prova.
        const [lead] = await tx.select({ isTest: leads.isTest }).from(leads).where(eq(leads.id, leadId)).limit(1)
        if (!lead || !stessoMondo(lead, u)) return null

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
                id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, isTest: users.isTest, firstName: users.firstName,
            }).from(users).where(eq(users.id, userId)).for('no key update')
            if (!u || !guadagnaPremiPersonali(u)) return
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

// ── Esiti di Conferme e venditori: Piume del GDO e premi delle Conferme ──

/** Coppie (persona delle Conferme, lunedì) i cui obiettivi settimanali vanno riallineati. */
type DaRiallineare = Set<string>
const coppia = (userId: string, lunedi: string) => `${userId}|${lunedi}`

/**
 * Allinea al suo stato attuale tutti i premi che dipendono dagli esiti di un
 * lead, dentro una transazione col lock sul lead:
 *
 * 1. Piume del GDO assegnatario a stadi: confermato 1, presentato 2, chiuso 4
 *    (valori di default). Vale lo stadio più alto raggiunto: quando il lead
 *    sale si accredita la differenza, quando scende si storna il gradino perso.
 *    Gli accrediti richiedono che a scrivere l'esito sia lo staff (Conferme,
 *    venditori, manager, admin: ruolo letto dal DB) e che a confermare sia
 *    stata una persona, non il bot. Gli storni valgono sempre.
 * 2. Scintille di chi ha confermato il lead (solo ruolo CONFERME, dal DB):
 *    3 alla conferma fatta prima dell'appuntamento, 20 in tutto se il lead si
 *    presenta, 26 se la conferma era arrivata con almeno un'ora d'anticipo.
 *    Le conferme pagate al giorno hanno un tetto; la presenza scritta da chi ha
 *    confermato non paga.
 *
 * Prova con prova (src/lib/prova): gli accrediti di 1. e 2. richiedono che
 * lead e destinatario stiano dalla stessa parte, e per le Piume del GDO anche
 * chi scrive l'esito; gli storni valgono comunque.
 *
 * Restituisce le settimane degli obiettivi delle Conferme da riallineare.
 */
async function sincronizzaLead(leadId: string, actorUserId: string | null, rules: EconomyRules): Promise<DaRiallineare> {
    const inizio = inizioEconomia(rules)
    const daRiallineare: DaRiallineare = new Set()

    await db.transaction(async (tx) => {
        // Lock sul lead: due sincronizzazioni dello stesso lead non si incrociano
        // e lo stato letto è quello appena scritto dall'esito.
        const [lead] = await tx.select({
            id: leads.id,
            companyId: leads.companyId,
            isTest: leads.isTest,
            assignedToId: leads.assignedToId,
            confirmationsOutcome: leads.confirmationsOutcome,
            confirmationsUserId: leads.confirmationsUserId,
            confirmationsTimestamp: leads.confirmationsTimestamp,
            presentedAt: leads.presentedAt,
            appointmentDate: leads.appointmentDate,
            salespersonOutcome: leads.salespersonOutcome,
            salespersonOutcomeAt: leads.salespersonOutcomeAt,
        }).from(leads).where(eq(leads.id, leadId)).for('no key update')
        if (!lead) return

        const righe: LedgerRow[] = await tx.select({
            idemKey: currencyLedger.idemKey, amount: currencyLedger.amount, userId: currencyLedger.userId, createdAt: currencyLedger.createdAt,
        }).from(currencyLedger).where(eq(currencyLedger.leadId, leadId))

        const registrata = confermaRegistrata(righe, leadId)
        const titolare = titolareConferma(righe, leadId, lead.confirmationsUserId)
        const ids = [...new Set([lead.confirmationsUserId, lead.assignedToId, actorUserId, titolare].filter((x): x is string => !!x))]
        const persone = ids.length
            ? await tx.select({
                id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot, isTest: users.isTest, firstName: users.firstName,
            }).from(users).where(inArray(users.id, ids))
            : []
        const persona = (id: string | null) => (id ? persone.find(p => p.id === id) : undefined)

        // 1. Piume del GDO, a stadi.
        const stadio = stadioGdo({
            confirmationsOutcome: lead.confirmationsOutcome,
            confermatoDaPersona: isPersonaleUmano(persona(lead.confirmationsUserId)),
            confirmationsTimestamp: lead.confirmationsTimestamp,
            presentedAt: lead.presentedAt,
            appointmentDate: lead.appointmentDate,
            salespersonOutcome: lead.salespersonOutcome,
        }, inizio)
        const destinatario = persona(lead.assignedToId)
        const autore = persona(actorUserId)
        const accreditabile = puoAccreditarePiume(autore, destinatario)
            && !!autore && !!destinatario && stessoMondo(lead, autore) && stessoMondo(lead, destinatario)
        const pianoGdo = pianoStadi(righe, PREFISSO_STADI.gdo, leadId, stadio, importiGdo(rules))
        for (const k of pianoGdo.storna) await reverseOnce(k, `storno ${causaleGradinoGdo(Number(k.split(':')[3]))}: il lead è sceso di stadio`, tx)
        if (accreditabile && destinatario) {
            for (const a of pianoGdo.accredita) {
                await creditOnce({
                    userId: destinatario.id, currency: 'P', amount: a.amount, reason: causaleGradinoGdo(a.gradino),
                    idemKey: a.idemKey, leadId, companyId: lead.companyId,
                    metadata: { autore: actorUserId, stadio, gradino: a.gradino },
                }, tx)
            }
        }

        // 2. Scintille di chi ha confermato (Conferme), a stadi.
        const statoConferme = {
            confirmationsOutcome: lead.confirmationsOutcome,
            confirmationsTimestamp: lead.confirmationsTimestamp,
            appointmentDate: lead.appointmentDate,
            presentedAt: lead.presentedAt,
        }
        let stadioConf = stadioConferme(statoConferme, inizio, !!registrata)
        const chiConferma = persona(titolare)
        if (stadioConf === 2 && titolare) {
            // La presenza la scrive il venditore: se l'ultimo esito l'ha scritto
            // chi ha confermato, per le sue Scintille il lead resta confermato.
            if ((await autoreUltimoEsito(tx, leadId)) === titolare) stadioConf = 1
        }
        // L'anticipo si misura sulla prima conferma pagata, se c'è: un salvataggio
        // successivo (cambio di venditore) non lo cancella.
        const inTempo = confermaInTempo({
            confirmationsTimestamp: registrata?.createdAt ?? lead.confirmationsTimestamp,
            appointmentDate: lead.appointmentDate,
        }, rules.conferme.scintille.inTempoMinuti)
        const pianoConf = pianoStadi(righe, PREFISSO_STADI.conferme, leadId, stadioConf, importiConferme(rules, inTempo))
        for (const k of pianoConf.storna) await reverseOnce(k, 'storno Scintille conferma: il lead è sceso di stadio', tx)
        if (titolare && chiConferma && isConfermePersona(chiConferma) && stessoMondo(lead, chiConferma)) {
            for (const a of pianoConf.accredita) {
                if (a.gradino === 1) {
                    // Tetto delle conferme pagate al giorno: lock sulla persona,
                    // così due conferme simultanee non lo sforano.
                    await tx.select({ id: users.id }).from(users).where(eq(users.id, titolare)).for('no key update')
                    const { start, end } = dayBoundsRome(new Date())
                    const oggi = await tx.select({ id: currencyLedger.id }).from(currencyLedger).where(and(
                        eq(currencyLedger.userId, titolare),
                        eq(currencyLedger.reason, CAUSALI.confermeConferma),
                        gte(currencyLedger.createdAt, start),
                        lt(currencyLedger.createdAt, end),
                    ))
                    if (!sottoTettoConferme(oggi.length, rules)) continue
                }
                await creditOnce({
                    userId: titolare, currency: 'S', amount: a.amount,
                    reason: a.gradino === 1 ? CAUSALI.confermeConferma : CAUSALI.confermePresenza,
                    idemKey: a.idemKey, leadId, companyId: lead.companyId,
                    metadata: { autore: actorUserId, stadio: stadioConf, gradino: a.gradino },
                }, tx)
            }
        }

        // Obiettivi settimanali di chi tiene la conferma (e di chi la teneva):
        // la settimana in corso e la precedente (esiti registrati in ritardo),
        // più quelle della presenza e della chiusura del lead.
        const chi = [...new Set([titolare, lead.confirmationsUserId].filter((x): x is string => !!x))]
        if (chi.length) {
            const adesso = new Date()
            const settimane = new Set<string>([
                settimanaLunSab(adesso).lunedi,
                settimanaLunSab(new Date(adesso.getTime() - 7 * 86_400_000)).lunedi,
            ])
            if (lead.presentedAt) settimane.add(settimanaLunSab(lead.presentedAt).lunedi)
            if (lead.salespersonOutcome === 'Chiuso' && lead.salespersonOutcomeAt) settimane.add(settimanaLunSab(lead.salespersonOutcomeAt).lunedi)
            for (const u of chi) for (const s of settimane) daRiallineare.add(coppia(u, s))
        }
    })
    return daRiallineare
}

/** Chi ha scritto l'ultimo esito del venditore sul lead (null se nessuno). */
async function autoreUltimoEsito(tx: Tx, leadId: string): Promise<string | null> {
    const [e] = await tx.select({ userId: leadEvents.userId }).from(leadEvents)
        .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.eventType, 'salesperson_outcome_set')))
        .orderBy(desc(leadEvents.timestamp)).limit(1)
    return e?.userId ?? null
}

async function riallineaCoppie(coppie: DaRiallineare, rules: EconomyRules): Promise<void> {
    for (const c of coppie) {
        const [userId, lunedi] = c.split('|')
        await riallineaObiettiviConferme(userId, lunedi, rules)
            .catch((e: unknown) => console.error('[economia] obiettivi Conferme err', userId, lunedi, e))
    }
}

/**
 * Gli obiettivi settimanali si riallineano dopo la risposta (after di Next),
 * così l'esito delle Conferme e dei venditori non aspetta i conteggi della
 * settimana; fuori da una richiesta (script) si fa subito.
 */
async function riallineaDopo(coppie: DaRiallineare, rules: EconomyRules): Promise<void> {
    if (coppie.size === 0) return
    const lavoro = () => riallineaCoppie(coppie, rules)
    try {
        after(lavoro)
    } catch {
        await lavoro()
    }
}

/**
 * Allinea le Piume del GDO e i premi delle Conferme di un lead al suo stato
 * attuale. Va chiamata DOPO aver scritto l'esito, da tutti i punti che toccano
 * conferma, presenza o esito del venditore (il nome è rimasto quello della v1).
 */
export async function syncLeadPiume(leadId: string, actorUserId: string | null): Promise<void> {
    const rules = await readEconomyRules()
    const coppie = await sincronizzaLead(leadId, actorUserId, rules)
    await riallineaDopo(coppie, rules)
}

/** Come syncLeadPiume su più lead, uno alla volta: un errore su un lead non ferma gli altri. */
export async function syncPiumeForLeads(leadIds: string[], actorUserId: string | null): Promise<void> {
    const rules = await readEconomyRules()
    const tutte: DaRiallineare = new Set()
    for (const id of new Set(leadIds)) {
        const coppie = await sincronizzaLead(id, actorUserId, rules)
            .catch((e: unknown) => { console.error('[economia] sync Piume err', id, e); return new Set<string>() })
        for (const c of coppie) tutte.add(c)
    }
    await riallineaDopo(tutte, rules)
}

// ── Obiettivi settimanali delle Conferme (Piume) ────────────────────────

/**
 * Riallinea gli scalini degli obiettivi settimanali (presenze e chiusure dei
 * lead confermati) di una persona delle Conferme per la settimana lun-sab del
 * `lunedi`: accredita gli scalini raggiunti, storna quelli persi (per esempio
 * una chiusura tolta). Solo per il ruolo CONFERME letto dal DB e solo dalla
 * settimana d'avvio dell'economia. Le settimane più vecchie della precedente si
 * riallineano solo alla chiusura dei premi della settimana.
 */
export async function riallineaObiettiviConferme(userId: string, lunedi: string, rulesIn?: EconomyRules): Promise<void> {
    const rules = rulesIn ?? await readEconomyRules()
    const settimana = settimanaDaLunedi(lunedi)
    if (!settimana || settimana.end.getTime() <= inizioEconomia(rules).getTime()) return
    const { start, end } = settimana

    await db.transaction(async (tx) => {
        // Lock sulla persona: due esiti simultanei non accreditano due volte lo stesso scalino.
        const [u] = await tx.select({ id: users.id, role: users.role, isActive: users.isActive, isBot: users.isBot })
            .from(users).where(eq(users.id, userId)).for('no key update')
        if (!u || !isConfermePersona(u)) return

        const righe: LedgerRow[] = await tx.select({ idemKey: currencyLedger.idemKey, amount: currencyLedger.amount })
            .from(currencyLedger).where(and(
                eq(currencyLedger.userId, userId),
                or(like(currencyLedger.idemKey, `P:obiettivo:%:${userId}:${lunedi}:%`), like(currencyLedger.idemKey, `storno:P:obiettivo:%:${userId}:${lunedi}:%`)),
            ))

        const conteggi = contaObiettivi(await leggiLeadObiettivi(tx, userId, start, end), userId, start, end)
        const obiettivi = obiettiviPersona(rules, userId)
        for (const tipo of ['presenze', 'chiusure'] as const) {
            const piano = pianoObiettivo(righe, tipo, userId, lunedi, conteggi[tipo], obiettivi[tipo])
            for (const k of piano.storna) await reverseOnce(k, `storno obiettivo ${tipo}: ${conteggi[tipo]} nella settimana`, tx)
            for (const a of piano.accredita) {
                await creditOnce({
                    userId, currency: 'P', amount: a.amount, reason: CAUSALE_OBIETTIVO[tipo],
                    idemKey: a.idemKey, metadata: { settimana: lunedi, scalino: a.gradino, conteggio: conteggi[tipo], soglie: obiettivi[tipo].soglie },
                }, tx)
            }
        }
    })
}

/**
 * Lead confermati che possono contare per gli obiettivi della persona nella
 * settimana: confermati da lei o tenuti da lei sul registro, con presenza o
 * chiusura nella settimana, e della sua stessa parte (l'account di prova
 * conta solo i lead di prova, gli altri solo quelli veri). Il filtro vero
 * (titolare, conferma prima dell'appuntamento, esito scritto da altri) lo fa
 * contaObiettivi.
 */
async function leggiLeadObiettivi(tx: Lettore, userId: string, start: Date, end: Date): Promise<LeadObiettivo[]> {
    const tenutiDaLei = tx.select({ id: currencyLedger.leadId }).from(currencyLedger).where(and(
        eq(currencyLedger.userId, userId),
        like(currencyLedger.idemKey, `${PREFISSO_STADI.conferme}:%`),
        isNotNull(currencyLedger.leadId),
    ))
    const candidati = await tx.select({
        id: leads.id,
        confirmationsOutcome: leads.confirmationsOutcome,
        confirmationsUserId: leads.confirmationsUserId,
        confirmationsTimestamp: leads.confirmationsTimestamp,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        salespersonOutcome: leads.salespersonOutcome,
        salespersonOutcomeAt: leads.salespersonOutcomeAt,
    }).from(leads).where(and(
        eq(leads.confirmationsOutcome, 'confermato'),
        leadDelMondoDiAccount(userId),
        or(eq(leads.confirmationsUserId, userId), inArray(leads.id, tenutiDaLei)),
        or(
            and(gte(leads.presentedAt, start), lt(leads.presentedAt, end)),
            and(eq(leads.salespersonOutcome, 'Chiuso'), gte(leads.salespersonOutcomeAt, start), lt(leads.salespersonOutcomeAt, end)),
        ),
    ))
    if (candidati.length === 0) return []
    const ids = candidati.map(c => c.id)
    const [registro, autori] = await Promise.all([
        tx.select({ idemKey: currencyLedger.idemKey, amount: currencyLedger.amount, userId: currencyLedger.userId, leadId: currencyLedger.leadId })
            .from(currencyLedger).where(and(
                inArray(currencyLedger.leadId, ids),
                or(like(currencyLedger.idemKey, `${PREFISSO_STADI.conferme}:%`), like(currencyLedger.idemKey, `storno:${PREFISSO_STADI.conferme}:%`)),
            )),
        tx.selectDistinctOn([leadEvents.leadId], { leadId: leadEvents.leadId, userId: leadEvents.userId })
            .from(leadEvents)
            .where(and(inArray(leadEvents.leadId, ids), eq(leadEvents.eventType, 'salesperson_outcome_set')))
            .orderBy(leadEvents.leadId, desc(leadEvents.timestamp)),
    ])
    const autorePer = new Map(autori.map(a => [a.leadId, a.userId]))
    return candidati.map(c => {
        const delLead = registro.filter(r => r.leadId === c.id)
        return {
            titolare: titolareConferma(delLead, c.id, c.confirmationsUserId),
            // Utile se fatta prima dell'appuntamento, o già pagata quando lo era.
            confermaUtile: confermaUtile(c) || !!confermaRegistrata(delLead, c.id),
            autoreEsito: autorePer.get(c.id) ?? null,
            presentedAt: c.presentedAt,
            chiusoAt: c.salespersonOutcome === 'Chiuso' ? c.salespersonOutcomeAt : null,
        }
    })
}

export interface ProgressoObiettivi {
    lunedi: string
    valori: Record<TipoObiettivo, number>
    obiettivi: Record<TipoObiettivo, Obiettivo>
}

/**
 * Dove sta una persona delle Conferme con gli obiettivi della settimana in
 * corso: gli stessi conteggi che decidono le Piume (solo lettura).
 */
export async function progressoObiettiviConferme(userId: string, at: Date = new Date()): Promise<ProgressoObiettivi> {
    const rules = await readEconomyRules()
    const s = settimanaLunSab(at)
    const righe = await leggiLeadObiettivi(db, userId, s.start, s.end)
    return { lunedi: s.lunedi, valori: contaObiettivi(righe, userId, s.start, s.end), obiettivi: obiettiviPersona(rules, userId) }
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
