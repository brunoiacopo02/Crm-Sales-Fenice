// Confronto dei telefoni in SQL sulle ultime 10 cifre (PO 11/11/2026: `+39 333 123-4567`
// e `3331234567` sono la stessa persona).
//
// Trappola (revisione 11/11/2026): dentro un template JS `'\D'` diventa `'D'` (la barra
// sparisce), quindi a Postgres arrivava "togli le D" e un numero con spazi o trattini non
// combaciava mai. Qui la barra e' doppia UNA volta sola, e i test (telefonoSql.test.ts)
// controllano l'SQL che parte davvero.

import { sql, type SQL } from 'drizzle-orm'

/** Solo le cifre dell'espressione: `regexp_replace(x, '\D', '', 'g')` lato Postgres. */
export function soloCifreSql(espressione: SQL): SQL {
    return sql`regexp_replace(${espressione}, '\\D', '', 'g')`
}

/** Le ultime 10 cifre (la chiave persona del CRM). */
export function chiave10Sql(espressione: SQL): SQL {
    return sql`right(${soloCifreSql(espressione)}, 10)`
}

/** Vero se i due telefoni hanno le stesse ultime 10 cifre. */
export function stessoNumeroSql(a: SQL, b: SQL): SQL {
    return sql`${chiave10Sql(a)} = ${chiave10Sql(b)}`
}
