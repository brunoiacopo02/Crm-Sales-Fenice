import { NextResponse } from 'next/server';
import { and, eq, gte, lte, gt, isNotNull, asc, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { leads, users } from '@/db/schema';
import {
    buildAppointmentSet,
    buildAppointmentOutcome,
    buildDealAssigned,
    buildDealClosedWon,
    buildDealClosedLost,
} from '@/lib/marketing-webhooks/payload-builders';
import type { MarketingEventType, MarketingWebhookEnvelope } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

type ActorMin = { id: string; name: string | null; displayName: string | null; role: string };

export async function GET(req: Request) {
    const auth = req.headers.get('authorization');
    const expected = process.env.MARKETING_PULL_API_TOKEN;
    if (!expected) return NextResponse.json({ error: 'pull_disabled' }, { status: 503 });
    if (auth !== `Bearer ${expected}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const since = url.searchParams.get('since');
    const until = url.searchParams.get('until');
    const funnel = url.searchParams.get('funnel');
    const eventType = url.searchParams.get('eventType') as MarketingEventType | null;
    const cursor = url.searchParams.get('cursor');
    const limitRaw = parseInt(url.searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10);
    const limit = Math.min(Math.max(1, Number.isNaN(limitRaw) ? DEFAULT_LIMIT : limitRaw), MAX_LIMIT);

    const conditions: SQL[] = [];

    let dateField: AnyPgColumn = leads.updatedAt;
    if (eventType === 'appointment.set') {
        dateField = leads.appointmentCreatedAt;
        conditions.push(isNotNull(leads.appointmentDate));
    } else if (eventType === 'appointment.outcome') {
        dateField = leads.confirmationsTimestamp;
        conditions.push(isNotNull(leads.confirmationsOutcome));
    } else if (eventType === 'deal.assigned') {
        dateField = leads.salespersonAssignedAt;
        conditions.push(isNotNull(leads.salespersonUserId));
    } else if (eventType === 'deal.closed_won') {
        dateField = leads.salespersonOutcomeAt;
        conditions.push(eq(leads.salespersonOutcome, 'Chiuso'));
    } else if (eventType === 'deal.closed_lost') {
        dateField = leads.salespersonOutcomeAt;
    }

    if (since) conditions.push(gte(dateField, new Date(since)));
    if (until) conditions.push(lte(dateField, new Date(until)));
    if (funnel) conditions.push(eq(leads.funnel, funnel));
    if (cursor) conditions.push(gt(leads.id, cursor));

    const rows = await db.select().from(leads)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(leads.id))
        .limit(limit + 1);

    let filtered = rows;
    if (eventType === 'deal.closed_lost') {
        filtered = rows.filter(l => l.salespersonOutcome === 'Non chiuso' || l.salespersonOutcome === 'Sparito');
    }

    const hasMore = filtered.length > limit;
    const items = filtered.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const actorIds = new Set<string>();
    for (const l of items) {
        if (l.assignedToId) actorIds.add(l.assignedToId);
        if (l.confirmationsUserId) actorIds.add(l.confirmationsUserId);
        if (l.salespersonUserId) actorIds.add(l.salespersonUserId);
    }
    const actorsMap = new Map<string, ActorMin>();
    if (actorIds.size > 0) {
        const us = await db.select({
            id: users.id, name: users.name, displayName: users.displayName, role: users.role,
        }).from(users);
        for (const u of us) {
            if (actorIds.has(u.id)) actorsMap.set(u.id, u);
        }
    }

    const envelopes: MarketingWebhookEnvelope[] = items.map(lead => {
        const actorByEvent = (actorId: string | null) => ({
            lead,
            actor: actorId ? (actorsMap.get(actorId) ?? null) : null,
        });
        switch (eventType) {
            case 'appointment.set':       return buildAppointmentSet(actorByEvent(lead.assignedToId));
            case 'appointment.outcome':   return buildAppointmentOutcome(actorByEvent(lead.confirmationsUserId));
            case 'deal.assigned':         return buildDealAssigned(actorByEvent(lead.salespersonUserId));
            case 'deal.closed_won':       return buildDealClosedWon(actorByEvent(lead.salespersonUserId));
            case 'deal.closed_lost':      return buildDealClosedLost(actorByEvent(lead.salespersonUserId));
            default:
                if (lead.salespersonOutcome === 'Chiuso')
                    return buildDealClosedWon(actorByEvent(lead.salespersonUserId));
                if (lead.salespersonOutcome === 'Non chiuso' || lead.salespersonOutcome === 'Sparito')
                    return buildDealClosedLost(actorByEvent(lead.salespersonUserId));
                if (lead.salespersonUserId)
                    return buildDealAssigned(actorByEvent(lead.salespersonUserId));
                if (lead.confirmationsOutcome)
                    return buildAppointmentOutcome(actorByEvent(lead.confirmationsUserId));
                if (lead.appointmentDate)
                    return buildAppointmentSet(actorByEvent(lead.assignedToId));
                return null;
        }
    }).filter((x): x is MarketingWebhookEnvelope => x !== null);

    return NextResponse.json({ items: envelopes, nextCursor, hasMore });
}
