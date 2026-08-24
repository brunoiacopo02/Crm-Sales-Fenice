import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { enqueueMarketingWebhook, type EnqueueInput } from '@/lib/marketing-webhooks/enqueue';
import { ALL_EVENT_TYPES } from '@/lib/marketing-webhooks/types';
import type { MarketingEventType, RejectionStage } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/marketing/debug/send-test
 * Body: { eventType: MarketingEventType, leadId: string, rejection?: { stage?, automatic?, byBot? } }
 *
 * MANAGER/ADMIN only. Forza l'enqueue di un evento contro la URL configurata.
 * Utile per QA prima del go-live.
 *
 * `lead.rejected` richiede un contesto `rejection` che non e' derivabile dal
 * solo leadId (vedi enqueueMarketingWebhook): lo accettiamo dal body con
 * default ragionevoli (stage GDO, non automatico, non bot) cosi' un test
 * rapido non richiede di popolare ogni campo.
 */
export async function POST(req: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const role = user.user_metadata?.role;
    if (role !== 'MANAGER' && role !== 'ADMIN') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: {
        eventType?: string;
        leadId?: string;
        rejection?: { stage?: string; automatic?: boolean; byBot?: boolean };
    };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'bad_json' }, { status: 400 });
    }

    if (!body.eventType || !body.leadId) {
        return NextResponse.json({ error: 'missing_eventType_or_leadId' }, { status: 400 });
    }

    if (!ALL_EVENT_TYPES.includes(body.eventType as MarketingEventType)) {
        return NextResponse.json({
            error: 'invalid_eventType',
            allowed: ALL_EVENT_TYPES,
        }, { status: 400 });
    }

    const enqueueInput: EnqueueInput = {
        eventType: body.eventType as MarketingEventType,
        leadId: body.leadId,
        actorUserId: user.id,
    };

    if (body.eventType === 'lead.rejected') {
        const stage: RejectionStage = body.rejection?.stage === 'CONFERME' ? 'CONFERME' : 'GDO';
        enqueueInput.rejection = {
            stage,
            automatic: body.rejection?.automatic ?? false,
            byBot: body.rejection?.byBot ?? false,
        };
    }

    const result = await enqueueMarketingWebhook(enqueueInput);

    if (!result.enqueued) {
        // Niente "enqueued: true" bugiardo: se non e' finito in outbox, il
        // chiamante (chi fa QA prima del go-live) deve saperlo subito.
        return NextResponse.json({ enqueued: false, reason: result.reason ?? 'unknown' }, { status: 422 });
    }

    return NextResponse.json({ enqueued: true });
}
