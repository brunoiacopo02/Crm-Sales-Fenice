// Giro "lead di database al bot" (PO 10/11/2026, contratto v1.17). Le regole
// stanno in ./database.ts; qui le letture e le scritture.
//
// A ogni giro del cron marketing-coda-bot (ogni ora):
// 1. si pescano i lead della coda marketing degli ultimi giorni segnati
//    `"database": true` e non ancora gestiti;
// 2. si spingono al bot UNO ALLA VOLTA con `database: true`, PRIMA di toccarli:
//    se il bot dice "non adesso" (interruttore spento, tetto del giorno pieno,
//    fuori fascia) il lead resta com'era e il giro si ferma;
// 3. se il bot l'ha aperto il lead passa all'account bot nell'infornata a SENSO
//    UNICO `DATABASE_BOT_202611`: chi non risponde o sparisce non torna ai GDO
//    (reassign.ts lo chiude come REJECTED, ripescabile in blocco).

import crypto from 'node:crypto'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leads, leadEvents, marketingQueueEntries, users } from '@/db/schema'
import { pushLeadToBot } from '@/lib/bot-fissatore/push'
import { personKeyOf } from '@/lib/bot-fissatore/personKey'
import { stessoNumeroSql } from './telefonoSql'
import {
    BATCH_DATABASE_BOT, EVENTI_CONTATTO, EVENTO_DATABASE_BOT, azioneDaPush, ingressoAllargato, leggiConfigDatabaseAlBot, motivoNonIdoneo,
    scartoChiusoPersona, segnoDatabaseSql, type CandidatoDatabase, type ConfigDatabaseAlBot, type EsitoIngresso, type PersonaDatabase,
    type MotivoNonIdoneoAllargato, type RegolaIngresso,
} from './database'

const FENICE = 'fenice'

export type EsitoGiroDatabase =
    | { ok: true; motivo: 'spento' }
    | { ok: false; error: string }
    | {
        ok: true
        motivo: 'ok' | 'nessun_candidato' | 'fermato'
        pescati: number
        nonIdonei: Partial<Record<MotivoNonIdoneoAllargato, number>>
        perRegola: Partial<Record<RegolaIngresso, number>>
        spinti: number
        assegnati: number
        definitivi: number
        /** Chat aperte dal bot senza spostare la scheda (storico di un GDO da non toccare). */
        apertiSenzaSpostare?: number
        fermatoPer?: string
    }

/** L'account bot di Fenice (l'assegnatario dei lead dati al bot). */
export async function accountBotFenice(): Promise<{ id: string } | undefined> {
    const [bot] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isBot, true), eq(users.isActive, true),
    )).limit(1)
    return bot
}

/**
 * Lettura e giudizio dei lead di database della coda: SOLA LETTURA, nessuna spinta. La usa
 * il giro (`eseguiDatabaseAlBot`) e la prova a secco (scripts/diretta/dryrun-database-tutti-12-11.ts).
 * `ancheSenzaSegno` (solo per la prova a secco) guarda anche le righe che il marketing
 * non ha segnato `"database": true`.
 */
