'use server';

import crypto from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { botContactRequests, leadEvents, leads, notifications, users } from '@/db/schema';
import { contactLane, isLeadLocked } from '@/lib/bot-fissatore/contactRequests';
import { createClient } from '@/utils/supabase/server';

const COMPANY = 'fenice'; // il bot fissatore lavora solo lead Fenice

type Viewer = { id: string; role: string; lane: 'admin' | 'conferme' };

/**
 * Chi può vedere la coda, e quale fetta.
 * - ADMIN: tutto, e può assegnare a un GDO.
 * - CONFERME: solo i lead già appuntati — da lì in poi la competenza è loro,
 *   sono loro a richiamarli il giorno prima della call. Sono le 14 richieste
 *   su 64 (22%) che oggi finiscono in coda per un GDO.
 * Le Conferme NON assegnano: spostare l'assegnatario cambia l'attribuzione dei
 * KPI, e non è il loro mestiere.
 */
async function requireViewer(): Promise<Viewer | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const role = user.user_metadata?.role;
    if (role === 'ADMIN') return { id: user.id, role, lane: 'admin' };
    if (role === 'CONFERME') return { id: user.id, role, lane: 'conferme' };
    return null;
}

async function requireAdmin() {
    const v = await requireViewer();
    return v?.lane === 'admin' ? { id: v.id } : null;
}

/**
 * Fa emergere il lead sul cursore di /api/bot/lead-status.
 *
 * Quell'endpoint pagina su leads.updatedAt, ma prendere in carico una richiesta
 * non tocca il lead: senza questo, le righe non uscirebbero MAI e il fornitore
 * vedrebbe silenzio credendo che non le lavoriamo — cioè il problema che
 * volevamo chiudere, con in più la convinzione di averlo chiuso.
 *
 * Semanticamente onesto: dal punto di vista del bot qualcosa su quel lead è
 * davvero cambiato. Volume trascurabile (~64 richieste da luglio).
 */
async function touchLeadForBotCursor(leadId: string): Promise<void> {
    await db.update(leads)
        .set({ updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.companyId, COMPANY)))
        .catch((e) => console.error('[contatto-umano] touch lead err', e));
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
    lane: 'conferme' | 'gdo';
    outcome: string | null;
    note: string | null;
}

/**
 * Vocabolario condiviso col fornitore: sono i valori che finiscono in
 * `botContactRequests.outcome` e che il bot rilegge da /api/bot/lead-status,
 * così non serve tradurre ai due capi.
 *
 * Solo le chiavi, non le etichette: questo file è `'use server'` e Next.js
 * accetta **esclusivamente** export di funzioni async (ensureServerEntryExports
 * lancia a runtime su qualunque altro valore). Le etichette leggibili stanno nel
 * client, tipizzate `Record<ContactOutcome, string>` — se qui si aggiunge o si
 * toglie un esito, là non compila più.
 */
const CONTACT_OUTCOMES = ['chiamato_ok', 'non_raggiungibile', 'rifissato', 'disdetto', 'non_gestito'] as const;

export type ContactOutcome = typeof CONTACT_OUTCOMES[number];

export interface ContactRequestsView {
    lane: 'admin' | 'conferme';
    canAssign: boolean;
    pending: ContactRequestRow[];
    handled: ContactRequestRow[];
    gdos: Array<{ id: string; label: string }>;
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
    const viewer = await requireViewer();
    if (!viewer) return null;

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
        locked: isLeadLocked(r.leadStatus, r.presentedAt),
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
        lane: contactLane(r.leadStatus),
        outcome: r.r.outcome,
        note: r.r.note,
    });

    const gdoRows = await db.select({ id: users.id, name: users.name, displayName: users.displayName, gdoCode: users.gdoCode })
        .from(users)
        .where(and(eq(users.companyId, COMPANY), eq(users.role, 'GDO'), eq(users.isActive, true), eq(users.isBot, false)));

    // Le Conferme vedono solo la loro corsia; l'admin vede tutta la coda.
    const inLane = (r: ContactRequestRow) => viewer.lane === 'admin' || r.lane === 'conferme';

    return {
        lane: viewer.lane,
        canAssign: viewer.lane === 'admin',
        // Chi aspetta da più tempo sta in cima: è l'unico ordine che impedisce
        // a una richiesta di luglio di scivolare sotto quelle di stamattina.
        pending: all.filter(r => r.r.status === 'pending').map(toRow).filter(inLane)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        handled: all.filter(r => r.r.status !== 'pending').map(toRow).filter(inLane)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        gdos: viewer.lane === 'admin'
            ? gdoRows.map(g => ({ id: g.id, label: g.gdoCode ? `GDO ${g.gdoCode}` : (g.displayName || g.name || g.id) }))
                .sort((a, b) => a.label.localeCompare(b.label, 'it'))
            : [],
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

    const locked = isLeadLocked(row.leadStatus, row.presentedAt);
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

    await touchLeadForBotCursor(row.r.leadId);
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
        .returning({ id: botContactRequests.id, leadId: botContactRequests.leadId });

    if (updated.length === 0) return { ok: false, error: 'Richiesta non trovata o già gestita.' };

    await touchLeadForBotCursor(updated[0].leadId);
    revalidatePath('/richieste-contatto');
    return { ok: true };
}

