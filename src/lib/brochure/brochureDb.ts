// Letture della pagina /marketing-analytics/brochure (PO 10/11/2026).
// Non è un file "use server": non controlla il ruolo, lo fa la pagina.
//
// Costo: una query sui lead (filtro su utm, funnel e un EXISTS sugli eventi
// INBOUND_MESSAGE del lead, con indice su leadId), una sugli assegnatari e una
// chiamata al bot (`/api/bot/statistiche-bf`, la stessa del monitor Black
// Friday, firma HMAC, timeout breve). Il risultato sta in una cache di 45
// secondi condivisa fra chi guarda. Se il bot non risponde, le colonne della
// chat restano vuote e il resto della pagina c'è.

import { unstable_cache } from 'next/cache'
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadEvents, leads, users } from '@/db/schema'
import { leadVero } from '@/lib/prova/sql'
import { signPayload } from '@/lib/marketing-webhooks/signing'
import {
    FUNNEL_PROFESSIONI, UTM_BROCHURE_PG, calcolaBrochure, inizioRisposte, ingressoBrochure, nomeProfessione, professioneDaFrase, utmDaBrochure,
    type Brochure, type ChatBrochure, type LeadBrochure,
} from './brochure'

const FENICE = 'fenice'
/** Funnel Professioni in produzione dal 15/10/2026 (00:00 di Roma): prima non c'era la brochure. */
export const INIZIO_BROCHURE = new Date('2026-10-14T22:00:00Z')
export const CACHE_SECONDI = 45
export const TAG_BROCHURE = 'lead-brochure'
export const TIMEOUT_BOT_MS = 6000

/** Evento della frase del link: provenienza PROFESSIONI o testo "scheda del corso". */
const fraseBrochure = sql`(
    e."metadata"->>'provenienza' ILIKE 'professioni'
    OR e."metadata"->>'primoMessaggio' ILIKE '%scheda del corso%'
)`

/** Primo istante in cui il lead ha scritto la frase, o null. Nomi qualificati a mano (vedi monitorDb del BF). */
const scrittoIlFrase = sql<string | Date | null>`(
    select min((e."metadata"->>'scrittoIl')::timestamptz) from "leadEvents" e
    where e."leadId" = "leads"."id" and e."eventType" = 'INBOUND_MESSAGE' and ${fraseBrochure}
)`
const fraseScritta = sql<string | null>`(
    select e."metadata"->>'primoMessaggio' from "leadEvents" e
    where e."leadId" = "leads"."id" and e."eventType" = 'INBOUND_MESSAGE' and ${fraseBrochure}
    order by e."timestamp" limit 1
)`
/** Nota d'ingresso del lead entrante ("Interessato a: Graphic Designer"). */
const notaIngresso = sql<string | null>`(
    select e."metadata"->>'note' from "leadEvents" e
    where e."leadId" = "leads"."id" and e."eventType" = 'IMPORTED' and e."metadata"->>'note' ILIKE 'interessato a:%'
    order by e."timestamp" limit 1
)`

const comeData = (v: string | Date | null): Date | null => (v === null ? null : v instanceof Date ? v : new Date(v))

type RispostaBot = {
    ok?: boolean
    leads?: {
        crm_lead_id: string; con_chat: boolean; consegnato: boolean; risposto: boolean
        scheda_inviata_at?: string | null; professione?: string | null
    }[]
}

/** Stato delle chat dei lead brochure, dal bot. null = non leggibile. Mai lancia. */
export async function leggiChatBot(
    lead: { id: string; inizioRisposte: Date; phone: string }[],
    timeoutMs: number = TIMEOUT_BOT_MS,
): Promise<ChatBrochure[] | null> {
    const intake = process.env.BOT_INTAKE_URL
    const secret = process.env.BOT_WEBHOOK_SECRET
    if (!intake || !secret || lead.length === 0) return lead.length === 0 ? [] : null
    let url: string
    try { url = new URL('/api/bot/statistiche-bf', intake).toString() } catch { return null }
    const body = JSON.stringify({
        ts: new Date().toISOString(),
        dal: INIZIO_BROCHURE.toISOString(),
        // `ingresso` per il bot = da quando contare consegne e risposte (inizioRisposte).
        leads: lead.map(l => ({ id: l.id, ingresso: l.inizioRisposte.toISOString(), telefono: l.phone })),
    })
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-bot-signature': signPayload(body, secret) },
            body,
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) {
            console.error(`[lead brochure] bot HTTP ${res.status}`)
            return null
        }
        const j = (await res.json()) as RispostaBot
        if (!j.ok || !Array.isArray(j.leads)) return null
        return j.leads.map(l => ({
            leadId: l.crm_lead_id, conChat: l.con_chat, consegnato: l.consegnato, risposto: l.risposto,
            // Campi che il bot può non mandare: undefined resta undefined (= dato non disponibile).
            ...('scheda_inviata_at' in l ? { schedaInviataAt: l.scheda_inviata_at ?? null } : {}),
            ...('professione' in l ? { professione: l.professione ?? null } : {}),
        }))
    } catch (e) {
        console.error('[lead brochure] bot non raggiungibile', e)
        return null
    }
}

