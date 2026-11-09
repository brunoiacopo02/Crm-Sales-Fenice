import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { leads, leadEvents, users } from '@/db/schema';
import { createClient } from '@/utils/supabase/server';
import { pushLeadToBot } from '@/lib/bot-fissatore/push';
import { BLACK_FRIDAY_FUNNEL, decidiConversioneBf } from '@/lib/acIntake/blackFriday';

/**
 * Lead della landing Black Friday rimasti col funnel sbagliato (PO 09/11/2026):
 * li porta a BLACK FRIDAY con la stessa regola del webhook AC
 * (`decidiConversioneBf`): del bot -> funnel BF e push; aperto e mai lavorato ->
 * passa al bot e push; lavoro di una persona o chiuso -> solo funnel.
 *
 * Sessione ADMIN (come /api/admin/bot-push-leads). Body:
 *   { leadIds: string[], esegui?: boolean, senzaPush?: string[], ripush?: string[] }
 * `ripush`: lead gia' BF e del bot da mandare al bot adesso (quelli lasciati con senzaPush).
 * Senza `esegui` e' un dry-run: dice cosa farebbe e lo stato attuale (per il
 * ripristino). `senzaPush`: lead da convertire ma da non pushare adesso (es. chat
 * viva: il bot cambierebbe solo il funnel e l'apertura BF non partirebbe piu').
 * Idempotente: un lead gia' BLACK FRIDAY non si tocca.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || (user.user_metadata as { role?: string } | undefined)?.role !== 'ADMIN') {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    let body: { leadIds?: unknown; esegui?: unknown; senzaPush?: unknown; ripush?: unknown } = {};
    try {
        body = JSON.parse((await req.text()) || '{}');
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const leadIds = Array.isArray(body.leadIds) ? body.leadIds.map(String).slice(0, 50) : [];
    const senzaPush = new Set(Array.isArray(body.senzaPush) ? body.senzaPush.map(String) : []);
    const ripush = new Set(Array.isArray(body.ripush) ? body.ripush.map(String) : []);
    const esegui = body.esegui === true;
    if (leadIds.length === 0) return NextResponse.json({ error: 'leadIds mancanti' }, { status: 400 });

    const righe = await db.select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        funnel: leads.funnel,
        status: leads.status,
        appointmentDate: leads.appointmentDate,
        callCount: leads.callCount,
        lastCallDate: leads.lastCallDate,
        agendaSentAt: leads.agendaSentAt,
        recallDate: leads.recallDate,
        scortaStato: leads.scortaStato,
        scortaDal: leads.scortaDal,
        assignedToId: leads.assignedToId,
        assignedAt: leads.assignedAt,
        version: leads.version,
        companyId: leads.companyId,
        assegnatoAlBot: users.isBot,
    }).from(leads)
        .leftJoin(users, eq(users.id, leads.assignedToId))
        .where(and(eq(leads.companyId, 'fenice'), inArray(leads.id, leadIds)));

    const [bot] = await db.select({ id: users.id }).from(users).where(and(
        eq(users.companyId, 'fenice'), eq(users.role, 'GDO'), eq(users.isBot, true),
        eq(users.isActive, true), eq(users.isTest, false),
    )).limit(1);

    const now = new Date();
    const esiti: unknown[] = [];
    for (const r of righe) {
        let decisione = decidiConversioneBf({ ...r, assegnatoAlBot: r.assegnatoAlBot === true }, now);
        if (decisione === 'al_bot' && !bot) decisione = 'solo_funnel';
        const push = (decisione === 'al_bot' || decisione === 'push_bot') && !senzaPush.has(r.id);
        const prima = {
            funnel: r.funnel, status: r.status, assignedToId: r.assignedToId, assignedAt: r.assignedAt,
            recallDate: r.recallDate, scortaStato: r.scortaStato, scortaDal: r.scortaDal, version: r.version,
        };
        // `ripush`: lead gia' BLACK FRIDAY e del bot da (ri)mandare al bot col funnel BF,
        // per chi era stato convertito con `senzaPush` (chat viva, es. Luciani 09/11).
        if (decisione === 'gia_bf' && ripush.has(r.id) && r.assegnatoAlBot === true) {
            const pushEsito = esegui ? await pushLeadToBot({
                leadId: r.id, name: r.name, phone: r.phone, email: r.email,
                funnel: BLACK_FRIDAY_FUNNEL, companyId: r.companyId,
            }) : null;
            if (esegui) {
                await db.insert(leadEvents).values({
                    id: crypto.randomUUID(), leadId: r.id, eventType: 'BF_RIPUSH', userId: null, timestamp: now,
                    metadata: { motivo: 'apertura_bf_rimandata', adminId: user.id }, companyId: 'fenice',
                });
            }
            esiti.push({ leadId: r.id, nome: r.name, decisione: 'ripush', push: true, prima, eseguito: esegui, pushEsito });
            continue;
        }
        if (!esegui || decisione === 'gia_bf') {
            esiti.push({ leadId: r.id, nome: r.name, decisione, push, prima, eseguito: false });
            continue;
        }
        const alBot = decisione === 'al_bot';
        const updated = await db.update(leads).set({
            funnel: BLACK_FRIDAY_FUNNEL,
            ...(alBot ? {
                assignedToId: bot!.id, assignedAt: now, status: 'NEW',
                recallDate: null, scortaStato: null, scortaDal: null,
            } : {}),
            version: r.version + 1,
            updatedAt: now,
        }).where(and(eq(leads.id, r.id), eq(leads.version, r.version))).returning({ id: leads.id });
        if (updated.length === 0) {
            esiti.push({ leadId: r.id, nome: r.name, decisione, push: false, prima, eseguito: false, errore: 'version_cambiata' });
            continue;
        }
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(), leadId: r.id, eventType: 'BF_CONVERTITO', userId: null, timestamp: now,
            metadata: {
                da: r.funnel, a: BLACK_FRIDAY_FUNNEL, decisione, push,
                motivo: 'landing_blackfriday2026_funnel_sbagliato', nota: 'PO 09/11/2026: lead dalla landing BF rimasti col funnel sbagliato',
                adminId: user.id,
            },
            companyId: 'fenice',
        });
        if (alBot) {
            await db.insert(leadEvents).values({
                id: crypto.randomUUID(), leadId: r.id, eventType: 'ASSIGNED', userId: null, timestamp: now,
                metadata: { assignedToUser: bot!.id, fromAssignee: r.assignedToId, source: 'bf_converti', routing: 'black_friday_bot' },
                companyId: 'fenice',
            });
        }
        let pushEsito: unknown = null;
        if (push) {
            pushEsito = await pushLeadToBot({
                leadId: r.id, name: r.name, phone: r.phone, email: r.email,
                funnel: BLACK_FRIDAY_FUNNEL, companyId: r.companyId,
            });
        }
        esiti.push({ leadId: r.id, nome: r.name, decisione, push, prima, eseguito: true, pushEsito });
    }

    return NextResponse.json({ esegui, trovati: righe.length, richiesti: leadIds.length, esiti });
}