/**
 * "La prendo io." Non sposta il lead e non tocca l'assegnatario del funnel:
 * dice solo chi se ne sta occupando, così due Conferme non chiamano la stessa
 * persona a cinque minuti di distanza.
 */
export async function takeChargeContactRequest(requestId: string): Promise<{ ok: boolean; error?: string }> {
    const viewer = await requireViewer();
    if (!viewer) return { ok: false, error: 'Non autorizzato.' };

    const [row] = await db.select({ r: botContactRequests, leadStatus: leads.status })
        .from(botContactRequests)
        .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
        .where(eq(botContactRequests.id, requestId))
        .limit(1);
    if (!row) return { ok: false, error: 'Richiesta non trovata.' };
    if (row.r.status !== 'pending') return { ok: false, error: 'Richiesta già gestita.' };
    if (viewer.lane === 'conferme' && contactLane(row.leadStatus) !== 'conferme') {
        return { ok: false, error: 'Questa richiesta non è di competenza delle Conferme.' };
    }

    const now = new Date();
    await db.update(botContactRequests)
        .set({ status: 'assigned', assignedToId: viewer.id, assignedAt: now, updatedAt: now })
        .where(and(eq(botContactRequests.id, requestId), eq(botContactRequests.status, 'pending')));

    await touchLeadForBotCursor(row.r.leadId);
    revalidatePath('/richieste-contatto');
    revalidatePath('/', 'layout');
    return { ok: true };
}

/**
 * Com'è finita. È il segnale che il fornitore ci chiede: finché non esiste, il
 * bot resta zitto su quella chat all'infinito anche quando il caso è chiuso da
 * settimane, e nessuno dei due può dire se la sezione sta funzionando.
 */
export async function resolveContactRequest(
    requestId: string,
    outcome: ContactOutcome,
    note?: string,
): Promise<{ ok: boolean; error?: string }> {
    const viewer = await requireViewer();
    if (!viewer) return { ok: false, error: 'Non autorizzato.' };
    if (!(CONTACT_OUTCOMES as readonly string[]).includes(outcome)) {
        return { ok: false, error: 'Esito non valido.' };
    }

    const [row] = await db.select({ r: botContactRequests, leadStatus: leads.status })
        .from(botContactRequests)
        .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
        .where(eq(botContactRequests.id, requestId))
        .limit(1);
    if (!row) return { ok: false, error: 'Richiesta non trovata.' };
    if (viewer.lane === 'conferme' && contactLane(row.leadStatus) !== 'conferme') {
        return { ok: false, error: 'Questa richiesta non è di competenza delle Conferme.' };
    }

    const now = new Date();
    await db.update(botContactRequests)
        .set({
            status: 'closed',
            outcome,
            outcomeAt: now,
            note: note?.trim() || null,
            closedAt: now,
            closedByUserId: viewer.id,
            // Se nessuno l'aveva presa in carico, chi la chiude è chi se n'è occupato.
            ...(row.r.assignedToId ? {} : { assignedToId: viewer.id, assignedAt: now }),
            updatedAt: now,
        })
        .where(eq(botContactRequests.id, requestId));

    await touchLeadForBotCursor(row.r.leadId);
    revalidatePath('/richieste-contatto');
    revalidatePath('/', 'layout');
    return { ok: true };
}

/**
 * Quante richieste ancora da prendere in carico ci sono nella corsia di chi
 * chiede. Alimenta il pallino rosso in Sidebar.
 *
 * La campanella suona una volta e poi si legge; il pallino invece resta finché
 * il lavoro non è fatto — ed è quello che serviva davvero: delle 53 richieste
 * storiche ne era stata lavorata UNA, pur essendo tutte notificate.
 *
 * Conta solo `pending`: una richiesta già presa in carico ha un nome sopra e
 * non è più un allarme per tutti. Ritorna 0 (mai un errore) per chi non ha
 * accesso: è un badge, non deve mai poter rompere la navigazione.
 */
export async function countPendingContactRequests(): Promise<number> {
    try {
        const viewer = await requireViewer();
        if (!viewer) return 0;

        // Solo lo status del lead, che è ciò che decide la corsia. L'indice
        // bot_contact_requests_status_created_idx copre già il filtro pending.
        const rows = await db.select({ leadStatus: leads.status })
            .from(botContactRequests)
            .innerJoin(leads, eq(leads.id, botContactRequests.leadId))
            .where(and(
                eq(botContactRequests.companyId, COMPANY),
                eq(botContactRequests.status, 'pending'),
            ));

        if (viewer.lane === 'admin') return rows.length;
        return rows.filter(r => contactLane(r.leadStatus) === 'conferme').length;
    } catch (e) {
        console.error('[contatto-umano] count err', e);
        return 0;
    }
}
