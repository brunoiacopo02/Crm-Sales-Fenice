/**
 * Bonifica una tantum dei lead fermi sul bot fissatore (Task 11, seguito dei
 * Task 9-10: il CRM non scrive più `recallDate` per il bot).
 *
 * Chiude per gruppi, nell'ordine A → B → C → D → E (obbligatorio: B prima di
 * C, perché un lead con un richiamo morto merita quel motivo e non
 * "duplicato"; ogni gruppo esclude i lead già presi dai gruppi precedenti,
 * perché in `--esegui` sono già REJECTED e non devono ricomparire in C/D):
 *
 *   A — flood lista 133: intakeBatch = 'DB_LISTA133_20260915'
 *   B — richiami morti: intakeBatch NULL, assignedAt < now()-7d, recallDate NOT NULL
 *   C — gemelli: intakeBatch NULL, assignedAt < now()-7d, altro lead Fenice stesso phone
 *   D — telefoni non chiamabili: intakeBatch NULL, assignedAt < now()-7d, phone non mobile IT
 *   E — richiami ereditati dai vivi: lead di un umano con recallNote 'Sequenza WhatsApp estesa'
 *
 * A-D toccano solo lead del bot, `status IN ('NEW','IN_PROGRESS')` e
 * `presentedAt IS NULL` (l'invariante di `isLeadLocked`): li REJECTAno e
 * liberano l'assegnatario. E non cambia stato né assegnatario: sono lead vivi
 * di un GDO, si toglie solo il richiamo fasullo.
 *
 * Dry-run di default: nessuna scrittura, stampa conteggio + 5 righe di
 * esempio per gruppo. Con `--esegui` ogni gruppo gira nella sua transazione
 * (un errore su un gruppo non tocca quelli già commitati) e scrive un
 * `leadEvents` per ogni lead toccato, così la bonifica resta ricostruibile.
 * Mai un DELETE.
 *
 *   node --import tsx --env-file=.env scripts/bonifica-lead-fermi-bot.ts [--esegui]
 */
import { and, eq, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { leadEvents, leads, users } from '../src/db/schema';

const COMPANY = 'fenice';
const SEVEN_DAYS_AGO = sql`now() - interval '7 days'`;

type GruppoId = 'A' | 'B' | 'C' | 'D' | 'E';

type LeadRow = {
    id: string;
    status: string;
    assignedToId: string | null;
    recallDate: Date | null;
    phone: string;
    name: string;
};

type Gruppo = {
    id: GruppoId;
    label: string;
    discardReason: string | null; // null per E (non è uno scarto: il lead resta vivo)
    /** Candidati REALI: già esclusi i lead presi dai gruppi precedenti. */
    select: (esclusi: Set<string>) => Promise<LeadRow[]>;
};

const selectCols = {
    id: leads.id,
    status: leads.status,
    assignedToId: leads.assignedToId,
    recallDate: leads.recallDate,
    phone: leads.phone,
    name: leads.name,
};

/** `id NOT IN (...)`, omesso quando non c'è ancora nulla da escludere. */
function esclusioneCond(esclusi: Set<string>) {
    return esclusi.size ? notInArray(leads.id, [...esclusi]) : undefined;
}

async function main() {
    // Gate di sicurezza: senza --esegui il ramo di scrittura (eseguiGruppo,
    // che contiene le uniche db.transaction/update/insert del file) non viene
    // mai chiamato. Il dry-run usa solo le SELECT qui sotto.
    const esegui = process.argv.includes('--esegui');

    console.log(`Bonifica lead fermi sul bot — ${esegui ? 'ESECUZIONE (scrive su produzione)' : 'DRY-RUN (nessuna scrittura)'}\n`);

    const bots = await db.select({ id: users.id, name: users.name, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.isBot, true), eq(users.companyId, COMPANY)));

    if (bots.length === 0) {
        console.error('Nessun account bot trovato (users.isBot AND companyId=\'fenice\'). Fermo.');
        process.exit(1);
    }
    if (bots.length > 1) {
        console.warn(`ATTENZIONE: trovati ${bots.length} account bot per '${COMPANY}' (uso IN (...) come guardia, ma verificare se e' voluto):`);
        for (const b of bots) console.warn(`  - ${b.id} (${b.displayName ?? b.name ?? '?'})`);
    } else {
        console.log(`Account bot: ${bots[0]!.id} (${bots[0]!.displayName ?? bots[0]!.name ?? '?'})\n`);
    }
    const botIds = bots.map(b => b.id);

    // Guardia comune ai gruppi A-D — l'invariante di isLeadLocked: non si
    // tocca chi ha prodotto storico (appuntamento o presenza).
    const guardiaComune = [
        eq(leads.companyId, COMPANY),
        inArrayBot(botIds),
        sql`${leads.status} IN ('NEW', 'IN_PROGRESS')`,
        isNull(leads.presentedAt),
    ];

    const gruppi: Gruppo[] = [
        {
            id: 'A',
            label: 'flood lista 133',
            discardReason: "lista 133: infornata a senso unico, mai lavorata",
            select: async (esclusi) => db.select(selectCols).from(leads).where(and(
                ...guardiaComune,
                eq(leads.intakeBatch, 'DB_LISTA133_20260915'),
                esclusioneCond(esclusi),
            )),
        },
        {
            id: 'B',
            label: 'richiami morti',
            discardReason: "voleva essere risentito piu' avanti: il bot non telefona, richiamo mai fatto",
            select: async (esclusi) => db.select(selectCols).from(leads).where(and(
                ...guardiaComune,
                isNull(leads.intakeBatch),
                lt(leads.assignedAt, SEVEN_DAYS_AGO),
                isNotNull(leads.recallDate),
                esclusioneCond(esclusi),
            )),
        },
        {
            id: 'C',
            label: 'gemelli',
            discardReason: 'duplicato per telefono: lavorato sotto un altro lead',
            select: async (esclusi) => db.select(selectCols).from(leads).where(and(
                ...guardiaComune,
                isNull(leads.intakeBatch),
                lt(leads.assignedAt, SEVEN_DAYS_AGO),
                sql`EXISTS (SELECT 1 FROM leads o WHERE o.phone = ${leads.phone} AND o.id <> ${leads.id} AND o."companyId" = ${COMPANY})`,
                esclusioneCond(esclusi),
            )),
        },
        {
            id: 'D',
            label: 'telefoni non chiamabili',
            discardReason: 'telefono non valido',
            select: async (esclusi) => db.select(selectCols).from(leads).where(and(
                ...guardiaComune,
                isNull(leads.intakeBatch),
                lt(leads.assignedAt, SEVEN_DAYS_AGO),
                sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g') !~ '^(39)?3[0-9]{9}$'`,
                esclusioneCond(esclusi),
            )),
        },
        {
            id: 'E',
            label: 'richiami ereditati dai vivi',
            discardReason: null,
            // NON usa la guardia comune: qui il lead resta di un umano, vivo.
            select: async (esclusi) => db.select(selectCols).from(leads)
                .innerJoin(users, eq(users.id, leads.assignedToId))
                .where(and(
                    eq(leads.companyId, COMPANY),
                    eq(users.isBot, false),
                    sql`${leads.recallNote} ILIKE '%Sequenza WhatsApp estesa%'`,
                    isNotNull(leads.recallDate),
                    esclusioneCond(esclusi),
                )),
        },
    ];

    const esclusi = new Set<string>();
    const totali: Record<GruppoId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };

    for (const gruppo of gruppi) {
        const candidati = await gruppo.select(esclusi);
        totali[gruppo.id] = candidati.length;

        console.log(`--- Gruppo ${gruppo.id} (${gruppo.label}): ${candidati.length} lead ---`);
        for (const row of candidati.slice(0, 5)) {
            console.log(`  ${row.id}  ${row.name}  tel=${row.phone}  status=${row.status}  recallDate=${row.recallDate?.toISOString() ?? '-'}`);
        }
        if (candidati.length > 5) console.log(`  ... e altri ${candidati.length - 5}`);
        console.log('');

        if (esegui) {
            await eseguiGruppo(esegui, gruppo, candidati);
        }

        for (const row of candidati) esclusi.add(row.id);
    }

    const totaleGenerale = Object.values(totali).reduce((s, n) => s + n, 0);
    console.log('=== Totali ===');
    for (const g of gruppi) console.log(`  ${g.id} (${g.label}): ${totali[g.id]}`);
    console.log(`  TOTALE: ${totaleGenerale}`);

    if (!esegui) {
        console.log('\nDry-run soltanto: nessuna scrittura. Rilancia con --esegui per applicare.');
    }

    process.exit(0);
}

