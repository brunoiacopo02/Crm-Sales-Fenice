/**
 * Riallinea al CRM marketing le chiusure che nel nostro DB sono cambiate DOPO
 * l'invio dell'evento — o che non sono mai passate da un server action.
 *
 * Perche' serve: `deal.closed_won` / `deal.closed_lost` partono da
 * saveVenditoreOutcome. Ogni volta che una chiusura viene scritta o corretta
 * fuori da li' — import storici, bonifiche SQL, riconciliazioni col foglio
 * Database Clienti — il marketing resta fermo all'ultimo valore che gli
 * abbiamo mandato, e il loro fatturato diverge dal nostro in silenzio.
 *
 * Cosa fa: confronta lo stato corrente di ogni lead esitato dal venditore con
 * l'ULTIMO evento di chiusura che gli abbiamo consegnato, e ricostruisce un
 * envelope aggiornato per le sole divergenze. Tre categorie:
 *
 *   MAI_INVIATO      il lead e' esitato ma non gli abbiamo mai mandato la chiusura
 *   IMPORTO_DIVERSO  closed_won consegnato, ma closeAmountEur oggi e' un altro
 *   ESITO_CAMBIATO   l'ultimo evento dice vinto e oggi non lo e' piu' (o viceversa)
 *
 * ⚠️ PRIMA DI USARE --live: gli eventi rispediti hanno un eventId NUOVO (il
 * bucket e' il secondo di occurredAt, che qui e' "adesso"), quindi la dedup
 * lato loro NON li scarta. Se il receiver accumula gli eventi invece di fare
 * upsert per lead, un secondo closed_won sullo stesso lead RADDOPPIA il
 * fatturato di quel lead. Va confermato con loro che l'ultimo evento per lead
 * vince prima di sparare. Vedi docs/marketing-riallineamento-chiusure.md.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/resyncMarketingClosures.ts [--live]
 *                                                             [--only MAI_INVIATO|IMPORTO_DIVERSO|ESITO_CAMBIATO]
 *                                                             [--since 2026-05-01] [--target-url <url>]
 *
 * Senza --live stampa solo il referto. Idempotente sul PK (ON CONFLICT DO NOTHING).
 */
import 'dotenv/config';
import { desc, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../src/db';
import { leads, users, marketingWebhookDeliveries } from '../src/db/schema';
import { buildDealClosedWon, buildDealClosedLost } from '../src/lib/marketing-webhooks/payload-builders';
import type { MarketingWebhookEnvelope } from '../src/lib/marketing-webhooks/types';

type Categoria = 'MAI_INVIATO' | 'IMPORTO_DIVERSO' | 'ESITO_CAMBIATO';

interface Divergenza {
    categoria: Categoria;
    leadId: string;
    nome: string;
    funnel: string | null;
    esitoAl: Date | null;
    esitoCrm: string;
    importoCrm: number | null;
    importoMarketing: number | null;
    tipoAtteso: 'deal.closed_won' | 'deal.closed_lost';
    tipoInviato: string | null;
}

function parseArgs() {
    const args = process.argv.slice(2);
    let live = false;
    let only: Categoria | null = null;
    let since: Date | null = null;
    let targetUrl: string | null = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--live') live = true;
        else if (args[i] === '--only') only = args[++i] as Categoria;
        else if (args[i] === '--since') since = new Date(args[++i]);
        else if (args[i] === '--target-url') targetUrl = args[++i];
    }
    return { live, only, since, targetUrl };
}

const eur = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : `${n.toLocaleString('it-IT')} €`;