export async function leggiCodaDatabase(
    config: ConfigDatabaseAlBot, bot: { id: string }, opzioni: { ancheSenzaSegno?: boolean; nowMs?: number } = {},
) {
    // Una scheda `pl` della stessa persona del lead letto (ultime 10 cifre).
    const STESSA_PERSONA_PL = stessoNumeroSql(sql.raw('pl.phone'), sql.raw('"leads"."phone"'))

    // Il segno vive sulla riga della coda (payload originale del marketing), non sul
    // lead: un lead gia' nel CRM viene solo collegato e il suo funnel non cambia.
    // `"leads"."phone"` per esteso nella sottoquery: vedi la trappola nel cron
    // marketing-coda-bot (Drizzle toglie la qualificazione).
    const righe = await db.select({
        rigaCodaId: marketingQueueEntries.id,
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        status: leads.status,
        assignedToId: leads.assignedToId,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        phoneSuspicious: leads.phoneSuspicious,
        isTest: leads.isTest,
        intakeBatch: leads.intakeBatch,
        version: leads.version,
        callCount: leads.callCount,
        recallDate: leads.recallDate,
        discardReason: leads.discardReason,
        launchBucket: leads.launchBucket,
        lancioPool: leads.lancioPool,
        queueDate: marketingQueueEntries.queueDate,
        posizione: marketingQueueEntries.posizione,
        // Telefono confrontato sulle ultime 10 cifre (PO 11/11/2026: `+39 333...` e
        // `333...` sono la stessa persona), con l'espressione dell'indice
        // leads_company_phonekey_idx. Le spinte di QUESTO lead non contano: un suo
        // push database finito in timeout si riprova (il bot risponde "duplicato").
        toccatoDalBot: sql<boolean>`EXISTS (
            SELECT 1 FROM leads al JOIN "leadEvents" ae ON ae."leadId" = al.id
            WHERE al."companyId" = ${FENICE}
              AND right(regexp_replace(al.phone, '\\D', '', 'g'), 10) = right(regexp_replace("leads"."phone", '\\D', '', 'g'), 10)
              AND (ae."eventType" IN ('REASSIGNED_FROM_BOT','BOT_CALL_ATTEMPT','BOT_NOTE','BOT_REPORT')
                   OR (ae."eventType" = 'BOT_PUSHED' AND al.id <> "leads"."id" AND ae.metadata->>'result' IN ('sent','duplicate','network_error')))
        )`,
        // Gia' gestito dal giro database, su questa scheda o su un'altra con lo stesso numero.
        giaGestito: sql<boolean>`EXISTS (
            SELECT 1 FROM leads gl JOIN "leadEvents" ge ON ge."leadId" = gl.id
            WHERE gl."companyId" = ${FENICE}
              AND right(regexp_replace(gl.phone, '\\D', '', 'g'), 10) = right(regexp_replace("leads"."phone", '\\D', '', 'g'), 10)
              AND ge."eventType" = ${EVENTO_DATABASE_BOT}
        )`,
        // Un'altra scheda con lo stesso numero e' in mano a una persona o ha un appuntamento.
        doppioneOccupato: sql<boolean>`EXISTS (
            SELECT 1 FROM leads ol
            WHERE ol."companyId" = ${FENICE} AND ol.id <> "leads"."id"
              AND right(regexp_replace(ol.phone, '\\D', '', 'g'), 10) = right(regexp_replace("leads"."phone", '\\D', '', 'g'), 10)
              AND ((ol."assignedToId" IS NOT NULL AND ol."assignedToId" <> ${bot.id})
                   OR ol.status = 'APPOINTMENT' OR ol."appointmentDate" IS NOT NULL OR ol."presentedAt" IS NOT NULL)
        )`,
        // ── Solo per l'ingresso allargato: la PERSONA (tutte le schede con le stesse 10 cifre). ──
        // Il confronto dei telefoni passa da telefonoSql.ts: scritto a mano qui, la barra di D
        // spariva nel template e a Postgres arrivava 'D' (revisione 11/11/2026).
        assegnatoAPersona: sql<boolean>`("leads"."assignedToId" IS NOT NULL AND "leads"."assignedToId" <> ${bot.id})`,
        chiamateScheda: sql<number>`(SELECT COUNT(*)::int FROM "callLogs" cl WHERE cl."leadId" = "leads"."id")`,
        ultimoContatto: sql<string | null>`GREATEST(
            (SELECT MAX(cl."createdAt") FROM "callLogs" cl JOIN leads pl ON pl.id = cl."leadId"
              WHERE pl."companyId" = ${FENICE}
                AND ${STESSA_PERSONA_PL}),
            (SELECT MAX(pe.timestamp) FROM "leadEvents" pe JOIN leads pl ON pl.id = pe."leadId"
              WHERE pl."companyId" = ${FENICE}
                AND ${STESSA_PERSONA_PL}
                AND (pe."eventType" IN (${sql.join(EVENTI_CONTATTO.map((e) => sql`${e}`), sql`, `)})
                     OR (pe."eventType" = 'BOT_PUSHED' AND pe.metadata->>'result' IN ('sent','duplicate'))))
        )::text`,
        // PO 12/11/2026: fuori solo l'appuntamento FUTURO (quelli passati entrano) e il
        // richiamo futuro su una scheda aperta. I clienti entrano: nessun controllo.
        appuntamentoFuturo: sql<boolean>`EXISTS (
            SELECT 1 FROM leads pl WHERE pl."companyId" = ${FENICE}
              AND ${STESSA_PERSONA_PL}
              AND pl."appointmentDate" >= now()
        )`,
        richiamoFissato: sql<boolean>`EXISTS (
            SELECT 1 FROM leads pl WHERE pl."companyId" = ${FENICE}
              AND ${STESSA_PERSONA_PL}
              AND pl.status IN ('NEW','IN_PROGRESS') AND pl."recallDate" >= now()
        )`,
        motiviScartoPersona: sql<string | null>`(
            SELECT string_agg(DISTINCT pl."discardReason", ' | ') FROM leads pl WHERE pl."companyId" = ${FENICE}
              AND ${STESSA_PERSONA_PL}
              AND pl."discardReason" IS NOT NULL
        )`,
        // Spinte database di questo lead finite con un errore suo (non "non adesso").
        tentativiFalliti: sql<number>`(
            SELECT COUNT(*)::int FROM "leadEvents" fe
            WHERE fe."leadId" = "leads"."id" AND fe."eventType" = 'BOT_PUSHED'
              AND (fe.metadata->>'motivo' = 'arruolamento_fallito' OR fe.metadata->>'result' = 'http_error')
        )`,
    }).from(marketingQueueEntries)
        .innerJoin(leads, eq(leads.id, marketingQueueEntries.leadId))
        .where(and(
            eq(marketingQueueEntries.companyId, FENICE),
            eq(leads.companyId, FENICE),
            opzioni.ancheSenzaSegno ? undefined : sql.raw(segnoDatabaseSql('"marketingQueueEntries"."payload"')),
            sql`${marketingQueueEntries.queueDate} >= ((now() AT TIME ZONE 'Europe/Rome')::date - ${config.giorniCoda}::int)`,
        ))
        // Coda piu' recente prima, poi l'ordine del marketing.
        .orderBy(desc(marketingQueueEntries.queueDate), asc(marketingQueueEntries.posizione))
        .limit(500)

    // Lo stesso lead in piu' code, o due schede con lo stesso numero: conta la riga
    // piu' recente (una persona, una sola spinta per giro).
    const visti = new Set<string>()
    const lista = righe.filter((r) => {
        const k = personKeyOf(r.phone) ?? r.id
        if (visti.has(r.id) || visti.has(k)) return false
        visti.add(r.id); visti.add(k)
        return true
    })

    const nowMs = opzioni.nowMs ?? Date.now()
    return lista.map((r) => {
        const c: CandidatoDatabase = {
            id: r.id,
            status: r.status,
            assignedToId: r.assignedToId,
            appointmentDate: r.appointmentDate,
            presentedAt: r.presentedAt,
            phoneSuspicious: Boolean(r.phoneSuspicious),
            isTest: Boolean(r.isTest),
            intakeBatch: r.intakeBatch,
            toccatoDalBot: Boolean(r.toccatoDalBot),
            giaGestito: Boolean(r.giaGestito),
            doppioneOccupato: Boolean(r.doppioneOccupato),
            tentativiFalliti: Number(r.tentativiFalliti) || 0,
        }
        if (!config.allargato) {
            const m = motivoNonIdoneo(c)
            const esito: EsitoIngresso = m ? { motivo: m } : { regola: 'libero_nuovo', sposta: true }
            return { ...r, esito }
        }
        const aperto = r.status === 'NEW' || r.status === 'IN_PROGRESS'
        const ultimo = r.ultimoContatto ? Date.parse(r.ultimoContatto) : NaN
        const persona: PersonaDatabase = {
            ultimoContattoMs: Number.isNaN(ultimo) ? null : ultimo,
            chiamateScheda: Number(r.chiamateScheda) || 0,
            callCount: r.callCount ?? 0,
            recallDate: r.recallDate,
            appuntamentoFuturo: Boolean(r.appuntamentoFuturo),
            richiamoFissato: Boolean(r.richiamoFissato),
            scartoChiuso: scartoChiusoPersona({
                scartoScheda: r.discardReason,
                scartiPersona: (r.motiviScartoPersona ?? '').split(' | ').filter(Boolean),
                numeroProvato: Boolean(r.toccatoDalBot) || r.status === 'APPOINTMENT' || r.appointmentDate !== null || r.presentedAt !== null,
            }),
            assegnatoAPersona: Boolean(r.assegnatoAPersona),
            blackFridayAperto: aperto && /black ?friday/i.test(r.funnel ?? ''),
        }
        return { ...r, esito: ingressoAllargato(c, persona, { nowMs, giorniFermo: config.giorniFermo }) }
    })
}