function inArrayBot(botIds: string[]) {
    return sql`${leads.assignedToId} IN (${sql.join(botIds.map(id => sql`${id}`), sql`, `)})`;
}

/**
 * Unico punto di scrittura del file. Chiamato SOLO da main() quando
 * `--esegui` è presente: `esegui` è ripetuto qui come guardia difensiva, così
 * anche un futuro richiamo scorretto di questa funzione non scrive senza flag.
 */
async function eseguiGruppo(esegui: boolean, gruppo: Gruppo, candidati: LeadRow[]) {
    if (!esegui) throw new Error('eseguiGruppo chiamato senza --esegui: rifiuto di scrivere.');
    if (candidati.length === 0) return;

    await db.transaction(async (tx) => {
        for (const row of candidati) {
            const precedente = { status: row.status, assignedToId: row.assignedToId, recallDate: row.recallDate };

            if (gruppo.id === 'E') {
                const updated = await tx.update(leads).set({
                    recallDate: null,
                    recallNote: null,
                    recallMissedAt: null,
                    updatedAt: new Date(),
                    version: sql`${leads.version} + 1`,
                }).where(and(
                    eq(leads.id, row.id),
                    isNotNull(leads.recallDate),
                )).returning({ id: leads.id });
                if (updated.length === 0) continue; // cambiato tra select e update: salto
            } else {
                const updated = await tx.update(leads).set({
                    status: 'REJECTED',
                    assignedToId: null,
                    discardReason: gruppo.discardReason!,
                    recallDate: null,
                    recallNote: null,
                    recallMissedAt: null,
                    updatedAt: new Date(),
                    version: sql`${leads.version} + 1`,
                }).where(and(
                    eq(leads.id, row.id),
                    sql`${leads.status} IN ('NEW', 'IN_PROGRESS')`,
                    isNull(leads.presentedAt),
                )).returning({ id: leads.id });
                if (updated.length === 0) continue; // cambiato tra select e update: salto
            }

            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId: row.id,
                eventType: 'BONIFICA_LEAD_FERMO',
                userId: null,
                timestamp: new Date(),
                metadata: { gruppo: gruppo.id, discardReason: gruppo.discardReason, precedente },
                companyId: COMPANY,
            });
        }
    });

    console.log(`  Gruppo ${gruppo.id}: eseguito (${candidati.length} lead).`);
}

main().catch(e => { console.error('ERRORE:', e?.stack ?? e); process.exit(1); });
