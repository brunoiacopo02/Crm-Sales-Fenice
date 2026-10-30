import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'
import { and, isNull } from 'drizzle-orm'
import { leads } from '@/db/schema'
import { EVENTO_TOLTO_AL_BOT, LANCIO_POOL_ARCHIVIATO, nonToltoAlBotSql } from './toltiAlBot'

const dialect = new PgDialect()

test('nonToltoAlBotSql: esclude evento TOLTO_AL_BOT e lancio ARCHIVIATO', () => {
    const q = dialect.sqlToQuery(nonToltoAlBotSql())
    assert.match(q.sql, /"leads"\."lancioPool" IS DISTINCT FROM \$1/)
    assert.match(q.sql, /NOT EXISTS \(/)
    assert.match(q.sql, /tb\."eventType" = \$2/)
    assert.deepEqual(q.params, [LANCIO_POOL_ARCHIVIATO, EVENTO_TOLTO_AL_BOT])
})

test('nonToltoAlBotSql: la sottoquery punta a "leads"."id" qualificato, non a un "id" ambiguo', () => {
    const q = dialect.sqlToQuery(and(isNull(leads.assignedToId), nonToltoAlBotSql())!)
    assert.match(q.sql, /tb\."leadId" = "leads"\."id"/)
    assert.doesNotMatch(q.sql, /tb\."leadId" = "id"/)
})
