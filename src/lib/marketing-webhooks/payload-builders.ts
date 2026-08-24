import crypto from 'node:crypto';
import type { InferSelectModel } from 'drizzle-orm';
import type { leads, users } from '@/db/schema';
import { discardReasonCode, discardReasonLabel } from './discard-reasons';
import type {
    MarketingWebhookEnvelope,
    MarketingEventType,
    LeadEnvelope,
    ActorRef,
    AppointmentSetData,
    AppointmentRescheduledData,
    AppointmentOutcomeData,
    DealAssignedData,
    DealClosedWonData,
    DealClosedLostData,
    LeadRejectedData,
    RejectionStage,
} from './types';

type Lead = InferSelectModel<typeof leads>;
type User = InferSelectModel<typeof users>;

/**
 * eventId deterministico: SHA-256 di (eventType + leadId + bucket) come UUID-shape.
 *
 * Bucket granularity:
 * - `appointment.set` → UTC day (YYYY-MM-DD). Re-fissaggi multipli stesso giorno
 *   collidono sul PK outbox (ON CONFLICT DO NOTHING) → marketing riceve un solo
 *   evento per lead per giorno. La semantica "il lead ha fissato un appuntamento
 *   oggi" è ciò che il marketing usa per attribution; il numero di re-fissaggi è
 *   rumore operativo.
 * - Altri eventType → granularità al secondo. Cambi di esito legittimi (es.
 *   appointment.outcome confermato→rifissare) devono propagarsi.
 */
export function deterministicEventId(
    eventType: MarketingEventType,
    leadId: string,
    occurredAt: Date
): string {
    let bucket: string;
    if (eventType === 'appointment.set') {
        const y = occurredAt.getUTCFullYear();
        const m = String(occurredAt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(occurredAt.getUTCDate()).padStart(2, '0');
        bucket = `day:${y}-${m}-${d}`;
    } else {
        bucket = `s:${Math.floor(occurredAt.getTime() / 1000)}`;
    }
    const seed = `${eventType}|${leadId}|${bucket}`;
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export interface RescheduleContext {
    lead: Lead;
    actor?: Pick<User, 'id' | 'displayName' | 'name' | 'role'> | null;
    occurredAt?: Date;
    previousAppointmentDate: Date;
    newAppointmentDate: Date;
}

export function buildAppointmentRescheduled(ctx: RescheduleContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date(), previousAppointmentDate, newAppointmentDate } = ctx;
    const data: AppointmentRescheduledData = {
        previousAppointmentDate: previousAppointmentDate.toISOString(),
        newAppointmentDate: newAppointmentDate.toISOString(),
        rescheduledAt: occurredAt.toISOString(),
        rescheduledBy: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('appointment.rescheduled', lead.id, occurredAt),
        eventType: 'appointment.rescheduled',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

function actorFromUser(u: Pick<User, 'id' | 'displayName' | 'name' | 'role'> | null | undefined): ActorRef | null {
    if (!u) return null;
    return {
        userId: u.id,
        displayName: u.displayName ?? u.name ?? null,
        role: u.role,
    };
}

function leadEnvelope(lead: Lead): LeadEnvelope {
    return {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        funnel: lead.funnel,
        source: lead.source,
        createdAt: lead.createdAt.toISOString(),
        utm: {
            source: lead.utmSource,
            medium: lead.utmMedium,
            campaign: lead.utmCampaign,
            content: lead.utmContent,
            term: lead.utmTerm,
        },
    };
}

export interface BuildContext {
    lead: Lead;
    actor?: Pick<User, 'id' | 'displayName' | 'name' | 'role'> | null;
    occurredAt?: Date;
}

export function buildAppointmentSet(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    if (!lead.appointmentDate) {
        throw new Error(`buildAppointmentSet: lead ${lead.id} has no appointmentDate`);
    }
    const data: AppointmentSetData = {
        appointmentDate: lead.appointmentDate.toISOString(),
        appointmentNote: lead.appointmentNote,
        appointmentCreatedAt: lead.appointmentCreatedAt?.toISOString() ?? null,
        callCount: lead.callCount,
        setBy: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('appointment.set', lead.id, occurredAt),
        eventType: 'appointment.set',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

function mapConfirmationsOutcome(raw: string | null): AppointmentOutcomeData['status'] {
    if (raw === 'confermato') return 'CONFERMATO';
    if (raw === 'scartato') return 'NON_CONFERMATO';
    return 'DA_RIFISSARE';
}

export function buildAppointmentOutcome(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: AppointmentOutcomeData = {
        status: mapConfirmationsOutcome(lead.confirmationsOutcome),
        rawOutcome: lead.confirmationsOutcome ?? '',
        discardReason: lead.confirmationsDiscardReason,
        decidedAt: (lead.confirmationsTimestamp ?? occurredAt).toISOString(),
        appointmentDate: lead.appointmentDate?.toISOString() ?? null,
        decidedBy: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('appointment.outcome', lead.id, occurredAt),
        eventType: 'appointment.outcome',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

export function buildDealAssigned(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: DealAssignedData = {
        assignedAt: (lead.salespersonAssignedAt ?? occurredAt).toISOString(),
        salesperson: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('deal.assigned', lead.id, occurredAt),
        eventType: 'deal.assigned',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

export function buildDealClosedWon(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: DealClosedWonData = {
        closedAt: (lead.salespersonOutcomeAt ?? occurredAt).toISOString(),
        product: lead.closeProduct,
        amountEur: lead.closeAmountEur,
        notes: lead.salespersonOutcomeNotes,
        salesperson: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('deal.closed_won', lead.id, occurredAt),
        eventType: 'deal.closed_won',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

export function buildDealClosedLost(ctx: BuildContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date() } = ctx;
    const data: DealClosedLostData = {
        closedAt: (lead.salespersonOutcomeAt ?? occurredAt).toISOString(),
        outcome: lead.salespersonOutcome ?? '',
        reason: lead.notClosedReason,
        notes: lead.salespersonOutcomeNotes,
        salesperson: actorFromUser(actor),
    };
    return {
        eventId: deterministicEventId('deal.closed_lost', lead.id, occurredAt),
        eventType: 'deal.closed_lost',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}

export interface RejectionContext extends BuildContext {
    stage: RejectionStage;
    automatic: boolean;
    byBot: boolean;
}

/**
 * Evento canonico "questo lead e' morto, ed ecco perche'".
 *
 * La causale sta su due colonne diverse a seconda dello stadio: i GDO scrivono
 * leads.discardReason, le Conferme leads.confirmationsDiscardReason. Un lead
 * scartato dalle Conferme puo' avere valorizzate entrambe (e' passato per i GDO
 * prima), quindi lo stage decide quale leggere — non si puo' fare COALESCE.
 */
export function buildLeadRejected(ctx: RejectionContext): MarketingWebhookEnvelope {
    const { lead, actor, occurredAt = new Date(), stage, automatic, byBot } = ctx;
    const raw = stage === 'CONFERME' ? lead.confirmationsDiscardReason : lead.discardReason;

    const data: LeadRejectedData = {
        stage,
        automatic,
        reasonCode: discardReasonCode(raw),
        reasonLabel: discardReasonLabel(raw),
        rawReason: raw,
        callCount: lead.callCount,
        byBot,
        rejectedAt: occurredAt.toISOString(),
        rejectedBy: actorFromUser(actor),
    };

    return {
        eventId: deterministicEventId('lead.rejected', lead.id, occurredAt),
        eventType: 'lead.rejected',
        occurredAt: occurredAt.toISOString(),
        apiVersion: '1',
        lead: leadEnvelope(lead),
        data,
    };
}
