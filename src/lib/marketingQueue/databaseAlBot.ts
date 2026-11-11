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
import {
    BATCH_DATABASE_BOT, EVENTO_DATABASE_BOT, azioneDaPush, leggiConfigDatabaseAlBot, motivoNonIdoneo,
    type CandidatoDatabase, type MotivoNonIdoneo,
} from './database'

const FENICE = 'fenice'

export type EsitoGiroDatabase =
    | { ok: true; motivo: 'spento' }
    | { ok: false; error: string }
    | {
        ok: true
        motivo: 'ok' | 'nessun_candidato' | 'fermato'
        pescati: number
        nonIdonei: Partial<Record<MotivoNonIdoneo, number>>
        spinti: number
        assegnati: number
        definitivi: number
        fermatoPer?: string
    }

export async function eseguiDatabaseAlBot(env: Record<string, string | undefined> = process.env): Promise<EsitoGiroDatabase> {
    const config = leggiConfigDatabaseAlBot(env)
    if (!config.attivo) return { ok: true, motivo: 'spento' }

    const [bot] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, FENICE), eq(users.role, 'GDO'), eq(users.isBot, true), eq(users.isActive, true),
    )).limit(1)
    if (!bot) return { ok: false, error: 'account bot non trovato' }

    // Il segno vive sulla riga della coda (payload originale del marketing), non sul
    // lead: un lead gia' nel CRM viene solo collegato e il suo funnel non cambia.
    // `"leads"."phone"` per esteso nella sottoquery: vedi la trappola nel cron
    // marketing-coda-bot (Drizzle toglie la qualificazione).
    const righe = await db.select({
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
        queueDate: marketingQueueEntries.queueDate,
        posizione: marketingQueueEntries.posizione,
        toccatoDalBot: sql<boolean>`EXISTS (
            SELECT 1 FROM leads al JOIN "leadEvents" ae ON ae."leadId" = al.id
            WHERE al.phone = "leads"."phone"
              AND (ae."eventType" IN ('REASSIGNED_FROM_BOT','BOT_CALL_ATTEMPT','BOT_NOTE','BOT_REPORT')
                   OR (ae."eventType" = 'BOT_PUSHED' AND ae.metadata->>'result' IN ('sent','duplicate','network_error')))
        )`,
        giaGestito: sql<boolean>`EXISTS (
            SELECT 1 FROM "leadEvents" ge WHERE ge."leadId" = "leads"."id" AND ge."eventType" = ${EVENTO_DATABASE_BOT}
        )`,
    }).from(marketingQueueEntries)
        .innerJoin(leads, eq(leads.id, marketingQueueEntries.leadId))
        .where(and(
            eq(marketingQueueEntries.companyId, FENICE),
            eq(leads.companyId, FENICE),
            sql`${marketingQueueEntries.payload}->'database' = 'true'::jsonb`,
            sql`${marketingQueueEntries.queueDate} >= ((now() AT TIME ZONE 'Europe/Rome')::date - ${config.giorniCoda}::int)`,
        ))
        // Coda piu' recente prima, poi l'ordine del marketing.
        .orderBy(desc(marketingQueueEntries.queueDate), asc(marketingQueueEntries.posizione))
        .limit(500)

    // Lo stesso lead in piu' code: conta la riga piu' recente.
    const visti = new Set<string>()
    const lista = righe.filter((r) => (visti.has(r.id) ? false : (visti.add(r.id), true)))

    const nonIdonei: Partial<Record<MotivoNonIdoneo, number>> = {}
    const idonei: typeof lista = []
    for (const r of lista) {
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
        }
        const m = motivoNonIdoneo(c)
        if (m) nonIdonei[m] = (nonIdonei[m] ?? 0) + 1
        else idonei.push(r)
    }

    // Un rifiuto definitivo per motivo di idoneita' NON si scrive: il lead puo'
    // tornare idoneo (un GDO lo libera) finche' resta nella finestra della coda.
    const base = { pescati: lista.length, nonIdonei }
    if (idonei.length === 0) {
        return { ok: true, motivo: 'nessun_candidato', ...base, spinti: 0, assegnati: 0, definitivi: 0 }
    }

    let spinti = 0, assegnati = 0, definitivi = 0
    for (const r of idonei.slice(0, config.scaglione)) {
        const leadId = r.id
        const esito = await pushLeadToBot({
            leadId, name: r.name, phone: r.phone ?? '', email: r.email, funnel: r.funnel,
            companyId: FENICE, database: true,
        })
        spinti++
        const azione = azioneDaPush({ result: esito.result, motivo: 'motivo' in esito ? esito.motivo : undefined })

        if (azione.tipo === 'riprova') {
            console.log(`[database-al-bot] fermato su ${leadId}: ${azione.esito}`)
            return { ok: true, motivo: 'fermato', ...base, spinti, assegnati, definitivi, fermatoPer: azione.esito }
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

        // Il bot l'ha preso: all'account bot, nell'infornata a senso unico. Il
        // guardiano `assignedToId IS NULL` non ruba un lead preso a mano nel frattempo;
        // un'infornata gia' presente (lista 133, gia' a senso unico) non si sovrascrive.
        const preso = await db.transaction(async (tx) => {
            const agg = await tx.update(leads)
                .set({
                    assignedToId: bot.id,
                    assignedAt: sql`COALESCE(${leads.assignedAt}, ${now})`,
                    intakeBatch: sql`COALESCE(${leads.intakeBatch}, ${BATCH_DATABASE_BOT})`,
                    updatedAt: now,
                    version: sql`${leads.version} + 1`,
                })
                .where(and(eq(leads.id, leadId), isNull(leads.assignedToId), eq(leads.status, 'NEW')))
                .returning({ id: leads.id })
            const ok = agg.length > 0
            await tx.insert(leadEvents).values([
                ...(ok ? [{
                    id: crypto.randomUUID(), leadId, eventType: 'ASSIGNED', userId: bot.id, timestamp: now,
                    metadata: { via: 'database_bot', source: 'marketing', assignedToUser: bot.id, motivo: 'PO 10/11/2026: lead di database al bot, senso unico' },
                    companyId: FENICE,
                }] : []),
                {
                    id: crypto.randomUUID(), leadId, eventType: EVENTO_DATABASE_BOT, userId: null, timestamp: now,
                    metadata: { esito: azione.esito, assegnato: ok, intakeBatchPrima: r.intakeBatch },
                    companyId: FENICE,
                },
            ])
            return ok
        })
        if (preso) assegnati++
        else console.warn(`[database-al-bot] ${leadId}: aperto dal bot ma nel frattempo non era piu' libero, non assegnato`)
    }

    return { ok: true, motivo: 'ok', ...base, spinti, assegnati, definitivi }
}
