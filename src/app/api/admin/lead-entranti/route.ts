import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { leads, leadEvents, users } from '@/db/schema';
import { createClient } from '@/utils/supabase/server';
import { logLeadEvent } from '@/lib/eventLogger';
import { pushLeadToBot } from '@/lib/bot-fissatore/push';
import { updateLeadOutcome } from '@/app/actions/pipelineActions';
import {
    chatApertaAlBot,
    fetchLeadEntranti,
    normalizzaLeadEntrante,
    pianificaAdozione,
    SOURCE_INBOUND,
    type Azione,
    type LeadEntranteNormalizzato,
    type LeadEsistente,
} from '@/lib/bot-fissatore/leadEntranti';

export const dynamic = 'force-dynamic';

const FENICE = 'fenice';

/**
 * Adozione dei lead che scrivono per primi sul numero WhatsApp Fenice.
 *
 * `GET`  — sola lettura, apribile dal browser: legge la lista dal fornitore, la
 *          incrocia col CRM e dice cosa succederebbe. Non scrive niente e non
 *          manda niente a nessuno.
 * `POST` — esegue, e solo con `conferma: true` nel corpo.
 *
 * Autorizzazione: sessione ADMIN, stesso pattern di /api/admin/bot-push-leads.
 * Il BOT_WEBHOOK_SECRET serve alla firma verso il fornitore, non come
 * credenziale d'ingresso: su Vercel è *sensitive* e non è più leggibile.
 *
 * ================== COSA PUÒ FAR ARRIVARE UN MESSAGGIO ==================
 * Creare il lead nel CRM è muto: nessuno riceve niente. A far partire un
 * messaggio è solo il push dell'intake verso il bot.
 *
 * Sui lead di QUESTA lista l'apertura "Ciao, sono Marta…" non parte, e non
 * perché lo stato sia `active`: la guardia dall'altro lato (`apreSopraChatViva`,
 * verificata nel loro codice il 05/09) salta l'apertura su qualunque
 * conversazione senza `crm_lead_id` — e per definizione della lista quel campo
 * è nullo, altrimenti la riga non ci sarebbe. `closed` e `booked` inclusi. Nel
 * ramo che salta l'apertura scrivono comunque `crm_lead_id`, quindi l'intake
 * fa il suo lavoro senza spedire niente.
 *
 * Resta UN caso in cui l'apertura partirebbe: la guardia pretende anche che il
 * bot abbia già mandato almeno un messaggio in quella chat. Fuori dalla fascia
 * 08:30–20:30 la loro risposta è differita al cron, quindi fra l'adozione e la
 * prima risposta esiste una finestra in cui un lead sta nella lista senza
 * outbound — e lì l'intake farebbe partire l'apertura. Il payload della lista
 * non dice se l'outbound è partito: richiesta girata a loro il 05/09.
 *
 * Perciò: `spingiIntake` resta false di default (niente parte da solo, mai), e
 * `soloChatVive` è l'uscita di sicurezza per limitarsi ad `active`/`replying`
 * finché quella finestra non è chiusa.
 * ========================================================================
 */

type Riepilogo = ReturnType<typeof riepiloga>;

