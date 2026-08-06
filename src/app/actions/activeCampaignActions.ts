'use server'

import { db } from "@/db"
import { leads } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { logLeadEvent } from "@/lib/eventLogger"
import { currentTenant, assertSalesArea } from '@/lib/tenancy'
import { sendSerenamenteTemplate, SERENAMENTE_TEMPLATE_NR, SERENAMENTE_TEMPLATE_AUTOCONFERMA } from "@/lib/serenamenteMessaging"
import { sendAgendaViaBot, type AgendaEsito } from "@/lib/agendaBot"

// ActiveCampaign configuration
const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com'
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || '72ca1b215ab41d91b1f3b41682bef0f70817aeb4eac51d9e269a1484a01325ed22d2af20'
const AC_AUTOMATION_ID = process.env.ACTIVECAMPAIGN_AGENDA_AUTOMATION_ID || '248'
const AC_CONFERME_NOTIFY_AUTOMATION_ID = process.env.ACTIVECAMPAIGN_CONFERME_NOTIFY_ID || '319'
const AC_CONFERME_NOTIFY_3NR_AUTOMATION_ID = process.env.ACTIVECAMPAIGN_CONFERME_NOTIFY_3NR_ID || '270'

// Tag IDs (verified via API)
const TAG_IDS = {
    lavora: 272,
    non_lavora: 270,
    ha_famiglia: 269,
    non_ha_famiglia: 271,
    off1: 280,
}

type AcRequestOptions = {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
}

async function acRequest(path: string, options: AcRequestOptions = {}): Promise<any> {
    const res = await fetch(`${AC_URL}/api/3${path}`, {
        method: options.method || 'GET',
        headers: {
            'Api-Token': AC_KEY,
            'Content-Type': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const text = await res.text()
    if (!res.ok) {
        throw new Error(`ActiveCampaign API ${res.status}: ${text.substring(0, 200)}`)
    }
    return text ? JSON.parse(text) : {}
}

async function findContactByEmail(email: string): Promise<string | null> {
    const data = await acRequest(`/contacts?email=${encodeURIComponent(email)}`)
    if (data.contacts && data.contacts.length > 0) {
        return data.contacts[0].id
    }
    return null
}

async function createContact(email: string, phone: string, firstName: string): Promise<string> {
    const data = await acRequest('/contacts', {
        method: 'POST',
        body: {
            contact: {
                email,
                phone,
                firstName,
            },
        },
    })
    return data.contact.id
}

async function addTagToContact(contactId: string, tagId: number): Promise<void> {
    await acRequest('/contactTags', {
        method: 'POST',
        body: {
            contactTag: {
                contact: contactId,
                tag: String(tagId),
            },
        },
    })
}

async function addContactToAutomation(contactId: string, automationId: string): Promise<void> {
    await acRequest('/contactAutomations', {
        method: 'POST',
        body: {
            contactAutomation: {
                contact: contactId,
                automation: automationId,
            },
        },
    })
}

export type SendAgendaOptions = {
    lavora: boolean
    haFamiglia: boolean
    offertaDelMese?: boolean // If true, sends OFF1 tag only (skips Lavora/Famiglia)
    emailOverride?: string // Solo per il fallback ActiveCampaign: il modale non la chiede più
}

export type SendAgendaResult = {
    success: boolean
    error?: string
    alreadySent?: boolean
    esito?: AgendaEsito      // valorizzato solo dal canale bot
    deduplicato?: boolean
    /** Variante corretta entro la finestra di deduplica: il video giusto partirà alla risposta. */
    varianteAggiornata?: boolean
    /** Il video sbagliato è GIÀ partito: solo il GDO può rimediare, parlandone col lead. */
    videoGiaInviato?: boolean
}

// Per decisione del PO l'interfaccia del GDO non deve mai lasciar intuire che
// dietro l'invio c'è un bot: il dettaglio tecnico resta nei log e nell'evento.
const GENERIC_SEND_ERROR = 'Invio agenda fallito. Riprova tra qualche istante.'

/**
 * Invia l'agenda al lead. Il canale è deciso da AGENDA_CHANNEL su Vercel:
 *  - 'bot' → endpoint /api/send-agenda del fornitore (canale attuale)
 *  - qualunque altro valore o assente → ActiveCampaign/Spoki (fallback storico)
 *
 * Il default è ActiveCampaign di proposito: il deploy non cambia comportamento,
 * il passaggio al bot è una variabile d'ambiente da girare quando si è pronti,
 * e il rientro è altrettanto immediato senza deploy.
 *
 * Nota sul fallback: il modale non raccoglie più l'email, quindi su AC i lead
 * senza email a database falliranno. Accettabile per una leva d'emergenza.
 */
export async function sendAgendaToLead(
    leadId: string,
    options: SendAgendaOptions
): Promise<SendAgendaResult> {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    // Auth check
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    if (!supabaseUser) return { success: false, error: 'Non autenticato' }

    // Fetch lead
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId)))
    if (!lead) return { success: false, error: 'Lead non trovato' }

    // Rete di sicurezza: i lead non-Fenice (es. Serenamente) NON devono passare da
    // qui. Su ActiveCampaign il contatto finirebbe nell'AC Fenice e il webhook
    // creerebbe un duplicato; sull'endpoint bot verrebbero comunque respinti con 403
    // (accetta solo companyId "fenice"). Per Serenamente l'agenda va via Twilio
    // (AgendaButton usa già sendAgendaSerenamente); questo blocca chiamate errate.
    if (ctx.companyId !== 'fenice') {
        return { success: false, error: `Lead ${ctx.companyId}: l'agenda va inviata col flusso dedicato (Twilio), non con questo canale.` }
    }

    if (process.env.AGENDA_CHANNEL === 'bot') {
        return sendAgendaViaBotChannel(lead, options, supabaseUser.id, ctx.companyId)
    }
    return sendAgendaViaActiveCampaign(lead, options, supabaseUser.id, ctx.companyId)
}

