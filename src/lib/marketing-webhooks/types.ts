// Event taxonomy per i webhook al CRM marketing esterno.
// Vedi docs/superpowers/specs/2026-05-07-marketing-webhooks-design.md

export type MarketingEventType =
    | 'appointment.set'
    | 'appointment.rescheduled'
    | 'appointment.outcome'
    | 'deal.assigned'
    | 'deal.closed_won'
    | 'deal.closed_lost';

export const ALL_EVENT_TYPES: MarketingEventType[] = [
    'appointment.set',
    'appointment.rescheduled',
    'appointment.outcome',
    'deal.assigned',
    'deal.closed_won',
    'deal.closed_lost',
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

export type EventData =
    | AppointmentSetData
    | AppointmentRescheduledData
    | AppointmentOutcomeData
    | DealAssignedData
    | DealClosedWonData
    | DealClosedLostData;

export interface MarketingWebhookEnvelope extends BaseEnvelope {
    data: EventData;
}
