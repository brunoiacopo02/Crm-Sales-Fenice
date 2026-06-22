import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, inArray, asc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, users } from '@/db/schema';
import { pushLeadToBot } from '@/lib/bot-fissatore/push';

/**
 * Backfill one-off: spinge al bot i lead già assegnati all'account bot ma mai
 * pushati (perché BOT_INTAKE_ENABLED era false al momento dell'assegnazione).
 * Admin-gated via header x-backfill-key == BOT_WEBHOOK_SECRET (timing-safe).
 * Usa il vero pushLeadToBot → env di produzione reali + audit BOT_PUSHED.
 *
 * Body (JSON, tutto opzionale):
 *   { dryRun?: boolean, limit?: number, leadIds?: string[] }
 */
interface BackfillBody {
    dryRun?: boolean;
    limit?: number;
    leadIds?: string[];
}

function authorized(req: NextRequest, secret: string): boolean {
    const provided = req.headers.get('x-backfill-key') ?? '';
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }
    if (!authorized(req, secret)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    let body: BackfillBody = {};
    try {
        const raw = await req.text();
        if (raw) body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const limit = Math.min(Math.max(body.limit ?? 100, 1), 500);

    // Account bot Fenice.
    const [bot] = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.isBot, true), eq(users.companyId, 'fenice')))
        .limit(1);
    if (!bot) {
        return NextResponse.json({ error: 'bot_account_not_found' }, { status: 404 });
    }

    // Lead assegnati al bot, ancora NEW e mai pushati (nessun report) → candidati.
    const conds = [
        eq(leads.assignedToId, bot.id),
        eq(leads.companyId, 'fenice'),
        eq(leads.status, 'NEW'),
        isNull(leads.botReport),
    ];
    if (body.leadIds && body.leadIds.length > 0) {
        conds.push(inArray(leads.id, body.leadIds));
    }

    const candidates = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        companyId: leads.companyId,
    }).from(leads).where(and(...conds)).orderBy(asc(leads.createdAt)).limit(limit);

    if (body.dryRun) {
        return NextResponse.json({
            dryRun: true,
            count: candidates.length,
            leads: candidates.map(c => ({ id: c.id, name: c.name, phone: c.phone, funnel: c.funnel })),
        });
    }

    // Push sequenziale (gentile verso l'intake del bot). pushLeadToBot audita ogni esito.
    const results: Array<{ leadId: string; name: string | null; result: string; status?: number }> = [];
    for (const c of candidates) {
        const r = await pushLeadToBot({
            leadId: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
            funnel: c.funnel,
            companyId: c.companyId,
        });
        results.push({
            leadId: c.id,
            name: c.name,
            result: r.result,
            status: 'status' in r ? r.status : undefined,
        });
    }

    const summary = results.reduce<Record<string, number>>((acc, r) => {
        acc[r.result] = (acc[r.result] ?? 0) + 1;
        return acc;
    }, {});

    return NextResponse.json({ dryRun: false, pushed: results.length, summary, results });
}
