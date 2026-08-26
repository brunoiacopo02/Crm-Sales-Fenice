'use server';

import crypto from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { botContactRequests, leadEvents, leads, notifications, users } from '@/db/schema';
import { createClient } from '@/utils/supabase/server';

const COMPANY = 'fenice'; // il bot fissatore lavora solo lead Fenice

async function requireAdmin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    if (user.user_metadata?.role !== 'ADMIN') return null;
    return { id: user.id };
}

export interface ContactRequestRow {
    id: string;
    leadId: string;
    leadName: string;
    leadPhone: string | null;
    leadFunnel: string | null;
    leadStatus: string;
    appointmentDate: string | null;
    /** Il lead ha già prodotto storico: l'assegnazione non può spostarlo. */
    locked: boolean;
    category: string;
    reason: string;
    leadInfo: Record<string, unknown> | null;
    updatesCount: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    waitingHours: number;
    assignedToName: string | null;
    assignedAt: string | null;
    currentOwnerName: string | null;
}

export interface ContactRequestsView {
    pending: ContactRequestRow[];
    handled: ContactRequestRow[];
    gdos: Array<{ id: string; label: string }>;
}

/**
 * Una richiesta non è spostabile quando il lead ha già prodotto storico
 * (appuntamento in corso o presenza latchata): ogni metrica per-GDO legge
 * l'assegnatario ATTUALE, quindi cambiarlo cancellerebbe presenze da cicli
 * bonus già pagati e fatturato già riconciliato. Stessa invariante della
 * guardia in /api/bot/outcome — se cambia lì, deve cambiare anche qui.
 */
function isLocked(status: string, presentedAt: Date | null): boolean {
    return status === 'APPOINTMENT' || presentedAt !== null;
}

type QueueRow = {
    r: typeof botContactRequests.$inferSelect;
    leadName: string;
    leadPhone: string | null;
    leadFunnel: string | null;
    leadStatus: string;
    appointmentDate: Date | null;
    presentedAt: Date | null;
    ownerId: string | null;
};

export async function getContactRequests(): Promise<ContactRequestsView | null> {
    if (!await requireAdmin()) return null;

    const HANDLED_WINDOW_DAYS = 30;
    const selection = {
        r: botContactRequests,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadFunnel: leads.funnel,
        leadStatus: leads.status,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
        ownerId: leads.assignedToId,
    };

    // Lo storico si limita a 30 giorni; le pending si vogliono TUTTE, anche
    // quelle ferme da luglio — sono esattamente quelle da recuperare.
    const [recent, pendingRows] = await Promise.all([
        db.select(selection)
            .from(botContactRequests)
            .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
            .where(and(
                eq(botContactRequests.companyId, COMPANY),
                gte(botContactRequests.updatedAt, new Date(Date.now() - HANDLED_WINDOW_DAYS * 86400_000)),
            ))
            .orderBy(desc(botContactRequests.createdAt)),
        db.select(selection)
            .from(botContactRequests)
            .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
            .where(and(
                eq(botContactRequests.companyId, COMPANY),
                eq(botContactRequests.status, 'pending'),
            ))
            .orderBy(desc(botContactRequests.createdAt)),
    ]);

    const byId = new Map<string, QueueRow>();
    for (const row of [...recent, ...pendingRows] as QueueRow[]) byId.set(row.r.id, row);
    const all = [...byId.values()];

    const userIds = [...new Set(all.flatMap(r => [r.r.assignedToId, r.ownerId].filter(Boolean) as string[]))];
    const people = userIds.length
        ? await db.select({ id: users.id, name: users.name, displayName: users.displayName, gdoCode: users.gdoCode })
            .from(users).where(inArray(users.id, userIds))
        : [];
    const nameOf = new Map(people.map(p => [p.id, p.gdoCode ? `GDO ${p.gdoCode}` : (p.displayName || p.name || '—')]));

    const now = Date.now();
    const toRow = (r: QueueRow): ContactRequestRow => ({
        id: r.r.id,
        leadId: r.r.leadId,
        leadName: r.leadName,
        leadPhone: r.leadPhone,
        leadFunnel: r.leadFunnel,
        leadStatus: r.leadStatus,
        appointmentDate: r.appointmentDate ? r.appointmentDate.toISOString() : null,
        locked: isLocked(r.leadStatus, r.presentedAt),
        category: r.r.category,
        reason: r.r.reason,
        leadInfo: (r.r.leadInfo as Record<string, unknown> | null) ?? null,
        updatesCount: r.r.updatesCount,
        status: r.r.status,
        createdAt: r.r.createdAt.toISOString(),
        updatedAt: r.r.updatedAt.toISOString(),
        waitingHours: Math.round((now - r.r.createdAt.getTime()) / 3600_000),
        assignedToName: r.r.assignedToId ? (nameOf.get(r.r.assignedToId) ?? null) : null,
        assignedAt: r.r.assignedAt ? r.r.assignedAt.toISOString() : null,
        currentOwnerName: r.ownerId ? (nameOf.get(r.ownerId) ?? null) : null,
    });

    const gdoRows = await db.select({ id: users.id, name: users.name, displayName: users.displayName, gdoCode: users.gdoCode })
        .from(users)
        .where(and(eq(users.companyId, COMPANY), eq(users.role, 'GDO'), eq(users.isActive, true), eq(users.isBot, false)));

    return {
        // Chi aspetta da più tempo sta in cima: è l'unico ordine che impedisce
        // a una richiesta di luglio di scivolare sotto quelle di stamattina.
        pending: all.filter(r => r.r.status === 'pending').map(toRow)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        handled: all.filter(r => r.r.status !== 'pending').map(toRow)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        gdos: gdoRows
            .map(g => ({ id: g.id, label: g.gdoCode ? `GDO ${g.gdoCode}` : (g.displayName || g.name || g.id) }))
            .sort((a, b) => a.label.localeCompare(b.label, 'it')),
    };
}

