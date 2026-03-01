import { db } from "@/db"
import { leadEvents } from "@/db/schema"
import crypto from "crypto"

export type SectionName =
    | 'Prima Chiamata'
    | 'Seconda Chiamata'
    | 'Terza Chiamata'
    | 'Richiami'
    | 'Appuntamenti'
    | 'Scartati'
    | 'Nuovo'

export function determineLeadSection(lead: any): SectionName {
    if (lead.status === 'REJECTED') return 'Scartati'
    if (lead.status === 'APPOINTMENT') return 'Appuntamenti'
    if (lead.recallDate) return 'Richiami'

    if (lead.callCount === 1) return 'Seconda Chiamata'
    if (lead.callCount >= 2) return 'Terza Chiamata'

    return 'Prima Chiamata'
}

type LogEventParams = {
    leadId: string
    eventType: 'IMPORTED' | 'ASSIGNED' | 'CALL_LOGGED' | 'SECTION_MOVED' | 'DISCARDED' | 'RECALL_SET' | 'APPOINTMENT_SET'
    userId?: string | null
    fromSection?: SectionName | null
    toSection?: SectionName | null
    metadata?: any
}

export async function logLeadEvent(params: LogEventParams) {
    await db.insert(leadEvents).values({
        id: crypto.randomUUID(),
        leadId: params.leadId,
        eventType: params.eventType,
        userId: params.userId || null,
        fromSection: params.fromSection || null,
        toSection: params.toSection || null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        timestamp: new Date()
    })
}