export type RigaCodaDatabase = Awaited<ReturnType<typeof leggiCodaDatabase>>[number]

export async function eseguiDatabaseAlBot(env: Record<string, string | undefined> = process.env): Promise<EsitoGiroDatabase> {
    const config = leggiConfigDatabaseAlBot(env)
    if (!config.attivo) return { ok: true, motivo: 'spento' }

    const bot = await accountBotFenice()
    if (!bot) return { ok: false, error: 'account bot non trovato' }

    const lista = await leggiCodaDatabase(config, bot)
    const nonIdonei: Partial<Record<MotivoNonIdoneoAllargato, number>> = {}
    const perRegola: Partial<Record<RegolaIngresso, number>> = {}
    const idonei: Array<RigaCodaDatabase & { regola: RegolaIngresso; sposta: boolean }> = []
    for (const r of lista) {
        if ('motivo' in r.esito) nonIdonei[r.esito.motivo] = (nonIdonei[r.esito.motivo] ?? 0) + 1
        else { idonei.push({ ...r, regola: r.esito.regola, sposta: r.esito.sposta }); perRegola[r.esito.regola] = (perRegola[r.esito.regola] ?? 0) + 1 }
    }

    // Un rifiuto definitivo per motivo di idoneita' NON si scrive: il lead puo'
    // tornare idoneo (un GDO lo libera) finche' resta nella finestra della coda.
    const base = { pescati: lista.length, nonIdonei, perRegola }
    if (idonei.length === 0) {
        return { ok: true, motivo: 'nessun_candidato', ...base, spinti: 0, assegnati: 0, definitivi: 0 }
    }

    let spinti = 0, assegnati = 0, definitivi = 0, apertiSenzaSpostare = 0
    for (const r of idonei.slice(0, config.scaglione)) {
        const leadId = r.id
        const esito = await pushLeadToBot({
            leadId, name: r.name, phone: r.phone ?? '', email: r.email, funnel: r.funnel,
            companyId: FENICE, database: true,
        })
        spinti++
        const azione = azioneDaPush({ result: esito.result, motivo: 'motivo' in esito ? esito.motivo : undefined })

        if (azione.tipo === 'riprova') {
            // "Non adesso" vale per tutti: il giro si ferma. Un errore di QUESTO lead
            // no: si passa al prossimo (dopo 3 errori il lead esce da solo dai candidati).
            if (!azione.globale) continue
            console.log(`[database-al-bot] fermato su ${leadId}: ${azione.esito}`)
            return { ok: true, motivo: 'fermato', ...base, spinti, assegnati, definitivi, apertiSenzaSpostare, fermatoPer: azione.esito }
        }

        const now = new Date()
        if (azione.tipo === 'definitivo') {
            await db.insert(leadEvents).values({
                id: crypto.randomUUID(), leadId, eventType: EVENTO_DATABASE_BOT, userId: null, timestamp: now,
                metadata: { esito: azione.esito, assegnato: false, motivo: 'PO 10/11/2026: lead di database al bot' },
                companyId: FENICE,
            })
            definitivi++
            continue
        }

        // Scheda che NON si sposta (PO 12/11/2026: appuntamento o presenza addosso, o scarto
        // di un GDO: spostarla toglierebbe quei numeri dai conteggi del GDO). Il bot ha
        // aperto la chat; qui resta solo il segno, che impedisce una seconda spinta.
        if (!r.sposta) {
            await db.insert(leadEvents).values({
                id: crypto.randomUUID(), leadId, eventType: EVENTO_DATABASE_BOT, userId: null, timestamp: now,
                metadata: {
                    esito: azione.esito, assegnato: false, spostata: false, regola: r.regola, assegnatario: r.assignedToId, statoPrima: r.status,
                    motivo: 'PO 12/11/2026: chat aperta dal bot, scheda lasciata dov\'e\' (storico del GDO intatto)',
                },
                companyId: FENICE,
            })
            apertiSenzaSpostare++
            continue
        }

        // Il bot l'ha preso: all'account bot, nell'infornata a senso unico. Lo stato e lo
        // storico della scheda NON si toccano (uno scartato resta scartato: i suoi esiti
        // successivi del bot li ignora esitoSuScartato.ts, l'APPUNTAMENTO passa). Il
        // guardiano e' la `version` letta: un lead toccato da qualcuno nel frattempo (un GDO
        // che lo chiama) non si sposta. Un'infornata gia' presente non si sovrascrive.
        const preso = await db.transaction(async (tx) => {
            const agg = await tx.update(leads)
                .set({
                    assignedToId: bot.id,
                    assignedAt: sql`COALESCE(${leads.assignedAt}, ${now})`,
                    intakeBatch: sql`COALESCE(${leads.intakeBatch}, ${BATCH_DATABASE_BOT})`,
                    updatedAt: now,
                    version: sql`${leads.version} + 1`,
                })
                .where(config.allargato
                    ? and(eq(leads.id, leadId), eq(leads.version, r.version))
                    : and(eq(leads.id, leadId), isNull(leads.assignedToId), eq(leads.status, 'NEW')))
                .returning({ id: leads.id })
            const ok = agg.length > 0
            await tx.insert(leadEvents).values([
                ...(ok ? [{
                    id: crypto.randomUUID(), leadId, eventType: 'ASSIGNED', userId: bot.id, timestamp: now,
                    metadata: {
                        via: 'database_bot', source: 'marketing', assignedToUser: bot.id, regola: r.regola,
                        daAssegnatario: r.assignedToId, statoPrima: r.status, motivo: 'PO 10-11/11/2026: lead di database al bot, senso unico',
                    },
                    companyId: FENICE,
                }] : []),
                {
                    id: crypto.randomUUID(), leadId, eventType: EVENTO_DATABASE_BOT, userId: null, timestamp: now,
                    metadata: { esito: azione.esito, assegnato: ok, regola: r.regola, intakeBatchPrima: r.intakeBatch, discardReasonPrima: r.discardReason },
                    companyId: FENICE,
                },
            ])
            return ok
        })
        if (preso) assegnati++
        else console.warn(`[database-al-bot] ${leadId}: aperto dal bot ma nel frattempo non era piu' libero, non assegnato`)
    }

    return { ok: true, motivo: 'ok', ...base, spinti, assegnati, definitivi, apertiSenzaSpostare }
}
