import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, users, leadEvents, notifications } from '@/db/schema';
import { verifySignature } from '@/lib/marketing-webhooks/signing';
import { updateLeadOutcome } from '@/app/actions/pipelineActions';
import { reassignBotLeadToHumanPool } from '@/lib/bot-fissatore/reassign';
import type { BotReport } from '@/lib/bot-fissatore/types';
import { BOT_NOTE_DEDUP_WINDOW_MS, isSameBotNoteIntent } from '@/lib/bot-fissatore/noteDedup';

// INTERROTTO: chat avviata ma interrotta senza obiezione ferrea → ritorno al pool umano.
// NON_RISPOSTO: mai risposto → ritorno al pool umano. DA_SCARTARE: solo obiezione ferrea → scarto.
// NOTA (contratto v1.2): annotazione senza transizione di stato — canale per disdette/
// spostamenti comunicati in chat su lead già appuntati, che il bot non può declassare.
// CONTATTO_UMANO: il lead ha chiesto di parlare con una persona. Segnalazione
// agli admin, nessuna transizione di stato: decide un umano a chi darla.
const VALID_OUTCOMES = ['APPUNTAMENTO', 'DA_SCARTARE', 'RICHIAMO', 'NON_RISPOSTO', 'INTERROTTO', 'NOTA', 'CONTATTO_UMANO'] as const;
type BotOutcome = typeof VALID_OUTCOMES[number];

interface BotOutcomeBody {
    leadId?: string;
    outcome?: string;
    date?: string;        // ISO 8601 con offset, es. 2026-06-20T15:00:00+02:00
    note?: string;
    discardReason?: string;
    report?: BotReport;
}