/**
 * Canale bot. La differenza sostanziale rispetto ad ActiveCampaign è che qui
 * l'esito è REALE e sincrono: `agendaSentAt` si scrive solo se il messaggio è
 * davvero partito. Su 'fallito' non si scrive nulla e non si logga AGENDA_SENT —
 * era proprio il falso positivo di AC/Spoki a nascondere il problema per settimane.
 */
async function sendAgendaViaBotChannel(
    lead: typeof leads.$inferSelect,
    options: SendAgendaOptions,
    userId: string,
    companyId: string,
): Promise<SendAgendaResult> {
    const wasSent = lead.agendaSentAt !== null

    const r = await sendAgendaViaBot({
        leadId: lead.id,
        phone: lead.phone,
        name: lead.name,
        email: lead.email,
        funnel: lead.funnel,
        variant: {
            lavora: !!options.lavora,
            haFamiglia: !!options.haFamiglia,
            offertaDelMese: !!options.offertaDelMese,
        },
        // Di norma è ancora vuoto (l'esito APPUNTAMENTO arriva dopo l'agenda) e
        // la data la manda notifyAppointmentToBot; qui serve per i reinvii su
        // lead già fissati, dove invece è nota fin da subito.
        appointmentAt: lead.appointmentDate,
    })

    if (!r.ok) {
        // Errore di trasporto/protocollo: non sappiamo se il messaggio sia partito,
        // quindi non tocchiamo né agendaSentAt né agendaStatus.
        console.error(`[agenda] invio fallito (${r.kind}) per lead ${lead.id}: ${r.error}`)
        return { success: false, error: GENERIC_SEND_ERROR }
    }

    if (r.esito === 'fallito') {
        // Risposta valida a una consegna non riuscita: numero non su WhatsApp,
        // template bloccato, Twilio giù. Tracciamo lo stato per la UI (il pulsante
        // diventa rosso e il reinvio resta permesso) ma NON logghiamo AGENDA_SENT:
        // quell'evento alimenta le statistiche e conterebbe un invio mai avvenuto.
        await db.update(leads)
            .set({ agendaStatus: 'fallito' })
            .where(and(eq(leads.id, lead.id), eq(leads.companyId, companyId)))
        console.error(`[agenda] esito fallito per lead ${lead.id}: ${r.message ?? '—'}`)
        return { success: false, error: GENERIC_SEND_ERROR, esito: 'fallito' }
    }

    // consegnato | inviato → il messaggio è partito.
    await db.update(leads)
        .set({ agendaSentAt: new Date(), agendaStatus: r.esito })
        .where(and(eq(leads.id, lead.id), eq(leads.companyId, companyId)))

    await logLeadEvent({
        leadId: lead.id,
        eventType: 'AGENDA_SENT',
        userId,
        metadata: {
            channel: 'bot',
            esito: r.esito,
            deduplicato: r.deduplicato,
            varianteAggiornata: r.varianteAggiornata,
            videoGiaInviato: r.videoGiaInviato,
            conversationId: r.conversationId,
            sid: r.sid,
            offertaDelMese: !!options.offertaDelMese,
            lavora: options.offertaDelMese ? null : options.lavora,
            haFamiglia: options.offertaDelMese ? null : options.haFamiglia,
            resend: wasSent,
        },
        companyId,
    })

    return {
        success: true,
        alreadySent: wasSent,
        esito: r.esito,
        deduplicato: r.deduplicato,
        varianteAggiornata: r.varianteAggiornata,
        videoGiaInviato: r.videoGiaInviato,
    }
}

