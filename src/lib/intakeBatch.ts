/**
 * Le infornate di ingresso "anomale", e come vanno trattate.
 *
 * `leads.intakeBatch` marca un blocco di lead entrati insieme. Nasce il
 * 15/09/2026 con `DB_LISTA133_20260915`: 7.891 lead database riversati nel CRM
 * da un'automazione ActiveCampaign, per errore.
 *
 * Un'infornata del genere sporca tre cose diverse, e ognuna vuole una regola
 * sua. Stanno tutte qui perché tre liste in tre file finiscono per divergere,
 * e il giorno in cui divergono nessuno se ne accorge: i numeri restano
 * plausibili e sbagliati.
 */

/**
 * Infornate che NON contano come lead acquisiti nei KPI.
 *
 * Un lead di queste infornate conta SOLO se è stato davvero lavorato — cioè se
 * porta `funnel = 'Database'`, che è la marcatura che riceve chi il bot ha
 * effettivamente contattato. Tutti gli altri sono scarti mai chiamati: non
 * sono lead che abbiamo acquisito, e contarli gonfia l'acquisizione del mese.
 *
 * Quanto pesava davvero: al 16/09/2026 la dashboard Sales Manager mostrava
 * 10.968 "lead nuovi" di settembre, di cui **6.895 erano scarti del flood**.
 * Il numero vero era 4.073 — un gonfiaggio del 169%.
 */
export const BATCH_ESCLUSI_DAI_KPI: readonly string[] = ['DB_LISTA133_20260915'];

/**
 * Infornate a SENSO UNICO: il bot le lavora, ma i lead che non convertono NON
 * tornano ai GDO umani (decisione del PO, 16/09/2026).
 *
 * Chi non risponde a un messaggio WhatsApp non vale una chiamata a mano, e
 * restituirli riempirebbe la pipeline dei GDO di gente già dimostratasi fredda.
 */
export const BATCH_SENSO_UNICO: readonly string[] = ['DB_LISTA133_20260915'];

/**
 * Infornate che valgono come CODA FREDDA nel ribilanciamento serale dei pool:
 * si comportano come un lead restituito dal bot, non come un lead fresco.
 */
export const BATCH_FREDDI: readonly string[] = ['DB_LISTA133_20260915'];

/**
 * Oggi le tre liste coincidono, ma restano separate di proposito: un domani
 * potrebbe esserci un'infornata legittima (un pool comprato) da escludere dal
 * ribilanciamento senza però toglierla dai KPI, o viceversa. Fonderle adesso
 * vorrebbe dire scoprire troppo tardi che erano due cose diverse.
 */

// ---------------------------------------------------------------------------
// Come si applica la regola, nelle due forme che servono.
// ---------------------------------------------------------------------------

import { sql, inArray, isNull, or, not } from 'drizzle-orm';
import { leads } from '@/db/schema';

/**
 * Predicato SQL: questo lead conta nei KPI di acquisizione?
 *
 * Da usare nel WHERE delle query che CONTANO lead acquisiti. Attenzione: NON va
 * messo nel WHERE delle query che pescano i lead per contarne poi appuntamenti
 * e presenze in memoria — lì taglierebbe via anche le conversioni vere. Per
 * quelle c'è `contaNeiKpi()`, da applicare al solo contatore.
 */
export const contaNeiKpiSql = () => or(
    isNull(leads.intakeBatch),
    // `inArray` e non un `= ANY(...)` scritto a mano: passare un array JS come
    // singolo parametro dentro un template `sql` lo serializza in un modo che
    // Postgres rifiuta, e la query esplode a runtime invece che in compilazione.
    // E' costato la dashboard Sales Manager in produzione il 16/09/2026.
    not(inArray(leads.intakeBatch, [...BATCH_ESCLUSI_DAI_KPI])),
    sql`LOWER(COALESCE(${leads.funnel}, '')) = 'database'`,
)!;

/**
 * Stessa regola, in JavaScript, per le funzioni che pescano i lead con un OR su
 * più date e poi contano in memoria: lì il filtro va sul contatore, non sulla
 * query, altrimenti spariscono anche gli appuntamenti veri nati da
 * quell'infornata.
 */
export const contaNeiKpi = (l: { intakeBatch: string | null; funnel: string | null }): boolean =>
    !l.intakeBatch
    || !BATCH_ESCLUSI_DAI_KPI.includes(l.intakeBatch)
    || (l.funnel ?? '').trim().toLowerCase() === 'database';
