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
 * esempio per gruppo. Con `--esegui` ogni gruppo gira nella sua transazione:
 * un errore in un gruppo INTERROMPE l'esecuzione (i gruppi già commitati
 * PRIMA di lui restano commitati — sono transazioni chiuse — ma i gruppi
 * successivi non partono più). Ogni lead toccato riceve un `leadEvents`, così
 * la bonifica resta ricostruibile. Mai un DELETE.
 *
 * ATTENZIONE se un giorno si lancia con `--esegui`: farlo FUORI dall'orario
 * operativo. Ogni riga viene bloccata con `SELECT ... FOR UPDATE` e il lock
 * resta per tutta la durata della transazione del SUO gruppo (non solo per
 * quella riga): un gruppo con centinaia di righe (es. A, ~350) tiene quei
 * lock fino al commit finale del gruppo, e in quella finestra un GDO/bot che
 * tenta di scrivere sullo stesso lead resterebbe in attesa.
 *
 *   node --import tsx --env-file=.env scripts/bonifica-lead-fermi-bot.ts [--esegui]
 *
 * --- Fix round 1 (review 2026-09-24) ---
 * - Il predicato di ogni gruppo (guardia + clausola specifica) è costruito
 *   UNA VOLTA (`gruppo.condizioni`) e riusato IDENTICO sia nella SELECT dei
 *   candidati sia nel WHERE della UPDATE: prima la UPDATE controllava solo
 *   id/status/presentedAt, quindi non riasseriva assignedToId=bot né
 *   companyId — un lead ripreso da un umano nel frattempo (timer 96h /
 *   botReturnIntake) tra la SELECT e la transazione poteva finire REJECTED e
 *   spossessato per errore, con un `precedente` falso in leadEvents.
 * - Dentro la transazione, ogni riga viene ri-letta con `SELECT ... FOR
 *   UPDATE` filtrando di nuovo per l'intero predicato del gruppo: se non
 *   matcha più (perché nel frattempo è cambiata) viene saltata (`saltati`),
 *   non forzata. Il `precedente` loggato viene dalla riga così bloccata, non
 *   dalla SELECT iniziale, e include anche recallNote/recallMissedAt/
 *   discardReason (prima mancavano: senza non è possibile ripristinare un
 *   lead con precisione).
 * - Il gruppo E ora riafferma nella UPDATE lo stesso predicato della SELECT
 *   (recallNote ILIKE, assegnatario non-bot, companyId) e in più la guardia
 *   status IN ('NEW','IN_PROGRESS') AND presentedAt IS NULL (decisione del
 *   controller: E prima non l'aveva, e poteva azzerare i campi di richiamo
 *   anche su un lead già in APPOINTMENT o presentato).
 * - In `--esegui` i conteggi finali sono le righe REALMENTE scritte
 *   (`RETURNING`), non più i candidati selezionati: i due numeri sono
 *   stampati separati (candidati / scritti / saltati). In dry-run resta il
 *   conteggio dei candidati (non c'è nulla da "scrivere davvero").
 *
 * --- Fix round 2 (review 2026-09-24) ---
 * - CRITICO: il gruppo C leggeva lo stato dei "gemelli" in modo incoerente
 *   tra dry-run e `--esegui`. In `--esegui` i gruppi girano in ordine e
 *   ciascuno COMMITTA prima che parta il successivo: quando C parte, B ha
 *   già rigettato i suoi lead (assignedToId=NULL, status='REJECTED'). Il
 *   check "il gemello non è lui stesso fermo sul bot" era
 *   `NOT (assignedToId IN bot AND status IN (...) AND assignedAt<7d)`: per
 *   un lead appena rigettato da B questo diventa `NOT(false)` = vero, quindi
 *   quel lead torna a contare come "gemello valido" — ma è esattamente il
 *   lead che la bonifica ha appena scartato, non uno "lavorato sotto un
 *   altro lead". In dry-run invece quel lead non è mai stato toccato e resta
 *   "fermo sul bot", quindi il check lo escludeva correttamente: i due modi
 *   di girare lo script darebbero numeri (e scarti) diversi. Fix: la stessa
 *   sub-condizione ora esclude anche i gemelli che questa bonifica ha già
 *   marcato (`NOT EXISTS (... leadEvents.eventType='BONIFICA_LEAD_FERMO'
 *   ...)`), che in dry-run non trova mai nulla (non si scrive mai) e in
 *   `--esegui` trova esattamente i lead già rigettati dai gruppi precedenti
 *   — stessa cosa che il dry-run stava già simulando. Come bonus, questo
 *   rende coerenti anche i ri-lanci su un DB già parzialmente bonificato.
 *   I gruppi D ed E NON hanno questo problema: nessuno dei due referenzia lo
 *   stato di ALTRI lead (D guarda solo il telefono del candidato; E guarda
 *   solo i propri campi e l'isBot del proprio assegnatario) — l'unica
 *   dipendenza incrociata fra gruppi di tutto il file è il "gemello" di C.
 * - MINOR (NULL): la stessa sub-condizione andava in NULL, non in false,
 *   quando il gemello ha `assignedToId IS NULL` (es. un lead di POOL non
 *   ancora assegnato a nessuno): `NULL IN (...)` è NULL in SQL, non false,
 *   quindi l'intero AND propagava NULL e quel gemello spariva in silenzio
 *   dall'EXISTS (né contato né escluso esplicitamente) invece di contare
 *   come gemello valido — un lead di pool non assegnato non è "fermo sul
 *   bot", verrà lavorato dal pool, quindi il duplicato è reale. Fix:
 *   `NOT COALESCE(assignedToId IN (...) AND status IN (...) AND assignedAt
 *   < ..., false)` — il COALESCE sull'intera congiunzione la rende un
 *   booleano certo (false quando un pezzo è NULL), eliminando anche il caso
 *   limite gemellare (assignedToId=bot ma assignedAt NULL).
 *
 * --- Deviazioni dal brief decise da PO/controller (2026-09-24) ---
 * - Gruppo C (gemelli): un "gemello" ora NON conta se (a) è lui stesso un
 *   lead della lista133 (`intakeBatch = 'DB_LISTA133_20260915'`) — altrimenti
 *   quasi metà dei match di C erano solo rumore della flood del 15/09, mai
 *   lavorato da nessuno — né se (b) è lui stesso un altro lead fermo sul bot
 *   con gli stessi criteri di B/D (assegnato al bot, NEW/IN_PROGRESS,
 *   assignedAt oltre 7gg): un "gemello" così non è "lavorato sotto un altro
 *   lead", è solo un secondo lead altrettanto fermo. In più, il gruppo C
 *   richiede ora che il telefono del CANDIDATO stesso non sia banale
 *   (≥9 cifre): due numeri spazzatura (es. "87", "377943") non devono
 *   "gemellarsi" a vicenda — cadono in D con `discardReason='telefono non
 *   valido'`, che è la diagnosi corretta.
 * - Gruppo D (telefoni non chiamabili): il regex ora accetta fino a due zeri
 *   iniziali prima del 39 (`^0{0,2}(39)?3[0-9]{9}$`), perché "+0393209530413"
 *   è un prefisso internazionale scritto con lo zero di composizione, non un
 *   numero rotto.
 */
import { and, eq, isNotNull, isNull, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../src/db';
import { leadEvents, leads, users } from '../src/db/schema';

const COMPANY = 'fenice';
const SEVEN_DAYS_AGO = sql`now() - interval '7 days'`;

type GruppoId = 'A' | 'B' | 'C' | 'D' | 'E';

type Gruppo = {
    id: GruppoId;
    label: string;
    discardReason: string | null; // null per E (non è uno scarto: il lead resta vivo)
    /**
     * Guardia + clausola specifica del gruppo. IDENTICHE in SELECT (per
     * trovare i candidati) e in UPDATE (per riverificare, riga per riga,
     * dentro la transazione, che il lead sia ancora esattamente quello che
     * doveva essere toccato).
     */
    condizioni: SQL[];
};

const selectCols = {
    id: leads.id,
    status: leads.status,
    assignedToId: leads.assignedToId,
    recallDate: leads.recallDate,
    recallNote: leads.recallNote,
    recallMissedAt: leads.recallMissedAt,
    discardReason: leads.discardReason,
    phone: leads.phone,
    name: leads.name,
};

/** `id NOT IN (...)`, omesso quando non c'è ancora nulla da escludere. */
function esclusioneCond(esclusi: Set<string>): SQL | undefined {
    return esclusi.size ? notInArray(leads.id, [...esclusi]) : undefined;
}

function sqlIdList(ids: string[]) {
    return sql.join(ids.map(id => sql`${id}`), sql`, `);
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
    const botIdList = sqlIdList(botIds);

    // Guardia comune ai gruppi A-D — l'invariante di isLeadLocked: non si
    // tocca chi ha prodotto storico (appuntamento o presenza) — più
    // l'appartenenza al bot. E' la STESSA lista di condizioni usata sia per
    // selezionare i candidati sia per riverificarli nella UPDATE (C1).
    const guardiaComune: SQL[] = [
        eq(leads.companyId, COMPANY),
        sql`${leads.assignedToId} IN (${botIdList})`,
        sql`${leads.status} IN ('NEW', 'IN_PROGRESS')`,
        isNull(leads.presentedAt),
    ];

    // Guardia del gruppo E: lead di un UMANO (non del bot), vivo (stessa
    // guardia status/presentedAt di A-D per decisione del controller — I2),
    // con la nota di richiamo fasulla del bot.
    const guardiaE: SQL[] = [
        eq(leads.companyId, COMPANY),
        sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${leads.assignedToId} AND u."isBot" = false)`,
        sql`${leads.status} IN ('NEW', 'IN_PROGRESS')`,
        isNull(leads.presentedAt),
        sql`${leads.recallNote} ILIKE '%Sequenza WhatsApp estesa%'`,
        isNotNull(leads.recallDate),
    ];

    const gruppi: Gruppo[] = [
        {
            id: 'A',
            label: 'flood lista 133',
            discardReason: "lista 133: infornata a senso unico, mai lavorata",
            condizioni: [
                ...guardiaComune,
                eq(leads.intakeBatch, 'DB_LISTA133_20260915'),
            ],
        },
        {
            id: 'B',
            label: 'richiami morti',
            discardReason: "voleva essere risentito piu' avanti: il bot non telefona, richiamo mai fatto",
            condizioni: [
                ...guardiaComune,
                isNull(leads.intakeBatch),
                lt(leads.assignedAt, SEVEN_DAYS_AGO),
                isNotNull(leads.recallDate),
            ],
        },
        {
            id: 'C',
            label: 'gemelli',
            discardReason: 'duplicato per telefono: lavorato sotto un altro lead',
            condizioni: [
                ...guardiaComune,
                isNull(leads.intakeBatch),
                lt(leads.assignedAt, SEVEN_DAYS_AGO),
                // M3: telefono del candidato non banale (>= 9 cifre), altrimenti
                // due numeri spazzatura si "gemellano" a vicenda — devono cadere in D.
                sql`length(regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g')) >= 9`,
                // Decisione PO/controller: il gemello NON conta se è lui stesso un
                // lead lista133 (mai lavorato, solo rumore della flood) né se è lui
                // stesso un altro lead fermo sul bot con gli stessi criteri B/D.
                //
                // Fix round 2 (review): il check "e' fermo sul bot" è avvolto in
                // COALESCE(..., false) — se o."assignedToId" è NULL (lead di un
                // pool, non assegnato a nessuno) `NULL IN (...)` darebbe NULL, non
                // false, e propagherebbe NULL su tutto l'AND: quel gemello
                // sparirebbe in silenzio dall'EXISTS invece di contare come valido
                // (un lead di pool non assegnato NON è "fermo sul bot": verrà
                // lavorato dal pool, quindi il gemello resta reale). Il COALESCE
                // sull'INTERA congiunzione blinda anche il caso limite in cui
                // assignedAt fosse NULL pur con assignedToId=bot.
                //
                // In più: `AND NOT EXISTS (... leadEvents eventType =
                // 'BONIFICA_LEAD_FERMO' ...)` esclude un gemello che QUESTA
                // bonifica ha già rigettato. Senza questo, in --esegui (mai
                // gruppo B ha già committato prima che C parta) un lead X
                // rigettato da B ha assignedToId=NULL e status='REJECTED': il
                // check "e' fermo sul bot" sopra diventa falso (non è più NEW/
                // IN_PROGRESS sul bot), quindi NOT(falso)=vero e X tornerebbe a
                // contare come gemello valido — esattamente il caso di gemelli
                // reciproci che questa regola vuole escludere, e diverso dal
                // dry-run (dove X non è mai stato toccato e resta "fermo sul
                // bot", quindi già escluso dal check sopra). In dry-run questa
                // riga non trova mai righe (non si scrive mai in leadEvents),
                // quindi non altera i conteggi del dry-run: serve solo a rendere
                // --esegui coerente col dry-run, e a rendere coerenti anche i
                // ri-lanci dello script su un DB già parzialmente bonificato.
                sql`EXISTS (
                    SELECT 1 FROM leads o
                    WHERE o.phone = ${leads.phone}
                      AND o.id <> ${leads.id}
                      AND o."companyId" = ${COMPANY}
                      AND o."intakeBatch" IS DISTINCT FROM 'DB_LISTA133_20260915'
                      AND NOT COALESCE(
                        o."assignedToId" IN (${botIdList})
                        AND o.status IN ('NEW', 'IN_PROGRESS')
                        AND o."assignedAt" < now() - interval '7 days',
                        false
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM "leadEvents" e
                        WHERE e."leadId" = o.id AND e."eventType" = 'BONIFICA_LEAD_FERMO'
                      )
                )`,
            ],
        },
        {
            id: 'D',
            label: 'telefoni non chiamabili',
            discardReason: 'telefono non valido',
            condizioni: [
                ...guardiaComune,
                isNull(leads.intakeBatch),
                lt(leads.assignedAt, SEVEN_DAYS_AGO),
                // Decisione controller: fino a due zeri di composizione prima del 39
                // sono validi (es. "+0393209530413"), non un telefono rotto.
                sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g') !~ '^0{0,2}(39)?3[0-9]{9}$'`,
            ],
        },
        {
            id: 'E',
            label: 'richiami ereditati dai vivi',
            discardReason: null,
            condizioni: guardiaE,
        },
    ];

    const esclusi = new Set<string>();
    const totaliCandidati: Record<GruppoId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    const totaliScritti: Record<GruppoId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    const totaliSaltati: Record<GruppoId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };

    for (const gruppo of gruppi) {
        const candidati = await db.select(selectCols).from(leads).where(and(
            ...gruppo.condizioni,
            esclusioneCond(esclusi),
        ));
        totaliCandidati[gruppo.id] = candidati.length;

        console.log(`--- Gruppo ${gruppo.id} (${gruppo.label}): ${candidati.length} candidati ---`);
        for (const row of candidati.slice(0, 5)) {
            console.log(`  ${row.id}  ${row.name}  tel=${row.phone}  status=${row.status}  recallDate=${row.recallDate?.toISOString() ?? '-'}`);
        }
        if (candidati.length > 5) console.log(`  ... e altri ${candidati.length - 5}`);

        if (esegui) {
            const { scritti, saltati } = await eseguiGruppo(esegui, gruppo, candidati.map(r => r.id));
            totaliScritti[gruppo.id] = scritti;
            totaliSaltati[gruppo.id] = saltati;
            console.log(`  Gruppo ${gruppo.id}: scritti ${scritti}, saltati ${saltati} (candidati erano ${candidati.length}).`);
        }
        console.log('');

        // I gruppi successivi non devono riprendere i lead già presi da questo:
        // in `--esegui` sono già REJECTED, in dry-run simuliamo l'esclusione sugli
        // stessi candidati (non sui soli "scritti") per restare coerenti col dry-run.
        for (const row of candidati) esclusi.add(row.id);
    }

    const totaleCandidatiGenerale = Object.values(totaliCandidati).reduce((s, n) => s + n, 0);
    console.log('=== Totali candidati (selezione) ===');
    for (const g of gruppi) console.log(`  ${g.id} (${g.label}): ${totaliCandidati[g.id]}`);
    console.log(`  TOTALE candidati: ${totaleCandidatiGenerale}`);

    if (esegui) {
        const totaleScrittiGenerale = Object.values(totaliScritti).reduce((s, n) => s + n, 0);
        const totaleSaltatiGenerale = Object.values(totaliSaltati).reduce((s, n) => s + n, 0);
        console.log('\n=== Totali scritti (righe REALMENTE aggiornate, RETURNING) ===');
        for (const g of gruppi) console.log(`  ${g.id} (${g.label}): scritti ${totaliScritti[g.id]}, saltati ${totaliSaltati[g.id]}`);
        console.log(`  TOTALE scritti: ${totaleScrittiGenerale}  (saltati: ${totaleSaltatiGenerale})`);
    } else {
        console.log('\nDry-run soltanto: nessuna scrittura. Rilancia con --esegui per applicare.');
    }

    process.exit(0);
}