async function main() {
    const { live, only, since, targetUrl: argTargetUrl } = parseArgs();

    const envUrl = process.env.MARKETING_WEBHOOK_URL_PROD;
    const targetUrl = argTargetUrl ?? (envUrl && envUrl.length > 0 ? envUrl : null);
    if (!targetUrl) {
        console.error('Manca la URL del receiver: passa --target-url <url> oppure popola MARKETING_WEBHOOK_URL_PROD');
        process.exit(2);
    }

    // Tutti i lead che il venditore ha esitato: sono gli unici per cui esiste
    // una chiusura da tenere allineata.
    const esitati = await db.select().from(leads).where(isNotNull(leads.salespersonOutcome));

    // Ultimo evento di chiusura consegnato per lead. Leggiamo l'intero storico
    // dei due tipi e teniamo il piu' recente: l'outbox non ha un indice per
    // "ultimo per lead" e il volume (poco piu' di mille righe) non lo richiede.
    const consegne = await db.select({
        leadId: marketingWebhookDeliveries.leadId,
        eventType: marketingWebhookDeliveries.eventType,
        payload: marketingWebhookDeliveries.payload,
        createdAt: marketingWebhookDeliveries.createdAt,
    })
        .from(marketingWebhookDeliveries)
        .where(inArray(marketingWebhookDeliveries.eventType, ['deal.closed_won', 'deal.closed_lost']))
        .orderBy(desc(marketingWebhookDeliveries.createdAt));

    const ultimaConsegna = new Map<string, { eventType: string; amountEur: number | null }>();
    for (const c of consegne) {
        if (ultimaConsegna.has(c.leadId)) continue; // gia' visto = piu' recente
        const raw = (c.payload as MarketingWebhookEnvelope | null)?.data as { amountEur?: number | null } | undefined;
        ultimaConsegna.set(c.leadId, {
            eventType: c.eventType,
            amountEur: raw?.amountEur ?? null,
        });
    }

    const divergenze: Divergenza[] = [];
    for (const lead of esitati) {
        if (since && (!lead.salespersonOutcomeAt || lead.salespersonOutcomeAt < since)) continue;

        const vinto = lead.salespersonOutcome === 'Chiuso';
        const tipoAtteso = vinto ? 'deal.closed_won' as const : 'deal.closed_lost' as const;
        const inviato = ultimaConsegna.get(lead.id) ?? null;

        let categoria: Categoria | null = null;
        if (!inviato) categoria = 'MAI_INVIATO';
        else if (inviato.eventType !== tipoAtteso) categoria = 'ESITO_CAMBIATO';
        else if (vinto && inviato.amountEur !== lead.closeAmountEur) categoria = 'IMPORTO_DIVERSO';

        if (!categoria) continue;
        if (only && categoria !== only) continue;

        divergenze.push({
            categoria,
            leadId: lead.id,
            nome: lead.name ?? '(senza nome)',
            funnel: lead.funnel,
            esitoAl: lead.salespersonOutcomeAt,
            esitoCrm: lead.salespersonOutcome!,
            importoCrm: lead.closeAmountEur,
            importoMarketing: inviato?.amountEur ?? null,
            tipoAtteso,
            tipoInviato: inviato?.eventType ?? null,
        });
    }

    // Referto
    console.log(`Receiver: ${targetUrl}`);
    console.log(`Modo: ${live ? 'LIVE (INSERT in outbox)' : 'DRY-RUN'}`);
    console.log(`Lead esitati dal venditore: ${esitati.length}`);
    console.log(`Divergenze: ${divergenze.length}\n`);

    for (const cat of ['MAI_INVIATO', 'IMPORTO_DIVERSO', 'ESITO_CAMBIATO'] as Categoria[]) {
        const gruppo = divergenze.filter(d => d.categoria === cat);
        if (gruppo.length === 0) continue;
        const crm = gruppo.reduce((s, d) => s + (d.categoria === 'ESITO_CAMBIATO' ? 0 : (d.importoCrm ?? 0)), 0);
        const mkt = gruppo.reduce((s, d) => s + (d.importoMarketing ?? 0), 0);
        console.log(`── ${cat}: ${gruppo.length} lead | CRM ${eur(crm)} · marketing ${eur(mkt)}`);
        for (const d of gruppo) {
            const data = d.esitoAl ? d.esitoAl.toISOString().slice(0, 10) : '————-——';
            console.log(`   ${data}  ${d.nome.slice(0, 28).padEnd(28)} ${(d.funnel ?? '').slice(0, 14).padEnd(14)} ` +
                `marketing ${eur(d.importoMarketing).padStart(10)} → CRM ${eur(d.importoCrm).padStart(10)}` +
                (d.categoria === 'ESITO_CAMBIATO' ? `  [${d.tipoInviato} → ${d.esitoCrm}]` : ''));
        }
        console.log('');
    }

    const deltaFatturato = divergenze
        .filter(d => d.tipoAtteso === 'deal.closed_won')
        .reduce((s, d) => s + (d.importoCrm ?? 0) - (d.importoMarketing ?? 0), 0);
    const fatturatoFantasma = divergenze
        .filter(d => d.categoria === 'ESITO_CAMBIATO' && d.tipoInviato === 'deal.closed_won')
        .reduce((s, d) => s + (d.importoMarketing ?? 0), 0);
    console.log(`Fatturato che il marketing non vede: ${eur(deltaFatturato)}`);
    console.log(`Fatturato che il marketing vede e non esiste piu': ${eur(fatturatoFantasma)}`);

    if (!live) {
        console.log('\nDRY-RUN: nessun INSERT. Aggiungi --live per accodare gli eventi correttivi.');
        console.log('Prima di farlo: il receiver deve fare upsert per lead, non accumulare (vedi testata del file).');
        process.exit(0);
    }

    if (divergenze.length === 0) {
        console.log('\nNiente da riallineare.');
        process.exit(0);
    }

    // Attori, per non mandare salesperson: null su eventi che ce l'hanno
    const attoriIds = [...new Set(esitati.map(l => l.salespersonUserId).filter((x): x is string => !!x))];
    const attori = attoriIds.length
        ? await db.select({ id: users.id, name: users.name, displayName: users.displayName, role: users.role })
            .from(users).where(inArray(users.id, attoriIds))
        : [];
    const attoreById = new Map(attori.map(u => [u.id, u]));
    const leadById = new Map(esitati.map(l => [l.id, l]));

    // occurredAt = adesso: l'eventId e' bucketizzato al secondo, quindi
    // l'evento correttivo non collide con quello vecchio. closedAt dentro
    // `data` resta la data vera dell'esito, che e' quella che conta per loro.
    const now = new Date();
    const envelopes: MarketingWebhookEnvelope[] = divergenze.map(d => {
        const lead = leadById.get(d.leadId)!;
        const ctx = { lead, actor: attoreById.get(lead.salespersonUserId ?? '') ?? null, occurredAt: now };
        return d.tipoAtteso === 'deal.closed_won' ? buildDealClosedWon(ctx) : buildDealClosedLost(ctx);
    });

    let inserted = 0;
    const CHUNK = 200;
    for (let i = 0; i < envelopes.length; i += CHUNK) {
        const slice = envelopes.slice(i, i + CHUNK);
        const res = await db.insert(marketingWebhookDeliveries).values(
            slice.map(env => ({
                id: env.eventId,
                eventType: env.eventType,
                leadId: env.lead.id,
                payload: env,
                targetUrl,
                status: 'pending' as const,
                nextAttemptAt: new Date(),
            }))
        ).onConflictDoNothing({ target: marketingWebhookDeliveries.id })
            .returning({ id: marketingWebhookDeliveries.id });
        inserted += res.length;
    }

    console.log(`\nAccodati ${inserted} eventi correttivi su ${envelopes.length}. Li consegna il cron marketing-webhooks-drain.`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
