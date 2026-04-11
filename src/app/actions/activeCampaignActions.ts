'use server'

import { db } from "@/db"
import { leads } from "@/db/schema"
import { eq } from "drizzle-orm"
import { createClient } from "@/utils/supabase/server"
import { logLeadEvent } from "@/lib/eventLogger"

// ActiveCampaign configuration
const AC_URL = process.env.ACTIVECAMPAIGN_URL || 'https://feniceacademy0089903.api-us1.com'
const AC_KEY = process.env.ACTIVECAMPAIGN_API_KEY || '72ca1b215ab41d91b1f3b41682bef0f70817aeb4eac51d9e269a1484a01325ed22d2af20'
const AC_AUTOMATION_ID = process.env.ACTIVECAMPAIGN_AGENDA_AUTOMATION_ID || '248'

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
    emailOverride?: string // If lead has no email, GDO provides one at submit time
}

export type SendAgendaResult = {
    success: boolean
    error?: string
    alreadySent?: boolean
}

/**
 * Invia l'agenda Calendly tramite automazione ActiveCampaign (che usa Spoki per WhatsApp).
 * - Cerca il contatto in AC per email, se non esiste lo crea
 * - Aggiunge i tag in base alla situazione del lead (lavora/famiglia)
 * - Aggiunge il contatto all'automazione 248 che invia messaggio + VSL dopo 5 min
 */
export async function sendAgendaToLead(
    leadId: string,
    options: SendAgendaOptions
): Promise<SendAgendaResult> {
    // Auth check
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    if (!supabaseUser) return { success: false, error: 'Non autenticato' }

    // Fetch lead
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId))
    if (!lead) return { success: false, error: 'Lead non trovato' }

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
                .where(eq(leads.id, leadId))
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
            .where(eq(leads.id, leadId))

        // 5. Log event
        await logLeadEvent({
            leadId,
            eventType: 'AGENDA_SENT',
            userId: supabaseUser.id,
            metadata: {
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
