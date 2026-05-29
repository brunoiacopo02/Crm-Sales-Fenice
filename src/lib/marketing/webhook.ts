// src/lib/marketing/webhook.ts
// Tipi payload CRM webhook + HMAC helpers (sender helper kept for symmetry).
// Il receiver lato sales NON è qui — l'ingest è in-process via crm-ingest.ts.

import { createHmac, timingSafeEqual } from 'crypto';

export function verifyHmac(secret: string, rawBody: string, signature: string): boolean {
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

// ─── CRM payload types ────────────────────────────────────────────────────────

export interface CrmLead {
    id: string;
    name: string;
    email: string;
    phone: string;
    funnel: string;           // "TELEGRAM" | "JOB SIMULATOR" | "CORSO 10 ORE" | "Database"
    source: string | null;
    createdAt: string;
    utm: {
        source: string | null;
        medium: string | null;
        campaign: string | null;
        content: string | null;
        term: string | null;
    };
}

export interface CrmAppointmentSet {
    eventId: string;
    eventType: 'appointment.set';
    occurredAt: string;
    apiVersion: string;
    lead: CrmLead;
    data?: Record<string, unknown>;
}

export interface CrmAppointmentOutcome {
    eventId: string;
    eventType: 'appointment.outcome';
    occurredAt: string;
    apiVersion: string;
    lead: CrmLead;
    data: {
        status: string;          // "NON_CONFERMATO" | "CONFERMATO" | ...
        rawOutcome: string;
        discardReason?: string;
        scheduledAt?: string;
    };
}

export interface CrmDealClosedWon {
    eventId: string;
    eventType: 'deal.closed_won';
    occurredAt: string;
    apiVersion: string;
    lead: CrmLead;
    data: {
        product: string;
        amountEur: number;
        closedAt: string;
        notes?: string;
        salesperson: {
            userId: string;
            displayName: string;
            role: string;
        };
    };
}

export interface CrmDealClosedLost {
    eventId: string;
    eventType: 'deal.closed_lost';
    occurredAt: string;
    apiVersion: string;
    lead: CrmLead;
    data?: Record<string, unknown>;
}

export type CrmEvent = CrmAppointmentSet | CrmAppointmentOutcome | CrmDealClosedWon | CrmDealClosedLost;

export function parseCrmEvent(raw: string): CrmEvent | null {
    try {
        return JSON.parse(raw) as CrmEvent;
    } catch {
        return null;
    }
}
