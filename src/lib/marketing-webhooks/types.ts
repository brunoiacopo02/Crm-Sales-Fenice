// Event taxonomy per i webhook al CRM marketing esterno.
// Vedi docs/superpowers/specs/2026-05-07-marketing-webhooks-design.md

import type { DiscardReasonCode } from './discard-reasons';

export type MarketingEventType =
    | 'appointment.set'
    | 'appointment.rescheduled'
    | 'appointment.outcome'
    | 'deal.assigned'
    | 'deal.closed_won'
    | 'deal.closed_lost'
    | 'lead.rejected';

export const ALL_EVENT_TYPES: MarketingEventType[] = [
    'appointment.set',
    'appointment.rescheduled',
    'appointment.outcome',
    'deal.assigned',
    'deal.closed_won',
    'deal.closed_lost',
    'lead.rejected',
];

export interface ActorRef {
    userId: string;
    displayName: string | null;
    role: string;
}

export interface LeadEnvelope {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    funnel: string | null;
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

export interface BaseEnvelope {
    eventId: string;
    eventType: MarketingEventType;
    occurredAt: string;
    apiVersion: '1';
    lead: LeadEnvelope;
}

export interface AppointmentSetData {
    appointmentDate: string;
    appointmentNote: string | null;
    appointmentCreatedAt: string | null;
    callCount: number;
    setBy: ActorRef | null;
}

export interface AppointmentRescheduledData {
    previousAppointmentDate: string;
    newAppointmentDate: string;
    rescheduledAt: string;
    rescheduledBy: ActorRef | null;
}

export interface AppointmentOutcomeData {
    status: 'CONFERMATO' | 'NON_CONFERMATO' | 'DA_RIFISSARE';
    rawOutcome: string;
    discardReason: string | null;
    decidedAt: string;
    appointmentDate: string | null;
    decidedBy: ActorRef | null;
}

export interface DealAssignedData {
    assignedAt: string;
    salesperson: ActorRef | null;
}

export interface DealClosedWonData {
    closedAt: string;
    product: string | null;
    amountEur: number | null;
    notes: string | null;
    salesperson: ActorRef | null;
}

export interface DealClosedLostData {
    closedAt: string;
    outcome: string;
    reason: string | null;
    notes: string | null;
    salesperson: ActorRef | null;
}

/** Stadio del funnel in cui il lead e' morto. */
export type RejectionStage = 'GDO' | 'CONFERME';

export interface LeadRejectedData {
    stage: RejectionStage;
    /** true solo per l'auto-scarto dopo il terzo tentativo a vuoto. */
    automatic: boolean;
    reasonCode: DiscardReasonCode;
    reasonLabel: string;
    /** La stringa esatta a DB. Serve quando reasonCode e' OTHER. */
    rawReason: string | null;
    callCount: number;
    /** true se a scartare e' stato il bot fissatore e non un operatore. */
    byBot: boolean;
    rejectedAt: string;
    rejectedBy: ActorRef | null;
}

export type EventData =
    | AppointmentSetData
    | AppointmentRescheduledData
    | AppointmentOutcomeData
    | DealAssignedData
    | DealClosedWonData
    | DealClosedLostData
    | LeadRejectedData;

export interface MarketingWebhookEnvelope extends BaseEnvelope {
    data: EventData;
}
