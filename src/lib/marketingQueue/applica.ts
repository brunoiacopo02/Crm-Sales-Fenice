// Applica al DB la coda lead del giorno del marketing (POST /api/webhooks/marketing-leads).
//
// - Idempotente su (azienda, giorno, marketing_contact_id): il re-invio della
//   stessa coda non crea doppioni (lock per azienda+giorno + UNIQUE della tabella).
// - Lead già nel CRM (stesso contatto marketing, telefono o email): si riusa,
//   gli si attacca solo marketingContactId. Stato, assegnatario e tentativi NON
//   si toccano: le regole di riattivazione le decide il PO dopo.
// - Lead nuovo: nasce senza assegnatario nel pool MKT_CODA (launchBucket), così
//   resta fuori dai KPI finché qualcuno non lo distribuisce ai GDO.
//
// Niente ActiveCampaign, niente bot, niente outbox: qui si scrive solo nel DB.

import crypto from 'node:crypto'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { companies, leadEvents, leads, marketingQueueEntries } from '@/db/schema'
import { scegliLeadEsistente, type CandidatoEsistente, type ParsedQueueLead, type Scartato } from './payload'

export const MARKETING_QUEUE_BUCKET = 'MKT_CODA'

export type EsitoRiga = 'creato' | 'aggiornato' | 'gia_ricevuto'

export type RispostaCoda = {
    ok: true
    data: string
    ricevuti: number
    creati: number
    aggiornati: number
    scartati: Scartato[]
    dettaglio: Array<{ marketing_contact_id: string; lead_id: string | null; esito: EsitoRiga | 'scartato' }>
}

export class CompanySconosciuta extends Error {}

export async function applicaCodaMarketing(input: {
    company: string
    queueDate: string
    leads: ParsedQueueLead[]
    scartati: Scartato[]
    ricevuti: number
}): Promise<RispostaCoda> {
    const { company, queueDate } = input

    const [co] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, company)).limit(1)
    if (!co) throw new CompanySconosciuta(company)

    const dettaglio: RispostaCoda['dettaglio'] = []
    let creati = 0
    let aggiornati = 0

    await db.transaction(async (tx) => {
        // Due invii paralleli della stessa coda si mettono in fila qui.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'marketing-queue:' + company + ':' + queueDate}, 0))`)

        const ids = input.leads.map(l => l.marketingContactId)
        const giaInCoda = new Map<string, string | null>()
        if (ids.length) {
            const rows = await tx.select({ mk: marketingQueueEntries.marketingContactId, leadId: marketingQueueEntries.leadId })
                .from(marketingQueueEntries)
                .where(and(
                    eq(marketingQueueEntries.companyId, company),
                    eq(marketingQueueEntries.queueDate, queueDate),
                    inArray(marketingQueueEntries.marketingContactId, ids),
                ))
            for (const r of rows) giaInCoda.set(r.mk, r.leadId)
        }

        const nuovi = input.leads.filter(l => !giaInCoda.has(l.marketingContactId))
        for (const l of input.leads) {
            if (giaInCoda.has(l.marketingContactId)) {
                aggiornati++
                dettaglio.push({ marketing_contact_id: l.marketingContactId, lead_id: giaInCoda.get(l.marketingContactId) ?? null, esito: 'gia_ricevuto' })
            }
        }
        if (!nuovi.length) return

        // Candidati già nel CRM, in una query sola.
        const phones = [...new Set(nuovi.map(l => l.phone))]
        const emails = [...new Set(nuovi.map(l => l.email).filter((e): e is string => !!e))]
        const mkIds = nuovi.map(l => l.marketingContactId)
        const match = [inArray(leads.marketingContactId, mkIds), inArray(leads.phone, phones)]
        if (emails.length) match.push(inArray(sql`lower(${leads.email})`, emails))
        const candidati: CandidatoEsistente[] = await tx
            .select({ id: leads.id, marketingContactId: leads.marketingContactId, phone: leads.phone, email: leads.email, createdAt: leads.createdAt })
            .from(leads)
            .where(and(eq(leads.companyId, company), or(...match)))

        const now = new Date()
        const leadsDaCreare: Array<typeof leads.$inferInsert> = []
        const daCollegare: Array<{ leadId: string; mk: string }> = []
        const righe: Array<typeof marketingQueueEntries.$inferInsert> = []
        const eventi: Array<typeof leadEvents.$inferInsert> = []

        for (const l of nuovi) {
            const esistente = scegliLeadEsistente(l, candidati)
            let leadId: string
            let esito: EsitoRiga
            if (esistente) {
                leadId = esistente.id
                esito = 'aggiornato'
                if (!esistente.marketingContactId) {
                    daCollegare.push({ leadId, mk: l.marketingContactId })
                    esistente.marketingContactId = l.marketingContactId
                }
            } else {
                leadId = crypto.randomUUID()
                esito = 'creato'
                leadsDaCreare.push({
                    id: leadId,
                    name: l.name,
                    email: l.email,
                    phone: l.phone,
                    funnel: l.funnelOrigine,
                    source: 'marketing',
                    launchBucket: MARKETING_QUEUE_BUCKET,
                    marketingContactId: l.marketingContactId,
                    status: 'NEW',
                    assignedToId: null,
                    companyId: company,
                    createdAt: now,
                    updatedAt: now,
                })
                // Due contatti marketing con lo stesso telefono nella stessa coda
                // finiscono sullo stesso lead, non su due.
                candidati.push({ id: leadId, marketingContactId: l.marketingContactId, phone: l.phone, email: l.email, createdAt: now })
            }
            if (esito === 'creato') creati++
            else aggiornati++
            dettaglio.push({ marketing_contact_id: l.marketingContactId, lead_id: leadId, esito })

            righe.push({
                id: crypto.randomUUID(),
                companyId: company,
                queueDate,
                marketingContactId: l.marketingContactId,
                leadId,
                posizione: l.posizione,
                motivoChiamata: l.motivoChiamata,
                punteggio: l.punteggio,
                funnelOrigine: l.funnelOrigine,
                dataIngresso: l.dataIngresso,
                esito,
                payload: l.raw,
            })
            eventi.push({
                id: crypto.randomUUID(),
                leadId,
                eventType: 'MARKETING_QUEUE',
                companyId: company,
                metadata: {
                    queueDate,
                    marketingContactId: l.marketingContactId,
                    posizione: l.posizione,
                    motivoChiamata: l.motivoChiamata,
                    esito,
                },
                timestamp: now,
            })
        }

        if (leadsDaCreare.length) await tx.insert(leads).values(leadsDaCreare)
        for (const c of daCollegare) {
            await tx.update(leads)
                .set({ marketingContactId: c.mk })
                .where(and(eq(leads.id, c.leadId), sql`${leads.marketingContactId} is null`))
        }
        await tx.insert(marketingQueueEntries).values(righe)
        await tx.insert(leadEvents).values(eventi)
    })

    for (const s of input.scartati) {
        dettaglio.push({ marketing_contact_id: s.marketing_contact_id, lead_id: null, esito: 'scartato' })
    }

    return {
        ok: true,
        data: queueDate,
        ricevuti: input.ricevuti,
        creati,
        aggiornati,
        scartati: input.scartati,
        dettaglio,
    }
}