async function leggi(): Promise<Brochure> {
    const adesso = new Date()
    const utmBrochure = sql`concat_ws(' ', ${leads.utmSource}, ${leads.utmMedium}, ${leads.utmCampaign}, ${leads.utmContent}, ${leads.utmTerm}) ~* ${UTM_BROCHURE_PG}`

    // Prima gli id di chi ha scritto la frase (indice su eventType), poi i lead:
    // con la sottoquery dentro l'OR Postgres scorreva tutta la tabella leads.
    const conFrase = await db.selectDistinct({ id: leadEvents.leadId }).from(leadEvents).where(and(
        eq(leadEvents.eventType, 'INBOUND_MESSAGE'),
        sql`(${leadEvents.metadata}->>'provenienza' ILIKE 'professioni' OR ${leadEvents.metadata}->>'primoMessaggio' ILIKE '%scheda del corso%')`,
        sql`(${leadEvents.metadata}->>'scrittoIl')::timestamptz >= ${INIZIO_BROCHURE}`,
    ))
    const idFrase = conFrase.map(r => r.id)

    const righe = await db.select({
        id: leads.id, createdAt: leads.createdAt, phone: leads.phone, funnel: leads.funnel,
        utmSource: leads.utmSource, utmMedium: leads.utmMedium, utmCampaign: leads.utmCampaign,
        utmContent: leads.utmContent, utmTerm: leads.utmTerm,
        assignedToId: leads.assignedToId, appointmentDate: leads.appointmentDate,
        appointmentCreatedAt: leads.appointmentCreatedAt, confirmationsOutcome: leads.confirmationsOutcome,
        presentedAt: leads.presentedAt, salespersonOutcome: leads.salespersonOutcome, closeAmountEur: leads.closeAmountEur,
        scrittoIl: scrittoIlFrase, frase: fraseScritta, nota: notaIngresso,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        leadVero(),
        or(
            and(gte(leads.createdAt, INIZIO_BROCHURE), or(utmBrochure, sql`UPPER(COALESCE(${leads.funnel}, '')) = ${FUNNEL_PROFESSIONI}`)),
            idFrase.length > 0 ? inArray(leads.id, idFrase) : undefined,
        ),
    ))

    const lista: (LeadBrochure & { phone: string; inizioRisposte: Date })[] = []
    for (const r of righe) {
        const scrittoIl = comeData(r.scrittoIl)
        const daCampagna = utmDaBrochure([r.utmSource, r.utmMedium, r.utmCampaign, r.utmContent, r.utmTerm])
        // Dal 10/11/2026 (0c4463a) anche i lead AC della campagna entrano PROFESSIONI: il funnel
        // vale come "ha scritto la frase" solo per chi non arriva dalla campagna, altrimenti
        // finirebbero tutti fra "entrambi" e "solo campagna" resterebbe a zero.
        const haScrittoFrase = scrittoIl !== null || (!daCampagna && (r.funnel ?? '').trim().toUpperCase() === FUNNEL_PROFESSIONI)
        const ingresso = ingressoBrochure({ createdAt: r.createdAt, daCampagna, scrittoIl })
        if (ingresso < INIZIO_BROCHURE) continue
        lista.push({
            id: r.id,
            ingresso: ingresso.toISOString(),
            daCampagna,
            haScrittoFrase,
            professione: professioneDaFrase(r.frase) ?? nomeProfessione((r.nota ?? '').replace(/^interessato a:\s*/i, '')),
            assignedToId: r.assignedToId,
            // `appointmentCreatedAt` è il marcatore canonico di "fissato" (vedi getInboundSpontaneiStats).
            appuntamento: r.appointmentCreatedAt !== null || r.appointmentDate !== null,
            confermato: r.confirmationsOutcome === 'confermato',
            presente: r.presentedAt !== null,
            chiuso: r.salespersonOutcome === 'Chiuso',
            euro: r.salespersonOutcome === 'Chiuso' ? r.closeAmountEur ?? 0 : 0,
            phone: r.phone,
            inizioRisposte: inizioRisposte(ingresso, scrittoIl),
        })
    }

    const idAssegnatari = [...new Set(lista.flatMap(l => (l.assignedToId ? [l.assignedToId] : [])))]
    const [assegnatari, chat] = await Promise.all([
        idAssegnatari.length === 0 ? Promise.resolve([]) : db.select({
            id: users.id, firstName: users.firstName, name: users.name, displayName: users.displayName,
            gdoCode: users.gdoCode, isBot: users.isBot, role: users.role,
        }).from(users).where(inArray(users.id, idAssegnatari)),
        leggiChatBot(lista),
    ])

    return calcolaBrochure({
        adesso,
        inizio: INIZIO_BROCHURE,
        // Il telefono serve solo al bot: non entra nei conti né nella cache.
        leads: lista.map(({ phone: _p, inizioRisposte: _i, ...l }) => l),
        chat,
        assegnatari: assegnatari.map(u => {
            const nome = u.firstName?.trim() || u.displayName?.trim() || u.name?.trim() || 'Senza nome'
            return { id: u.id, nome: u.gdoCode ? `${nome} (${u.gdoCode})` : nome, bot: u.isBot, ruolo: u.role }
        }),
    })
}

const inCache = unstable_cache(leggi, ['lead-brochure-v1'], { revalidate: CACHE_SECONDI, tags: [TAG_BROCHURE] })

/** Numeri della pagina, in cache 45 secondi. null se la lettura non riesce. */
export async function leggiBrochure(): Promise<Brochure | null> {
    try {
        return await inCache()
    } catch (e) {
        console.error('[lead brochure] lettura', e)
        return null
    }
}