/**
 * L'admin sceglie chi lo chiama. Due esiti diversi a seconda del lead:
 * - lead libero → passa davvero al GDO scelto (assignedToId + assignedAt), e se
 *   era scartato riparte come NEW, come già fa il ritorno dal bot al pool umano;
 * - lead con storico (appuntamento in corso o presenza) → NON si sposta, il GDO
 *   scelto riceve comunque la richiesta e può chiamarlo dal drawer. Spostarlo
 *   farebbe sparire presenze e fatturato da mesi già chiusi.
 * In entrambi i casi la richiesta esce dalla coda e il GDO riceve la notifica.
 */
export async function assignContactRequest(requestId: string, gdoId: string): Promise<{ ok: boolean; error?: string; moved?: boolean }> {
    const admin = await requireAdmin();
    if (!admin) return { ok: false, error: 'Solo gli ADMIN possono assegnare le richieste di contatto.' };

    const [row] = await db.select({
        r: botContactRequests,
        leadName: leads.name,
        leadStatus: leads.status,
        presentedAt: leads.presentedAt,
    })
        .from(botContactRequests)
        .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
        .where(eq(botContactRequests.id, requestId))
        .limit(1);
    if (!row) return { ok: false, error: 'Richiesta non trovata.' };
    if (row.r.status !== 'pending') return { ok: false, error: 'Richiesta già gestita.' };

    const [gdo] = await db.select({ id: users.id, role: users.role, isActive: users.isActive, companyId: users.companyId })
        .from(users).where(eq(users.id, gdoId)).limit(1);
    if (!gdo || gdo.role !== 'GDO' || !gdo.isActive || gdo.companyId !== COMPANY) {
        return { ok: false, error: 'GDO non valido o non attivo.' };
    }

    const locked = isLocked(row.leadStatus, row.presentedAt);
    const now = new Date();

    if (!locked) {
        await db.update(leads)
            .set({
                assignedToId: gdoId,
                assignedAt: now,
                updatedAt: now,
                // Un lead scartato che chiede di essere richiamato torna in pipeline.
                ...(row.leadStatus === 'REJECTED' ? { status: 'NEW', discardReason: null } : {}),
            })
            .where(and(eq(leads.id, row.r.leadId), eq(leads.companyId, COMPANY)));

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId: row.r.leadId,
            eventType: 'ASSIGNED',
            userId: admin.id,
            timestamp: now,
            metadata: { source: 'contatto_umano', assignedToUser: gdoId, requestId },
            companyId: COMPANY,
        }).catch((e) => console.error('[contatto-umano] ASSIGNED event err', e));
    }

    await db.update(botContactRequests)
        .set({ status: 'assigned', assignedToId: gdoId, assignedByUserId: admin.id, assignedAt: now, updatedAt: now })
        .where(eq(botContactRequests.id, requestId));

    await db.insert(notifications).values({
        id: crypto.randomUUID(),
        recipientUserId: gdoId,
        type: 'contatto_umano_assegnato',
        title: '☎️ Chiamalo tu: ha chiesto di parlare con una persona',
        body: `${row.leadName}: ${row.r.reason.length > 180 ? row.r.reason.slice(0, 180) + '…' : row.r.reason}`,
        metadata: { leadId: row.r.leadId, requestId },
        status: 'unread',
        createdAt: now,
        companyId: COMPANY,
    }).catch((e) => console.error('[contatto-umano] notify err', e));

    revalidatePath('/richieste-contatto');
    revalidatePath('/', 'layout');
    return { ok: true, moved: !locked };
}

/** Chiusura senza assegnazione: richieste doppie, lead già risolti, rumore. */
export async function closeContactRequest(requestId: string): Promise<{ ok: boolean; error?: string }> {
    const admin = await requireAdmin();
    if (!admin) return { ok: false, error: 'Solo gli ADMIN possono chiudere le richieste di contatto.' };

    const now = new Date();
    const updated = await db.update(botContactRequests)
        .set({ status: 'closed', closedAt: now, closedByUserId: admin.id, updatedAt: now })
        .where(and(eq(botContactRequests.id, requestId), eq(botContactRequests.status, 'pending')))
        .returning({ id: botContactRequests.id });

    if (updated.length === 0) return { ok: false, error: 'Richiesta non trovata o già gestita.' };
    revalidatePath('/richieste-contatto');
    return { ok: true };
}
