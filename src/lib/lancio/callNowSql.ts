/**
 * Gemello SQL di `isInCallNowCycle` (callNow.ts). Vive in un file a parte
 * perché tocca lo schema Drizzle, e `callNow.ts` lo importano anche i
 * componenti client: la regola è una sola, i due modi di scriverla vanno
 * cambiati insieme.
 */
import { and, eq, gte, isNotNull, isNull, lt, ne, or } from 'drizzle-orm'
import { leads } from '@/db/schema'
import { CALL_NOW_MAX_ATTEMPTS } from './config'

/** Lead ancora dentro il ciclo delle chiamate subito. */
export const IN_CALL_NOW_CYCLE = and(
    eq(leads.lancioScelta, 'chiamata_subito'),
    lt(leads.lancioCallNowAttempts, CALL_NOW_MAX_ATTEMPTS),
    isNull(leads.salespersonOutcome),
)

/**
 * La negazione, scritta a mano come OR e NON come `not(IN_CALL_NOW_CYCLE)`.
 *
 * Su un lead normale `lancioScelta` è NULL: `lancioScelta = 'chiamata_subito'`
 * vale NULL, l'AND vale NULL e `NOT NULL` è ancora NULL — cioè falso in un
 * WHERE. Con la negazione ingenua sparivano dalle multe tutti i lead del CRM,
 * non i tre della serata di lancio. `IS NULL` invece un valore di verità ce
 * l'ha sempre.
 */
export const NOT_IN_CALL_NOW_CYCLE = or(
    isNull(leads.lancioScelta),
    ne(leads.lancioScelta, 'chiamata_subito'),
    gte(leads.lancioCallNowAttempts, CALL_NOW_MAX_ATTEMPTS),
    isNotNull(leads.salespersonOutcome),
)