export async function POST(req: NextRequest) {
    const secret = process.env.BOT_WEBHOOK_SECRET;
    if (!secret) {
        console.error('[bot-fissatore] missing BOT_WEBHOOK_SECRET');
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const rawBody = await req.text();
    const sig = req.headers.get('x-bot-signature') ?? '';
    const check = verifySignature(rawBody, sig, secret);
    if (!check.valid) {
        return NextResponse.json({ error: 'invalid_signature', reason: check.reason }, { status: 401 });
    }

    let body: BotOutcomeBody;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const { leadId, outcome, note, discardReason, report } = body;
    if (!leadId || !outcome || !VALID_OUTCOMES.includes(outcome as BotOutcome)) {
        return NextResponse.json({ error: 'bad_request', detail: 'leadId e outcome validi richiesti' }, { status: 400 });
    }
    const typedOutcome = outcome as BotOutcome;

    // Data richiesta per APPUNTAMENTO e RICHIAMO.
    let date: Date | undefined;
    if (typedOutcome === 'APPUNTAMENTO' || typedOutcome === 'RICHIAMO') {
        if (!body.date) {
            return NextResponse.json({ error: 'bad_request', detail: 'date richiesta per APPUNTAMENTO/RICHIAMO' }, { status: 400 });
        }
        date = new Date(body.date);
        if (isNaN(date.getTime())) {
            return NextResponse.json({ error: 'bad_request', detail: 'date non valida (atteso ISO 8601)' }, { status: 400 });
        }
        // Richiedi un fuso esplicito: senza offset la data è ambigua e l'appuntamento
        // risulterebbe sfalsato. Es. valido: 2026-06-20T15:00:00+02:00
        if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(body.date)) {
            return NextResponse.json({ error: 'bad_request', detail: 'date deve includere il fuso orario (offset, es. +02:00)' }, { status: 400 });
        }
    }

    // Carica il lead + verifica che appartenga a un account bot Fenice.
    const [lead] = await db.select({
        id: leads.id,
        name: leads.name,
        companyId: leads.companyId,
        assignedToId: leads.assignedToId,
        status: leads.status,
        confNeedsReschedule: leads.confNeedsReschedule,
        agendaStatus: leads.agendaStatus,
    }).from(leads).where(eq(leads.id, leadId)).limit(1);

    if (!lead) {
        return NextResponse.json({ error: 'lead_not_found' }, { status: 404 });
    }
    if (lead.companyId !== 'fenice') {
        return NextResponse.json({ error: 'forbidden', detail: 'lead non Fenice' }, { status: 403 });
    }

    const [assignee] = lead.assignedToId
        ? await db.select({ id: users.id, isBot: users.isBot }).from(users).where(eq(users.id, lead.assignedToId)).limit(1)
        : [undefined];
    const assigneeIsBot = !!assignee?.isBot;

    // Lead di un GDO umano: da quando l'agenda parte dal canale bot (AGENDA_CHANNEL=bot,
    // dal 31/07), quel canale recapita anche le agende dei lead che restano assegnati a
    // un GDO — il bot ci chatta comunque, ed è da lì che arrivano note di disdetta o
    // spostamento. Minimo privilegio: il segreto è fidato per operare sui lead che il
    // bot ha davvero lavorato, non per scrivere su qualunque riga solo perché un video
    // è passato dal suo canale. Due prove, non una: `leadWasBotOwned` (BOT_PUSHED oppure
    // agenda consegnata/inviata) è la soglia bassa che basta per NOTA, che non sposta
    // stato. `leadWasWorkedByBot` (solo BOT_PUSHED, prova che il lead gli fosse davvero
    // assegnato) è la soglia che serve per accettare un APPUNTAMENTO: un'agenda
    // recapitata non è mai stata una sua conversazione da chiudere, e un GDO che ha
    // fissato lui l'appuntamento non deve vederselo portare via.
    let leadWasBotOwned = assigneeIsBot;
    let leadWasWorkedByBot = assigneeIsBot;
    if (!assigneeIsBot) {
        const [pushed] = await db.select({ id: leadEvents.id })
            .from(leadEvents)
            .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.eventType, 'BOT_PUSHED')))
            .limit(1);
        leadWasWorkedByBot = !!pushed;
        leadWasBotOwned = leadWasWorkedByBot
            || lead.agendaStatus === 'consegnato'
            || lead.agendaStatus === 'inviato';

        if (!leadWasBotOwned) {
            return NextResponse.json({ error: 'forbidden', detail: 'lead mai passato dal bot' }, { status: 403 });
        }
        // Il lead è di un GDO umano. NOTA annota e basta — bastano push o sola agenda.
        // Tutto il resto no — uno scarto o un richiamo dal bot sovrascriverebbe il
        // lavoro di chi ce l'ha in mano.
        if (typedOutcome !== 'NOTA' && typedOutcome !== 'APPUNTAMENTO' && typedOutcome !== 'CONTATTO_UMANO') {
            return NextResponse.json({ error: 'forbidden', detail: 'lead non assegnato a un account bot' }, { status: 403 });
        }
        // APPUNTAMENTO torna al bot (vedi sotto): un appuntamento fissato è troppo
        // caro per buttarlo via, ma solo se il bot lo aveva davvero in carico. Sui
        // lead con solo agenda recapitata l'appuntamento resta di chi lo ha fissato.
        if (typedOutcome === 'APPUNTAMENTO' && !leadWasWorkedByBot) {
            return NextResponse.json({ error: 'forbidden', detail: 'agenda recapitata dal bot ma lead mai lavorato da lui (nessun BOT_PUSHED): appuntamento non accettato' }, { status: 403 });
        }
    }

    // Autore degli eventi. Sui lead umani l'assegnatario è una persona: attribuirgli
    // la nota la farebbe sembrare scritta da lui, quindi si usa l'account bot.
    let actorUserId: string;
    if (assigneeIsBot) {
        actorUserId = assignee!.id;
    } else {
        const [botAccount] = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.isBot, true), eq(users.companyId, 'fenice'))).limit(1);
        if (!botAccount) {
            console.error('[bot-fissatore] nessun account bot Fenice trovato');
            return NextResponse.json({ error: 'not_configured', detail: 'account bot assente' }, { status: 503 });
        }
        actorUserId = botAccount.id;
    }

    // Idempotenza anti ri-fissaggio. Il bot esterno ri-notifica lo stesso
    // APPUNTAMENTO ~ogni ora per lead già appuntati: senza guardia, updateLeadOutcome
    // ri-timbra appointmentCreatedAt=now (inquina "app fissati oggi") e gonfia
    // callCount (visti valori fino a 298). Un lead già in APPOINTMENT e non in
    // attesa di rifissaggio (i rifissaggi legittimi passano dalle Conferme, che
    // settano confNeedsReschedule) NON va ri-processato: no-op senza scritture DB.
    if (typedOutcome === 'APPUNTAMENTO' && lead.status === 'APPOINTMENT' && !lead.confNeedsReschedule) {
        return NextResponse.json({ ok: true, deduped: true });
    }

    // Persisti il report (se presente) e logga un evento di audit.
    if (report) {
        await db.update(leads).set({ botReport: report }).where(eq(leads.id, leadId));
        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'BOT_REPORT',
            userId: actorUserId,
            timestamp: new Date(),
            metadata: report as Record<string, unknown>,
            companyId: 'fenice',
        }).catch((e) => console.error('[bot-fissatore] BOT_REPORT event err', e));
    }

    // NOTA: solo annotazione, zero scritture su leads (né stato, né appuntamento,
    // né version). Evento in timeline + notifica alle Conferme se il lead è
    // appuntato (disdetta/spostamento comunicati in chat → qualcuno deve saperlo
    // PRIMA della chiamata di conferma). Su lead non appuntati niente notifica:
    // l'evento in timeline basta e non spamma la campanella.
    if (typedOutcome === 'NOTA') {
        const text = (note ?? '').trim();
        if (!text) {
            return NextResponse.json({ error: 'bad_request', detail: 'note richiesta per esito NOTA' }, { status: 400 });
        }

        // Il bot ri-manda la stessa nota 2-3 volte a distanza di minuti (visti 3
        // invii sullo stesso lead in 3 minuti). L'evento si scrive lo stesso —
        // ogni versione del motivo resta leggibile — ma il re-invio eredita
        // `supersedes` dal capofila e NON fa scattare una seconda notifica.
        const [prev] = await db.select({
            id: leadEvents.id,
            metadata: leadEvents.metadata,
        }).from(leadEvents).where(and(
            eq(leadEvents.leadId, leadId),
            eq(leadEvents.eventType, 'BOT_NOTE'),
            gte(leadEvents.timestamp, new Date(Date.now() - BOT_NOTE_DEDUP_WINDOW_MS)),
        )).orderBy(desc(leadEvents.timestamp)).limit(1);

        const prevMeta = (prev?.metadata ?? {}) as { note?: string; supersedes?: string };
        const isDuplicate = !!prev
            && typeof prevMeta.note === 'string'
            && isSameBotNoteIntent(prevMeta.note, text);

        // Catena piatta: `supersedes` punta sempre al capofila, mai a un anello
        // intermedio. Raggrupparle in lettura resta un group-by, non una risalita.
        const supersedes = isDuplicate ? (prevMeta.supersedes ?? prev.id) : undefined;

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'BOT_NOTE',
            userId: actorUserId,
            timestamp: new Date(),
            metadata: supersedes ? { note: text, supersedes } : { note: text },
            companyId: 'fenice',
        });

        // Una notifica per intenzione, non una per re-invio.
        if (!isDuplicate && lead.status === 'APPOINTMENT') {
            const confermeUsers = await db.select({ id: users.id }).from(users).where(and(
                eq(users.companyId, 'fenice'),
                eq(users.role, 'CONFERME'),
                eq(users.isActive, true),
            ));
            if (confermeUsers.length > 0) {
                const now = new Date();
                await db.insert(notifications).values(confermeUsers.map(u => ({
                    id: crypto.randomUUID(),
                    recipientUserId: u.id,
                    type: 'bot_note',
                    title: '📋 Nota dal Fissatore',
                    body: `${lead.name}: ${text.length > 200 ? text.slice(0, 200) + '…' : text}`,
                    metadata: { leadId },
                    status: 'unread',
                    createdAt: now,
                    companyId: 'fenice',
                }))).catch((e) => console.error('[bot-fissatore] NOTA notify err', e));
            }
        }

        // `deduped` è informativo, non un errore: per il bot l'invio è andato a buon fine.
        return NextResponse.json({ ok: true, noted: true, ...(isDuplicate ? { deduped: true } : {}) });
    }

    // Il lead ha chiesto di parlare con una persona. Non è una transizione di
    // stato: il lead resta dov'è ed è un admin a decidere a chi darlo. Va agli
    // admin e non al GDO assegnato per decisione del PO — su un lead ridato il
    // GDO potrebbe non essere quello giusto a cui affidarlo.
    if (typedOutcome === 'CONTATTO_UMANO') {
        const text = (note ?? '').trim();
        if (!text) {
            return NextResponse.json({ error: 'bad_request', detail: 'note richiesta per esito CONTATTO_UMANO' }, { status: 400 });
        }

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'BOT_CONTACT_REQUEST',
            userId: actorUserId,
            timestamp: new Date(),
            metadata: { note: text },
            companyId: 'fenice',
        });

        const admins = await db.select({ id: users.id }).from(users).where(and(
            eq(users.companyId, 'fenice'),
            eq(users.role, 'ADMIN'),
            eq(users.isActive, true),
        ));
        if (admins.length > 0) {
            const now = new Date();
            await db.insert(notifications).values(admins.map(a => ({
                id: crypto.randomUUID(),
                recipientUserId: a.id,
                type: 'bot_contatto_umano',
                title: '☎️ Il lead vuole essere richiamato',
                body: `${lead.name}: ${text.length > 200 ? text.slice(0, 200) + '…' : text}`,
                metadata: { leadId },
                status: 'unread',
                createdAt: now,
                companyId: 'fenice',
            }))).catch((e) => console.error('[bot-fissatore] CONTATTO_UMANO notify err', e));
        }

        return NextResponse.json({ ok: true, noted: true });
    }

    // Ritorno al pool umano: il bot non ha convertito ma non c'è obiezione ferrea
    // (mai risposto / chat interrotta) → riassegna a un GDO umano via round-robin AC.
    // Il lead riparte come nuovo (status=NEW, callCount=0). updateLeadOutcome NON è
    // coinvolto: i flussi dei GDO umani restano intatti.
    if (typedOutcome === 'NON_RISPOSTO' || typedOutcome === 'INTERROTTO') {
        const reason = typedOutcome === 'NON_RISPOSTO' ? 'mai_risposto' : 'chat_interrotta';
        const r = await reassignBotLeadToHumanPool(leadId, reason, actorUserId, note);
        return NextResponse.json({ ok: true, reassigned: r.assignedToId });
    }

    // Appuntamento su un lead che il bot ci aveva restituito: lo riprende. Guardia
    // ripetuta con `leadWasWorkedByBot` (già verificata sopra, che qui avrebbe già
    // fatto uscire con 403): un'agenda solo recapitata non basta a giustificare la
    // riassegnazione, l'invariante deve leggersi qui senza risalire al blocco di auth.
    // La riassegnazione va PRIMA di updateLeadOutcome, così l'appuntamento è
    // attribuito al bot — che è già escluso dai KPI per GDO — e non al GDO che
    // non l'ha fissato. Il GDO che lo perde viene avvisato: un lead che sparisce
    // dalla pipeline senza spiegazione è un reclamo che abbiamo già inseguito.
    if (typedOutcome === 'APPUNTAMENTO' && !assigneeIsBot && leadWasWorkedByBot) {
        const previousOwnerId = lead.assignedToId;

        await db.update(leads)
            .set({ assignedToId: actorUserId })
            .where(and(eq(leads.id, leadId), eq(leads.companyId, 'fenice')));

        await db.insert(leadEvents).values({
            id: crypto.randomUUID(),
            leadId,
            eventType: 'REASSIGNED_TO_BOT',
            userId: actorUserId,
            timestamp: new Date(),
            metadata: { fromUserId: previousOwnerId, reason: 'appuntamento_dal_bot' },
            companyId: 'fenice',
        }).catch((e) => console.error('[bot-fissatore] REASSIGNED_TO_BOT event err', e));

        if (previousOwnerId) {
            await db.insert(notifications).values({
                id: crypto.randomUUID(),
                recipientUserId: previousOwnerId,
                type: 'bot_took_lead',
                title: '🤖 Il Fissatore ha fissato questo lead',
                body: `${lead.name}: il bot ha chiuso l'appuntamento in chat, quindi il lead è tornato a lui.`,
                metadata: { leadId },
                status: 'unread',
                createdAt: new Date(),
                companyId: 'fenice',
            }).catch((e) => console.error('[bot-fissatore] bot_took_lead notify err', e));
        }
    }

    // Transizione di stato via riuso totale di updateLeadOutcome (handoff Conferme,
    // call log, marketing webhook). serviceCtx bypassa sessione/tenant e spegne la gamification.
    const result = await updateLeadOutcome(
        leadId,
        typedOutcome,
        note ?? '',
        date,
        undefined,            // userId (non usato: passiamo serviceCtx)
        discardReason,
        undefined,            // currentVersion (no optimistic lock dal bot)
        undefined,            // scriptCompleted
        { companyId: 'fenice', actorUserId, isBot: true },
    );

    if (!result || result.success !== true) {
        return NextResponse.json({ error: 'update_failed', detail: result?.error ?? 'unknown' }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
}