/**
 * Unico punto di scrittura del file. Chiamato SOLO da main() quando
 * `--esegui` è presente: `esegui` è ripetuto qui come guardia difensiva, così
 * anche un futuro richiamo scorretto di questa funzione non scrive senza flag.
 *
 * Per ogni id: dentro la transazione del gruppo, ri-legge la riga con
 * `SELECT ... FOR UPDATE` filtrando di nuovo per l'INTERO predicato del
 * gruppo (`gruppo.condizioni`, le stesse della SELECT dei candidati). Se la
 * riga non matcha più (cambiata tra la selezione e qui — es. un umano l'ha
 * ripresa dal timer 96h) viene saltata, non forzata. Il `precedente` loggato
 * viene da questa riga bloccata, non dalla selezione iniziale.
 */
async function eseguiGruppo(esegui: boolean, gruppo: Gruppo, ids: string[]): Promise<{ scritti: number; saltati: number }> {
    if (!esegui) throw new Error('eseguiGruppo chiamato senza --esegui: rifiuto di scrivere.');
    if (ids.length === 0) return { scritti: 0, saltati: 0 };

    let scritti = 0;
    let saltati = 0;

    await db.transaction(async (tx) => {
        for (const id of ids) {
            const predicatoRiga = and(eq(leads.id, id), ...gruppo.condizioni);

            const [row] = await tx.select(selectCols).from(leads)
                .where(predicatoRiga)
                .for('update');

            if (!row) {
                saltati++; // non matcha più il predicato del gruppo: qualcosa e' cambiato dopo la selezione
                continue;
            }

            const precedente = {
                status: row.status,
                assignedToId: row.assignedToId,
                recallDate: row.recallDate,
                recallNote: row.recallNote,
                recallMissedAt: row.recallMissedAt,
                discardReason: row.discardReason,
            };

            let updated: { id: string }[];
            if (gruppo.id === 'E') {
                updated = await tx.update(leads).set({
                    recallDate: null,
                    recallNote: null,
                    recallMissedAt: null,
                    updatedAt: new Date(),
                    version: sql`${leads.version} + 1`,
                }).where(predicatoRiga).returning({ id: leads.id });
            } else {
                updated = await tx.update(leads).set({
                    status: 'REJECTED',
                    assignedToId: null,
                    discardReason: gruppo.discardReason!,
                    recallDate: null,
                    recallNote: null,
                    recallMissedAt: null,
                    updatedAt: new Date(),
                    version: sql`${leads.version} + 1`,
                }).where(predicatoRiga).returning({ id: leads.id });
            }

            if (updated.length === 0) {
                saltati++; // cambiato tra il lock e la update (non dovrebbe succedere, ma niente forzature)
                continue;
            }

            await tx.insert(leadEvents).values({
                id: crypto.randomUUID(),
                leadId: id,
                eventType: 'BONIFICA_LEAD_FERMO',
                userId: null,
                timestamp: new Date(),
                metadata: { gruppo: gruppo.id, discardReason: gruppo.discardReason, precedente },
                companyId: COMPANY,
            });
            scritti++;
        }
    });

    return { scritti, saltati };
}

main().catch(e => { console.error('ERRORE:', e?.stack ?? e); process.exit(1); });
