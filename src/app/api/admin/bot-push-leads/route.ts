import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { leads, users } from '@/db/schema';
import { pushLeadToBot } from '@/lib/bot-fissatore/push';
import { createClient } from '@/utils/supabase/server';

/**
 * Variante ADMIN-session di /api/bot/backfill: stesso identico push (pushLeadToBot,
 * env di produzione reali, audit BOT_PUSHED), ma senza bisogno del BOT_WEBHOOK_SECRET
 * come credenziale esterna — quel secret è "Sensitive" su Vercel (write-only, non
 * leggibile nemmeno dal dashboard) e serve solo alla firma HMAC verso il fornitore,
 * non come token admin. Qui l'autorizzazione è la sessione ADMIN già usata dal resto
 * del CRM (stesso pattern di redistributeLeadsActions/assignQuarantinedLead).
 *
 * Body: { leadIds: string[] }
 */
export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || (user.user_metadata as any)?.role !== 'ADMIN') {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    let body: { leadIds?: string[] } = {};
    try {
        const raw = await req.text();
        if (raw) body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const leadIds = Array.isArray(body.leadIds) ? body.leadIds.slice(0, 500) : [];
    if (leadIds.length === 0) {
        return NextResponse.json({ error: 'leadIds mancanti' }, { status: 400 });
    }

    const [bot] = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.isBot, true), eq(users.companyId, 'fenice')))
        .limit(1);
    if (!bot) {
        return NextResponse.json({ error: 'bot_account_not_found' }, { status: 404 });
    }

    // Stessa guardia del backfill: solo lead già assegnati al bot, ancora NEW,
    // mai pushati (nessun report), per evitare push doppi o su lead sbagliati.
    const candidates = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        companyId: leads.companyId,
    }).from(leads).where(and(
        eq(leads.assignedToId, bot.id),
        eq(leads.companyId, 'fenice'),
        eq(leads.status, 'NEW'),
        isNull(leads.botReport),
        inArray(leads.id, leadIds),
    ));

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

    return NextResponse.json({ pushed: results.length, requested: leadIds.length, matched: candidates.length, summary, results });
}
