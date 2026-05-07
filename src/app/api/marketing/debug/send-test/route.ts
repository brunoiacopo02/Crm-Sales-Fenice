import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { enqueueMarketingWebhook } from '@/lib/marketing-webhooks/enqueue';
import { ALL_EVENT_TYPES } from '@/lib/marketing-webhooks/types';
import type { MarketingEventType } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/marketing/debug/send-test
 * Body: { eventType: MarketingEventType, leadId: string }
 *
 * MANAGER/ADMIN only. Forza l'enqueue di un evento contro la URL configurata.
 * Utile per QA prima del go-live.
 */
export async function POST(req: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const role = user.user_metadata?.role;
    if (role !== 'MANAGER' && role !== 'ADMIN') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let body: { eventType?: string; leadId?: string };
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

    await enqueueMarketingWebhook({
        eventType: body.eventType as MarketingEventType,
        leadId: body.leadId,
        actorUserId: user.id,
    });

    return NextResponse.json({ enqueued: true });
}
