// Frammenti Drizzle per contare le chiusure senza gli upsell (titolare 21/11/2026).
// Regola e funzioni pure in ./chiusure.ts. Sono funzioni (non costanti) così ogni
// query riceve un frammento suo.
//
// Uso tipico:
//   - nel WHERE di una query che CONTA chiusure:   and(..., eq(leads.salespersonOutcome, 'Chiuso'), nonUpsellSql())
//   - in un'aggregazione che dà numero ED euro:    count(*) filter (where ${chiusuraContataSql()})
//                                                  sum(closeAmountEur) filter (where outcome = 'Chiuso')   <- euro con upsell
// Le query che SOMMANO solo euro non vanno toccate.

import { eq, sql, type SQL } from 'drizzle-orm'
import { leads } from '@/db/schema'

/** La scheda NON è un upsell (colonna NOT NULL default false, migr. 0064). */
export function nonUpsellSql(): SQL {
    return eq(leads.closeIsUpsell, false)
}

/** Esito 'Chiuso' che conta come chiusura (upsell esclusi). */
export function chiusuraContataSql(): SQL {
    return sql`(${leads.salespersonOutcome} = 'Chiuso' and ${leads.closeIsUpsell} = false)`
}
