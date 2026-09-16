import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { db } from '@/db';
import { leads, users, leadEvents } from '@/db/schema';
import {
    pianificaRibilanciamento, idSorgenti, eOraDelGiro,
    type GdoPoolState, type LeadRibilanciabile,
} from '@/lib/gdoPools/rebalance';
import { BATCH_FREDDI } from '@/lib/intakeBatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * ATTENZIONE — NON ACCENDERE SENZA UNA NUOVA DECISIONE DEL PO.
 *
 * Questo cron è stato costruito il 15/09/2026 e poi messo da parte lo stesso
 * giorno, prima di essere acceso. Il PO voleva una cosa più stretta: che i lead
 * che il bot restituisce DA QUEL MOMENTO IN POI finiscano ai GDO del pool
 * ridati — e quello lo fa già `reassignBotLeadToHumanPool`, che da allora
 * guarda `botReturnIntake` invece di `acAutoIntake`. Non voleva invece che ai
 * GDO dei freschi venissero tolti i ridati che avevano GIÀ in mano: il
 * 15/09 erano 80 a testa, ed è il lavoro con cui campano finché i freschi non
 * arrivano a regime.
 *
 * Questo cron fa proprio quest'ultima cosa: ripulisce all'indietro, ogni sera.
 * Acceso adesso svuoterebbe 106, 112 e 119 lasciandoli con i soli freschi del
 * giorno (max 60 a testa per via del tetto), cioè con MENO lavoro degli altri.
 *
 * Resta qui perché la logica è scritta e testata e può servire se un domani i
 * pool andassero alla deriva. Ma accenderlo è una decisione, non una
 * configurazione: l'interruttore `GDO_REBALANCE_ENABLED` è spento in produzione
 * ed è giusto che lo resti finché qualcuno non decide diversamente.
 */

/** I pool di assegnazione vivono solo su Fenice: il bot fissatore è di Fenice. */
const FENICE = 'fenice';

/**
 * Tetto di lead esaminati in un giro. Serve a tenere la transazione corta: se
 * una sera ne restano fuori, il giro della sera dopo li prende — il lavoro è
 * idempotente, non c'è una coda da smaltire per forza stanotte.
 */
const MAX_LEAD = 3000;

/** Quanti lead per UPDATE. Un `id = ANY(...)` da tremila elementi è una query che nessuno sa più leggere in un piano. */
const LOTTO = 200;

const ON_VALUES = new Set(['1', 'on']);



/**
 * Ribilanciamento serale dei pool GDO: i lead RIDATI dal bot finiti in mano al
 * pool FRESCHI tornano ai GDO del pool ridati.
 *
 * Perché un cron e non un bottone: il PO lo vuole ogni sera senza che nessuno
 * debba avere il PC acceso, e finora lo spostamento si faceva a mano da
 * /gestione — cioè non si faceva.
 *
 * ORARIO. Schedulato in vercel.json a 18:30 e 19:30 UTC, con la guardia
 * `eOraDelGiro` che fa lavorare solo quella che a Roma è davvero l'ora delle
 * 20. Vercel Cron è in UTC e ignora l'ora legale: senza le due righe il giro
 * slitterebbe di un'ora a fine ottobre. Con `?force=1` si salta la guardia per
 * provarlo a mano (la chiamata resta comunque protetta dal CRON_SECRET).
 *
 * Interruttore: env GDO_REBALANCE_ENABLED, '1' o 'on'. Assente = spento: questo
 * giro riscrive l'assegnazione di lead altrui, quindi il default è non farlo.
 */