async function admin() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { errore: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
    if ((user.user_metadata as Record<string, unknown> | undefined)?.role !== 'ADMIN') {
        return { errore: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
    }
    return { user };
}

/**
 * I lead già nel CRM con lo stesso numero, indicizzati per chiave persona.
 * Volutamente SENZA filtro azienda: serve anche a riconoscere i contatti di
 * un'altra azienda, che non devono generare un doppione Fenice (stessa guardia
 * cross-tenant del webhook AC).
 */
async function caricaEsistenti(personKeys: string[]): Promise<Map<string, LeadEsistente[]>> {
    const mappa = new Map<string, LeadEsistente[]>();
    if (personKeys.length === 0) return mappa;

    const chiave = sql<string>`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10)`;
    const righe = await db.select({
        id: leads.id,
        status: leads.status,
        presentedAt: leads.presentedAt,
        createdAt: leads.createdAt,
        assignedToId: leads.assignedToId,
        companyId: leads.companyId,
        personKey: chiave,
    }).from(leads).where(inArray(chiave, personKeys));

    for (const r of righe) {
        const lista = mappa.get(r.personKey) ?? [];
        lista.push(r);
        mappa.set(r.personKey, lista);
    }
    return mappa;
}

function conta<T extends string>(valori: T[]): Record<string, number> {
    return valori.reduce<Record<string, number>>((acc, v) => {
        acc[v] = (acc[v] ?? 0) + 1;
        return acc;
    }, {});
}

function riepiloga(azioni: Azione[]) {
    const creare = azioni.filter((a) => a.azione === 'crea');
    const collegare = azioni.filter((a) => a.azione === 'collega');
    const scarti = azioni.filter((a) => a.azione === 'scarta');
    const adottabili = [...creare, ...collegare];

    const conAppuntamento = adottabili.filter((a) => a.lead.appuntamento !== null);
    const appuntamentiSospetti = adottabili
        .filter((a) => a.lead.appuntamentoScartato)
        .map((a) => ({ telefono: a.lead.phone, motivo: a.lead.appuntamentoScartato }));

    return {
        daCreare: creare.length,
        daCollegare: collegare.length,
        // Fra i "da collegare": quelli che hanno già un appuntamento o una
        // presenza latchata. Su questi non si sovrascrive niente.
        daCollegareBloccati: collegare.filter((a) => a.azione === 'collega' && a.bloccato).length,
        scartati: scarti.length,
        motiviScarto: conta(scarti.map((a) => (a.azione === 'scarta' ? a.motivo : 'altro'))),
        perStatoBot: conta(adottabili.map((a) => a.lead.statoBot)),
        perProvenienza: conta(adottabili.map((a) => a.lead.funnel)),
        /**
         * Chat vive. Non è più la riga di demarcazione fra "muto" e "parlante"
         * — su questa lista l'intake è muto a prescindere dallo stato — ma
         * resta il sottoinsieme che `soloChatVive` lascia passare.
         */
        chatVive: adottabili.filter((a) => chatApertaAlBot(a.lead.statoBot)).length,
        conAppuntamentoDaRegistrare: conAppuntamento.length,
        appuntamentiSospetti,
    };
}

function dettaglio(azioni: Azione[]) {
    return azioni.map((a) => {
        if (a.azione === 'scarta') return { azione: a.azione, motivo: a.motivo, telefono: a.telefono };
        return {
            azione: a.azione,
            telefono: a.lead.phone,
            nome: a.lead.name,
            provenienza: a.lead.funnel,
            statoBot: a.lead.statoBot,
            esito: a.lead.esito,
            appuntamento: a.lead.appuntamento?.toISOString() ?? null,
            appuntamentoScartato: a.lead.appuntamentoScartato ?? null,
            scrittoIl: a.lead.scrittoIl?.toISOString() ?? null,
            primoMessaggio: a.lead.primoMessaggio,
            chatViva: chatApertaAlBot(a.lead.statoBot),
            ...(a.azione === 'collega'
                ? { leadIdEsistente: a.esistente.id, statusEsistente: a.esistente.status, bloccato: a.bloccato }
                : {}),
        };
    });
}

/** Legge la lista e la incrocia col CRM. Nessuna scrittura: condiviso da GET e POST. */
async function pianifica(limit: number) {
    const fonte = await fetchLeadEntranti(limit);
    if (!fonte.ok) return { fonte };

    // Le chiavi persona si ricavano dalla STESSA normalizzazione che userà
    // `pianificaAdozione` — è pura e non tocca il DB, quindi ripassarci costa
    // niente. Ricavarle qui a mano vorrebbe dire una seconda definizione della
    // chiave, ed è esattamente il modo in cui a giugno un lead ha perso
    // l'appuntamento (vedi isLeadLocked in contactRequests.ts).
    const chiavi = fonte.righe
        .map((r) => normalizzaLeadEntrante(r))
        .filter((r) => r.ok)
        .map((r) => (r as { ok: true; lead: LeadEntranteNormalizzato }).lead.personKey);

    const azioni = pianificaAdozione(fonte.righe, await caricaEsistenti(chiavi));
    return { fonte, azioni };
}

export async function GET(req: NextRequest) {
    const auth = await admin();
    if (auth.errore) return auth.errore;

    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 500, 1000);
    const { fonte, azioni } = await pianifica(limit);
    if (!fonte.ok) {
        return NextResponse.json({ ok: false, fonte }, { status: 200 });
    }

    return NextResponse.json({
        ok: true,
        modalita: 'anteprima',
        fonte: {
            totale: fonte.totale,
            totaleCompleto: fonte.totaleCompleto,
            // `totaleCompleto` più grande significa lista tagliata dal limit.
            listaTagliata: fonte.totaleCompleto > fonte.totale,
        },
        riepilogo: riepiloga(azioni!),
        dettaglio: dettaglio(azioni!),
    });
}

interface CorpoPost {
    conferma?: boolean;
    limit?: number;
    /** Manda l'intake al bot: è l'unica cosa che riempie `crm_lead_id` da quel lato. */
    spingiIntake?: boolean;
    /**
     * Uscita di sicurezza: limita il push alle chat `active`/`replying`. Non
     * serve per `closed`/`booked` — su quelli la guardia dell'altro lato scatta
     * lo stesso — ma chiude la finestra "adottato e non ancora risposto".
     */
    soloChatVive?: boolean;
    /** Registra nel CRM l'appuntamento che il bot aveva già fissato. */
    applicaAppuntamenti?: boolean;
}

