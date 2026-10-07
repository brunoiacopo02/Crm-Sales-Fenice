// PO 07/10/2026: i lead nuovi (non del lancio, mai passati dal bot) rimasti nelle
// prime chiamate dei GDO passano al bot, cosÃ¬ le prime chiamate restano solo del
// lancio. Assegna al bot 201 (evento REASSIGNED_TO_BOT) e spinge l'intake a 30/min.
//
//   node --import tsx --env-file=.env scripts/nuovi-gdo-al-bot.ts          -> prova a vuoto
//   node --import tsx --env-file=.env scripts/nuovi-gdo-al-bot.ts --scrivi -> scrive e spinge
import dotenv from 'dotenv'
import crypto from 'node:crypto'

const SCRIVI = process.argv.includes('--scrivi')
const botEnv = dotenv.config({ path: 'C:/Users/bruno/Desktop/Software Messaggistica/.env.local', processEnv: {} }).parsed ?? {}
process.env.BOT_WEBHOOK_SECRET = botEnv.BOT_WEBHOOK_SECRET
process.env.BOT_INTAKE_URL = 'https://web-app-messaggistica.vercel.app/api/bot/intake'
process.env.BOT_INTAKE_ENABLED = 'true'

const { db } = await import('../src/db/index.ts')
const { leads, leadEvents } = await import('../src/db/schema.ts')
const { sql, inArray } = await import('drizzle-orm')
const { pushLeadsToBotPaced } = await import('../src/lib/bot-fissatore/push.ts')

const rows = (await db.execute(sql`
    select l.id, l.name, l.phone, l.email, l.funnel, l."companyId", l."assignedToId"
    from leads l join users u on u.id = l."assignedToId"
    where u.role = 'GDO' and u."isBot" = false and l."callCount" = 0 and l.status in ('NEW','IN_PROGRESS')
      and l."recallDate" is null and l."companyId" = 'fenice'
      and l."launchBucket" is distinct from 'LANCIO_WEBDEV_2026'
      and not exists (select 1 from "leadEvents" e where e."leadId" = l.id and e."eventType" = 'BOT_PUSHED'
                      and e.metadata->>'result' in ('sent','duplicate','network_error'))
      and not exists (select 1 from "botContactRequests" r where r."leadId" = l.id and r.status <> 'closed')
`)) as unknown as { rows?: any[] } & any[]
const lista: any[] = (rows as any).rows ?? rows
const [bot] = ((await db.execute(sql`select id from users where "gdoCode" = 201`)) as any).rows ?? []
console.log(`lead da passare al bot: ${lista.length}`)
if (!SCRIVI || lista.length === 0) { console.log('prova a vuoto (usa --scrivi)'); process.exit(0) }

const ids = lista.map((r) => r.id)
await db.update(leads).set({ assignedToId: bot.id, status: 'NEW', updatedAt: new Date() }).where(inArray(leads.id, ids))
await db.insert(leadEvents).values(lista.map((r) => ({
    id: crypto.randomUUID(), leadId: r.id, eventType: 'REASSIGNED_TO_BOT', userId: null,
    fromSection: null, toSection: null,
    metadata: { reason: 'priorita_lancio', fromAssigneeId: r.assignedToId, toAssigneeId: bot.id },
    timestamp: new Date(), companyId: r.companyId,
})))
const { results, remaining } = await pushLeadsToBotPaced(lista.map((r) => ({
    leadId: r.id, name: r.name, phone: r.phone, email: r.email, funnel: r.funnel, companyId: r.companyId,
})), { budgetMs: 240_000 })
const conta: Record<string, number> = {}
for (const r of results) conta[r.result] = (conta[r.result] ?? 0) + 1
console.log('push:', conta, 'rimasti:', remaining.length)
process.exit(0)