export async function GET(req: Request) {
    // PRIMA il Bearer, POI la diagnosi sulla env: con l'ordine opposto un
    // anonimo che chiama l'URL senza header si porta a casa quale env manca.
    const secret = process.env.CRON_SECRET;
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }
    if (!secret) {
        return NextResponse.json({ error: 'CRON_SECRET non impostata' }, { status: 500 });
    }

    const enabled = (process.env.GDO_REBALANCE_ENABLED || '').trim().toLowerCase();
    if (!ON_VALUES.has(enabled)) {
        return NextResponse.json({ ok: true, skipped: 'disabled' });
    }

    const force = new URL(req.url).searchParams.get('force') === '1';
    if (!force && !eOraDelGiro(new Date())) {
        return NextResponse.json({ ok: true, skipped: 'fuori_orario' });
    }

    // I conteggi dei mai-chiamati arrivano come sottoquery correlata, come in
    // listGdoPools: un giro solo invece di una query per GDO.
    const gdos: GdoPoolState[] = await db.select({
        id: users.id,
        isActive: users.isActive,
        freschi: users.acAutoIntake,
        ridati: users.botReturnIntake,
        maiChiamati: sql<number>`(
            SELECT count(*)::int FROM leads l
            WHERE l."assignedToId" = ${users.id}
              AND l."companyId" = ${FENICE}
              AND l.status = 'NEW' AND l."callCount" = 0
        )`,
    }).from(users).where(and(
        eq(users.companyId, FENICE),
        eq(users.role, 'GDO'),
        // Il bot fissatore è un account GDO a tutti gli effetti, ma i suoi lead
        // li gestisce il suo flusso: non è né una sorgente né un destinatario.
        eq(users.isBot, false),
    ));

    const sorgenti = idSorgenti(gdos);
    if (sorgenti.length === 0) {
        return NextResponse.json({ ok: true, scansionati: 0, spostati: 0, motivo: 'nessun_gdo_freschi' });
    }

    const righe = await db.select({
        id: leads.id,
        assignedToId: leads.assignedToId,
        status: leads.status,
        appointmentDate: leads.appointmentDate,
        presentedAt: leads.presentedAt,
    }).from(leads).where(and(
        eq(leads.companyId, FENICE),
        inArray(leads.status, ['NEW', 'IN_PROGRESS']),
        // Doppia guardia con `bloccato()` nel modulo puro: un appuntamento
        // fissato o una presenza registrata non si spostano mai, e non basta
        // che lo stato sia ancora aperto per crederlo libero.
        isNull(leads.appointmentDate),
        isNull(leads.presentedAt),
        inArray(leads.assignedToId, sorgenti),
        // Le due prove che il lead è coda fredda e non un fresco di giornata:
        // l'evento scritto da reassignBotLeadToHumanPool, oppure l'appartenenza
        // a una infornata ESPLICITAMENTE elencata in BATCH_FREDDI.
        //
        // L'elenco è una lista chiusa e non un "intakeBatch IS NOT NULL" di
        // proposito: quel campo marca le infornate di INGRESSO, non i ritorni
        // del bot. Oggi l'unico valore vivo è il flood della lista 133, che in
        // effetti è coda fredda; ma il giorno in cui si marcasse con lo stesso
        // campo un'infornata di lead FRESCHI, questo cron gliela porterebbe via
        // ogni sera proprio ai GDO che devono lavorare i freschi. Aggiungere un
        // batch qui deve essere una decisione, non un effetto collaterale.
        sql`(${leads.intakeBatch} = ANY(${BATCH_FREDDI}) OR EXISTS (
            SELECT 1 FROM "leadEvents" e
            WHERE e."leadId" = ${leads.id} AND e."eventType" = 'REASSIGNED_FROM_BOT'
        ))`,
    )).orderBy(asc(leads.id)).limit(MAX_LEAD);

    const lead: LeadRibilanciabile[] = righe.map((r) => ({
        id: r.id,
        assignedToId: r.assignedToId,
        ridatoDalBot: true, // la query non ne fa passare altri
        status: r.status,
        appointmentDate: r.appointmentDate,
        presentedAt: r.presentedAt,
    }));

    const piano = pianificaRibilanciamento({ gdos, lead });

    if (piano.spostamenti.length === 0) {
        return NextResponse.json({
            ok: true, scansionati: righe.length, spostati: 0, motivo: piano.motivo,
        });
    }

    const now = new Date();

    // Un lead può andare a un solo destinatario, quindi gli UPDATE si
    // raggruppano per destinatario e poi si spezzano in lotti.
    const perDestinatario = new Map<string, string[]>();
    for (const s of piano.spostamenti) {
        const lista = perDestinatario.get(s.a);
        if (lista) lista.push(s.leadId);
        else perDestinatario.set(s.a, [s.leadId]);
    }

    // Tutto in UNA transazione: lo spostamento e il suo evento devono vivere o
    // morire insieme, altrimenti resta un lead cambiato di mano senza una riga
    // che dica quando e perché — ed è esattamente la domanda che arriva il
    // giorno dopo ("i miei lead sono spariti").
    await db.transaction(async (tx) => {
        for (const [dest, ids] of perDestinatario) {
            for (let i = 0; i < ids.length; i += LOTTO) {
                const lotto = ids.slice(i, i + LOTTO);
                await tx.update(leads)
                    // `assignedAt` NON si tocca: il lead era già stato contato
                    // quando è entrato in circolo, non entra oggi. `version` sì,
                    // perché è il contatore su cui il realtime riconosce l'update.
                    .set({ assignedToId: dest, updatedAt: now, version: sql`${leads.version} + 1` })
                    .where(sql`${leads.id} = ANY(${lotto})`);
            }
        }

        const eventi = piano.spostamenti.map((s) => ({
            id: crypto.randomUUID(),
            leadId: s.leadId,
            eventType: 'ASSIGNED' as const,
            userId: s.a,
            timestamp: now,
            metadata: {
                via: 'cron_rebalance_pool',
                da: s.da,
                a: s.a,
                motivo: 'lead ridato dal bot in carico al pool freschi: ribilanciamento automatico serale',
            },
            companyId: FENICE,
        }));
        for (let i = 0; i < eventi.length; i += LOTTO) {
            await tx.insert(leadEvents).values(eventi.slice(i, i + LOTTO));
        }
    });

    // `botReturnLastAssignedAt` resta com'è di proposito: è il cursore di equità
    // del round-robin dei ritorni dal bot in tempo reale. Toccarlo qui farebbe
    // contare due volte lo stesso carico — una nel pareggio di stasera, una nel
    // turno di domani — e i due flussi si sposterebbero il turno a vicenda.

    return NextResponse.json({
        ok: true,
        scansionati: righe.length,
        spostati: piano.spostamenti.length,
        perDestinatario: piano.perDestinatario,
        caricoFinale: piano.caricoFinale,
        // Chi ha ceduto e quanto: è la riga che serve a capire a colpo d'occhio
        // se il giro ha corretto una deriva o ne sta rincorrendo una nuova.
        daChi: piano.spostamenti.reduce<Record<string, number>>((acc, s) => {
            acc[s.da] = (acc[s.da] ?? 0) + 1;
            return acc;
        }, {}),
    });
}