/**
 * Fallback storico: automazione ActiveCampaign 248, che spedisce via Spoki.
 * - Cerca il contatto in AC per email, se non esiste lo crea
 * - Aggiunge i tag in base alla situazione del lead (lavora/famiglia)
 * - Aggiunge il contatto all'automazione che invia messaggio + VSL dopo 5 min
 *
 * Attenzione: AC risponde 2xx anche quando Spoki non spedisce, quindi qui il
 * successo NON garantisce la consegna. È il motivo per cui questo canale è stato
 * sostituito; resta solo come leva di emergenza.
 */
async function sendAgendaViaActiveCampaign(
    lead: typeof leads.$inferSelect,
    options: SendAgendaOptions,
    userId: string,
    companyId: string,
): Promise<SendAgendaResult> {
    const leadId = lead.id
    const ctx = { companyId }
    // Use lead email or override provided by GDO
    const emailToUse = lead.email || options.emailOverride
    if (!emailToUse) {
        return { success: false, error: 'Email mancante — richiedere email al GDO' }
    }
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToUse)) {
        return { success: false, error: 'Formato email non valido' }
    }

    try {
        // If lead had no email and GDO provided one, save it to the lead for future use
        if (!lead.email && options.emailOverride) {
            await db.update(leads)
                .set({ email: options.emailOverride })
                .where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId)))
        }

        // 1. Find or create contact
        let contactId = await findContactByEmail(emailToUse)
        if (!contactId) {
            contactId = await createContact(emailToUse, lead.phone, lead.name)
        }

        // 2. Add tags
        // Special "offerta del mese" path: only OFF1 tag (mutually exclusive with normal flow)
        if (options.offertaDelMese) {
            await addTagToContact(contactId, TAG_IDS.off1)
        } else {
            const workTag = options.lavora ? TAG_IDS.lavora : TAG_IDS.non_lavora
            const familyTag = options.haFamiglia ? TAG_IDS.ha_famiglia : TAG_IDS.non_ha_famiglia
            await addTagToContact(contactId, workTag)
            await addTagToContact(contactId, familyTag)
        }

        // 3. Add contact to automation
        await addContactToAutomation(contactId, AC_AUTOMATION_ID)

        // 4. Update lead with timestamp
        await db.update(leads)
            .set({ agendaSentAt: new Date() })
            .where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId)))

        // 5. Log event
        await logLeadEvent({
            leadId,
            eventType: 'AGENDA_SENT',
            userId,
            metadata: {
                channel: 'activecampaign',
                contactId,
                offertaDelMese: !!options.offertaDelMese,
                lavora: options.offertaDelMese ? null : options.lavora,
                haFamiglia: options.offertaDelMese ? null : options.haFamiglia,
                resend: lead.agendaSentAt !== null,
            },
        })

        return { success: true, alreadySent: lead.agendaSentAt !== null }
    } catch (error: any) {
        console.error('sendAgendaToLead error:', error)
        return { success: false, error: error.message || 'Errore invio agenda' }
    }
}

