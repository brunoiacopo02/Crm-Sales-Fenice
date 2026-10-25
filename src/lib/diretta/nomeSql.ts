// Nome da mostrare in una query (PO 25/10/2026): il nome vero (users.firstName)
// se c'è, altrimenti la colonna mostrata finora. name e displayName restano
// "GDO 1xx" nel database perché li usano bot, cron, webhook e report: qui si
// cambia solo quello che vede chi guarda lo schermo.

import { sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

export function nomeVeroOppure(firstName: AnyPgColumn, finora: AnyPgColumn): SQL<string | null> {
    return sql<string | null>`coalesce(nullif(btrim(${firstName}), ''), ${finora})`
}