export async function POST(req: NextRequest) {
    const auth = await admin();
    if (auth.errore) return auth.errore;

    let body: CorpoPost = {};
    try {
        const raw = await req.text();
        if (raw) body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    if (body.conferma !== true) {
        return NextResponse.json({
            error: 'conferma_mancante',
            detail: 'Serve { "conferma": true }. Per vedere cosa succederebbe senza scrivere niente: GET su questa stessa rotta.',
        }, { status: 400 });
    }

    const limit = Math.min(body.limit ?? 500, 1000);
    const spingiIntake = body.spingiIntake === true;
    const soloChatVive = body.soloChatVive === true;
    const applicaAppuntamenti = body.applicaAppuntamenti === true;

    const [bot] = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.isBot, true), eq(users.companyId, FENICE)))
        .limit(1);
    if (!bot) return NextResponse.json({ error: 'bot_account_not_found' }, { status: 404 });

    const { fonte, azioni } = await pianifica(limit);
    if (!fonte.ok) return NextResponse.json({ ok: false, fonte }, { status: 200 });

    const riepilogo = riepiloga(azioni!);
    const esiti: Array<{
        telefono: string;
        leadId?: string;
        creato?: boolean;
        collegato?: boolean;
        intake?: string;
        intakeSaltato?: string;
        appuntamento?: string;
        errore?: string;
    }> = [];

    /** Coppie (leadId, dati della chat) su cui poi valutare intake e appuntamento. */
    const adottati: Array<{ leadId: string; lead: LeadEntranteNormalizzato; bloccato: boolean; nuovo: boolean }> = [];

    // ---------- 1. Creazione / collegamento ----------
    for (const a of azioni!) {
        if (a.azione === 'scarta') continue;

        if (a.azione === 'collega') {
            adottati.push({ leadId: a.esistente.id, lead: a.lead, bloccato: a.bloccato, nuovo: false });
            esiti.push({ telefono: a.lead.phone, leadId: a.esistente.id, collegato: true });
            continue;
        }

        const nuovoId = crypto.randomUUID();
        const adesso = new Date();
        try {
            // Advisory lock sul numero, come nel webhook AC: senza, un webhook
            // AC in arrivo sullo stesso numero nello stesso istante creerebbe un
            // secondo lead. Il ricontrollo dentro la transazione chiude la
            // finestra fra la lettura della lista e la scrittura.
            const creato = await db.transaction(async (tx) => {
                await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${a.lead.phone}, 0))`);

                const [gia] = await tx.select({ id: leads.id })
                    .from(leads)
                    .where(sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10) = ${a.lead.personKey}`)
                    .limit(1);
                if (gia) return { id: gia.id, nuovo: false };

                await tx.insert(leads).values({
                    id: nuovoId,
                    name: a.lead.name,
                    phone: a.lead.phone,
                    email: null,
                    funnel: a.lead.funnel,
                    source: SOURCE_INBOUND,
                    status: 'NEW',
                    callCount: 0,
                    // La chat è già del bot: assegnarlo a un GDO umano gli
                    // toglierebbe una conversazione che sta conducendo lui.
                    assignedToId: bot.id,
                    // `createdAt` = quando ha scritto: è quello il momento in cui
                    // questa persona è arrivata, e le analisi di funnel devono
                    // vederlo lì. `assignedAt` = adesso, perché è adesso che
                    // entra in circolo (migr. 0027: i lead si contano da qui).
                    createdAt: a.lead.scrittoIl ?? adesso,
                    assignedAt: adesso,
                    updatedAt: adesso,
                    companyId: FENICE,
                });
                return { id: nuovoId, nuovo: true };
            });

            adottati.push({ leadId: creato.id, lead: a.lead, bloccato: false, nuovo: creato.nuovo });
            esiti.push({ telefono: a.lead.phone, leadId: creato.id, creato: creato.nuovo, collegato: !creato.nuovo });

            if (creato.nuovo) {
                await logLeadEvent({
                    leadId: creato.id,
                    eventType: 'IMPORTED',
                    toSection: 'Prima Chiamata',
                    metadata: {
                        source: SOURCE_INBOUND,
                        provenienza: a.lead.funnel,
                        conversationId: a.lead.conversationId,
                        statoBot: a.lead.statoBot,
                        scrittoIl: a.lead.scrittoIl?.toISOString() ?? null,
                    },
                    companyId: FENICE,
                });
                await logLeadEvent({
                    leadId: creato.id,
                    eventType: 'ASSIGNED',
                    metadata: { assignedToUser: bot.id, source: SOURCE_INBOUND, adozioneChatEntrante: true },
                    companyId: FENICE,
                });
            }
        } catch (e) {
            esiti.push({ telefono: a.lead.phone, errore: String(e) });
        }
    }

    // ---------- 2. Il messaggio con cui la persona si è presentata ----------
    // È l'unico contesto che quel lead ha dato, e va sulla timeline del lead
    // qualunque cosa si decida su intake e appuntamenti. Idempotente: su un
    // lead che ce l'ha già non si riscrive a ogni giro.
    const idAdottati = adottati.map((x) => x.leadId);
    const giaAnnotati = new Set<string>();
    if (idAdottati.length > 0) {
        const righe = await db.select({ leadId: leadEvents.leadId })
            .from(leadEvents)
            .where(and(inArray(leadEvents.leadId, idAdottati), eq(leadEvents.eventType, 'INBOUND_MESSAGE')));
        for (const r of righe) giaAnnotati.add(r.leadId);
    }
    for (const x of adottati) {
        if (giaAnnotati.has(x.leadId) || !x.lead.primoMessaggio) continue;
        await logLeadEvent({
            leadId: x.leadId,
            eventType: 'INBOUND_MESSAGE',
            metadata: {
                primoMessaggio: x.lead.primoMessaggio,
                scrittoIl: x.lead.scrittoIl?.toISOString() ?? null,
                provenienza: x.lead.funnel,
                conversationId: x.lead.conversationId,
                statoBot: x.lead.statoBot,
            },
            companyId: FENICE,
        });
    }

    // ---------- 3. Intake verso il bot ----------
    // È questo, e solo questo, a riempire `crm_lead_id` dall'altro lato e a far
    // uscire la riga dalla loro lista. Ed è anche l'unica cosa qui dentro che
    // può far arrivare un messaggio a una persona.
    if (spingiIntake) {
        for (const x of adottati) {
            const stato = x.lead.statoBot;
            if (soloChatVive && !chatApertaAlBot(stato)) {
                const e = esiti.find((r) => r.leadId === x.leadId);
                if (e) e.intakeSaltato = `stato '${stato}' escluso da soloChatVive`;
                continue;
            }
            const r = await pushLeadToBot({
                leadId: x.leadId,
                name: x.lead.name,
                phone: x.lead.phone,
                email: null,
                funnel: x.lead.funnel,
                companyId: FENICE,
            });
            const e = esiti.find((row) => row.leadId === x.leadId);
            if (e) e.intake = 'status' in r ? `${r.result} (${r.status})` : r.result;
        }
    }

    // ---------- 4. L'appuntamento che il bot aveva già fissato ----------
    // Passa dal flusso canonico (`updateLeadOutcome` col serviceCtx del bot),
    // non da una UPDATE a mano: è lo stesso percorso di /api/bot/outcome, con
    // eventi, notifiche e transizione verso le Conferme.
    if (applicaAppuntamenti) {
        for (const x of adottati) {
            if (!x.lead.appuntamento) continue;
            const e = esiti.find((row) => row.leadId === x.leadId);
            if (x.bloccato) {
                if (e) e.appuntamento = 'saltato: il lead ha gia un appuntamento o una presenza';
                continue;
            }
            try {
                const res = await updateLeadOutcome(
                    x.leadId,
                    'APPUNTAMENTO',
                    `Appuntamento fissato dal bot prima che il lead esistesse nel CRM (chat entrante${x.lead.conversationId ? ` #${x.lead.conversationId}` : ''}).`,
                    x.lead.appuntamento,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    { companyId: FENICE, actorUserId: bot.id, isBot: true },
                );
                if (e) e.appuntamento = res?.success === true ? 'registrato' : `fallito: ${JSON.stringify(res)}`;
            } catch (err) {
                if (e) e.appuntamento = `errore: ${String(err)}`;
            }
        }
    }

    return NextResponse.json({
        ok: true,
        modalita: 'esecuzione',
        opzioni: { limit, spingiIntake, soloChatVive, applicaAppuntamenti },
        fonte: {
            totale: fonte.totale,
            totaleCompleto: fonte.totaleCompleto,
            listaTagliata: fonte.totaleCompleto > fonte.totale,
        },
        riepilogo,
        creati: esiti.filter((e) => e.creato).length,
        collegati: esiti.filter((e) => e.collegato).length,
        errori: esiti.filter((e) => e.errore).length,
        esiti,
    });
}

/** Tipo esportato solo per leggibilità delle firme sopra. */
export type { Riepilogo };