export type SendConfermeNotifyResult = {
    success: boolean
    error?: string
}

export type ConfermeNotifyType = 'call1' | '3nr'

/**
 * Notifica al lead via WhatsApp/Spoki tramite automazione ActiveCampaign.
 * - 'call1': automation 319 "sms spoki1 per notifica call 1" (dopo prima NR)
 * - '3nr': automation 270 "conferma-appuntamento-spoki" (dopo 3 NR)
 * Solo per ruolo CONFERME/MANAGER/ADMIN.
 */
export async function sendConfermeNotifyToLead(
    leadId: string,
    type: ConfermeNotifyType = 'call1'
): Promise<SendConfermeNotifyResult> {
    const ctx = await currentTenant(); assertSalesArea(ctx);
    // Auth check — only CONFERME role
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    if (!supabaseUser) return { success: false, error: 'Non autenticato' }

    const role = supabaseUser.user_metadata?.role
    if (role !== 'CONFERME' && role !== 'MANAGER' && role !== 'ADMIN') {
        return { success: false, error: 'Solo le Conferme possono inviare questa notifica' }
    }

    // Fetch lead
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.companyId, ctx.companyId)))
    if (!lead) return { success: false, error: 'Lead non trovato' }

    // Serenamente: NON usa ActiveCampaign/Spoki di Fenice. Invia il template via Twilio.
    // call1 → template "nr"; 3nr → template "autoconferma". Serve solo il telefono.
    if (ctx.companyId === 'serenamente') {
        const parts = (lead.name || '').trim().split(/\s+/).filter(Boolean)
        const r = await sendSerenamenteTemplate({
            phone: lead.phone || '',
            templateSid: type === '3nr' ? SERENAMENTE_TEMPLATE_AUTOCONFERMA : SERENAMENTE_TEMPLATE_NR,
            label: type === '3nr' ? 'Conferma — autoconferma (3° NR)' : 'Conferma — no risposta 1ª chiamata',
            firstName: parts[0] || undefined,
            lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
        })
        if (!r.ok) return { success: false, error: r.error || 'Errore invio template Serenamente' }
        await logLeadEvent({
            leadId,
            eventType: 'AGENDA_SENT',
            userId: supabaseUser.id,
            metadata: { channel: 'twilio', type: type === '3nr' ? 'conferme_notify_3nr' : 'conferme_notify_call1', sid: r.sid ?? null },
            companyId: ctx.companyId,
        })
        return { success: true }
    }

    if (!lead.email) return { success: false, error: 'Il lead non ha email — impossibile creare contatto AC' }

    const automationId = type === '3nr'
        ? AC_CONFERME_NOTIFY_3NR_AUTOMATION_ID
        : AC_CONFERME_NOTIFY_AUTOMATION_ID

    try {
        // 1. Find or create contact
        let contactId = await findContactByEmail(lead.email)
        if (!contactId) {
            contactId = await createContact(lead.email, lead.phone, lead.name)
        }

        // 2. Add to notify automation
        await addContactToAutomation(contactId, automationId)

        // 3. Log event
        await logLeadEvent({
            leadId,
            eventType: 'AGENDA_SENT', // reuse existing event type with metadata flag
            userId: supabaseUser.id,
            metadata: {
                contactId,
                type: type === '3nr' ? 'conferme_notify_3nr' : 'conferme_notify_call1',
                automationId,
            },
        })

        return { success: true }
    } catch (error: any) {
        console.error('sendConfermeNotifyToLead error:', error)
        return { success: false, error: error.message || 'Errore invio notifica' }
    }
}
