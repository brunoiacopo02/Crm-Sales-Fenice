import { NextResponse } from 'next/server';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '@/db';
import { marketingWebhookDeliveries } from '@/db/schema';
import { deliverWebhook, nextAttemptDelay } from '@/lib/marketing-webhooks/deliver';
import type { MarketingWebhookEnvelope } from '@/lib/marketing-webhooks/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 50;

export async function GET(req: Request) {
    // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    if (process.env.MARKETING_WEBHOOK_ENABLED !== 'true') {
        return NextResponse.json({ skipped: true, reason: 'kill_switch_off' });
    }

    const secret = process.env.MARKETING_WEBHOOK_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'missing_secret' }, { status: 500 });
    }

    const now = new Date();

    const batch = await db.select()
        .from(marketingWebhookDeliveries)
        .where(and(
            eq(marketingWebhookDeliveries.status, 'pending'),
            lte(marketingWebhookDeliveries.nextAttemptAt, now),
        ))
        .limit(BATCH_SIZE);

    let delivered = 0;
    let failed = 0;
    let dead = 0;

    await Promise.allSettled(batch.map(async (row) => {
        const envelope = row.payload as unknown as MarketingWebhookEnvelope;
        const result = await deliverWebhook(row.targetUrl, envelope, secret);
        const newAttempts = row.attempts + 1;

        if (result.delivered) {
            await db.update(marketingWebhookDeliveries).set({
                status: 'delivered',
                deliveredAt: new Date(),
                lastAttemptAt: new Date(),
                attempts: newAttempts,
                lastResponseStatus: result.httpStatus,
                lastError: null,
            }).where(eq(marketingWebhookDeliveries.id, row.id));
            delivered++;
        } else {
            const delay = nextAttemptDelay(newAttempts);
            const newStatus = result.permanentFailure
                ? 'failed_permanent'
                : (delay === null ? 'dead' : 'pending');
            await db.update(marketingWebhookDeliveries).set({
                status: newStatus,
                attempts: newAttempts,
                lastAttemptAt: new Date(),
                nextAttemptAt: delay ? new Date(Date.now() + delay) : new Date(),
                lastResponseStatus: result.httpStatus,
                lastError: result.error,
            }).where(eq(marketingWebhookDeliveries.id, row.id));
            if (newStatus === 'dead') dead++;
            else failed++;
        }
    }));

    return NextResponse.json({ scanned: batch.length, delivered, failed, dead });
}
