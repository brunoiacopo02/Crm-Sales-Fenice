import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { leads, users } from '@/db/schema';
import { createClient } from '@/utils/supabase/server';
import { pushLeadToBot } from '@/lib/bot-fissatore/push';
import { updateLeadOutcome } from '@/app/actions/pipelineActions';
import {
    chatApertaAlBot,
    fetchLeadEntranti,
    intakeSicuro,
    normalizzaLeadEntrante,
    pianificaAdozione,
    type Azione,
    type LeadEntranteNormalizzato,
    type LeadEsistente,
} from '@/lib/bot-fissatore/leadEntranti';
import { adottaLead, FENICE } from '@/lib/bot-fissatore/adozione';

export const dynamic = 'force-dynamic';

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
 * messaggio è solo il push dell'intake verso il bot, e solo quando il bot non ha
 * ancora scritto in quella chat — vedi `intakeSicuro`, che è una condizione
 * dura e non un'opzione: `spingiIntake` non la scavalca, nessun flag la
 * scavalca. Un lead senza `botHaRisposto: true` non riceve l'intake, punto.
 *
 * `spingiIntake` resta false di default: `{"conferma": true}` da solo crea i
 * lead e basta.
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
        /** Pronti a ricevere l'intake senza che parta niente. */
        intakeSicuro: adottabili.filter((a) => intakeSicuro(a.lead)).length,
        /**
         * Adottati a cui il bot non ha ancora scritto. Normalmente sono zero o
         * quasi (la risposta parte in qualche decina di secondi): un numero alto
         * qui significa che il loro drain è fermo, ed è da guardare subito.
         */
        botNonHaAncoraRisposto: adottabili.filter((a) => a.lead.botHaRisposto === false).length,
        /** Campo non dichiarato: loro deploy vecchio o rollback. Blocca come `false`. */
        botHaRispostoNonDichiarato: adottabili.filter((a) => a.lead.botHaRisposto === null).length,
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
            botHaRisposto: a.lead.botHaRisposto,
            intakeSicuro: intakeSicuro(a.lead),
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
     * Restringe ulteriormente il push alle chat `active`/`replying`. NON è la
     * protezione contro le aperture — quella è `intakeSicuro` e non si
     * disattiva. Serve solo a chi vuole procedere per gradi.
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
    type Esito = {
        telefono: string;
        leadId?: string;
        creato?: boolean;
        collegato?: boolean;
        intake?: string;
        intakeSaltato?: string;
        appuntamento?: string;
        errore?: string;
    };
    const esiti: Esito[] = [];

    /**
     * I lead adottati, con il RIFERIMENTO alla loro riga di esito: i passi
     * successivi ci scrivono sopra. Tenere l'oggetto invece di ricercarlo per
     * `leadId` a ogni passo toglie di mezzo tutta una classe di sbagli (righe
     * senza leadId, due righe sullo stesso lead) invece di doverla escludere
     * caso per caso.
     */
    const adottati: Array<{ leadId: string; lead: LeadEntranteNormalizzato; bloccato: boolean; esito: Esito }> = [];

    // ---------- 1. Creazione / collegamento ----------
    // La logica sta in `adottaLead`, condivisa con /api/bot/lead-entrante: due
    // copie divergerebbero, e i due canali devono comportarsi identici.
    for (const a of azioni!) {
        if (a.azione === 'scarta') continue;
        try {
            const res = await adottaLead(a.lead, bot.id);
            if (res.esito === 'altra_azienda') {
                esiti.push({ telefono: a.lead.phone, errore: `numero di un'altra azienda (${res.companyId})` });
                continue;
            }
            const esito: Esito = {
                telefono: a.lead.phone,
                leadId: res.leadId,
                creato: res.esito === 'creato',
                collegato: res.esito === 'esistente',
            };
            esiti.push(esito);
            adottati.push({ leadId: res.leadId, lead: a.lead, bloccato: res.bloccato, esito });
        } catch (e) {
            esiti.push({ telefono: a.lead.phone, errore: String(e) });
        }
    }

    // ---------- 2. Intake verso il bot ----------
    // È questo, e solo questo, a riempire `crm_lead_id` dall'altro lato e a far
    // uscire la riga dalla loro lista. Ed è anche l'unica cosa qui dentro che
    // può far arrivare un messaggio a una persona.
    if (spingiIntake) {
        for (const x of adottati) {
            const e = x.esito;
            // Condizione dura, prima di ogni opzione: senza un messaggio già
            // partito dal bot, l'intake fa partire l'apertura.
            if (!intakeSicuro(x.lead)) {
                e.intakeSaltato = x.lead.botHaRisposto === null
                    ? 'il bot non dichiara botHaRisposto (deploy vecchio?)'
                    : "il bot non ha ancora scritto in questa chat: l'apertura partirebbe";
                continue;
            }
            if (soloChatVive && !chatApertaAlBot(x.lead.statoBot)) {
                e.intakeSaltato = `stato '${x.lead.statoBot}' escluso da soloChatVive`;
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
            e.intake = 'status' in r ? `${r.result} (${r.status})` : r.result;
        }
    }

    // ---------- 3. L'appuntamento che il bot aveva già fissato ----------
    // Passa dal flusso canonico (`updateLeadOutcome` col serviceCtx del bot),
    // non da una UPDATE a mano: è lo stesso percorso di /api/bot/outcome, con
    // eventi, notifiche e transizione verso le Conferme.
    if (applicaAppuntamenti) {
        for (const x of adottati) {
            if (!x.lead.appuntamento) continue;
            const e = x.esito;
            if (x.bloccato) {
                e.appuntamento = 'saltato: il lead ha gia un appuntamento o una presenza';
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
                e.appuntamento = res?.success === true ? 'registrato' : `fallito: ${JSON.stringify(res)}`;
            } catch (err) {
                e.appuntamento = `errore: ${String(err)}`;
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
