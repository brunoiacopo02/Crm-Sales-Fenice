import { randomUUID } from 'node:crypto'
import { db } from '@/db'
import { users, gestionaleContratti, gestionaleRate, gestionaleIncassi, gestionaleCommissioni, gestionaleSyncRuns } from '@/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { fetchSnapshot, gestionaleConfigured } from './client'
import { parseSnapshot } from './parse'
import { diffIds, assertSafeToApply, resolveSeller, type ExistingId, type SellerMap } from './plan'

export type SyncTrigger = 'cron' | 'manuale'
export type SyncResult = { runId: string | null; status: 'ok' | 'error' | 'skipped'; reason?: string; inserted: number; updated: number; deleted: number; restored: number; warnings: string[]; error?: string }

const CHUNK = 500
const LOCK_KEY = 'gestionale-sync'

function chunks<T>(xs: T[]): T[][] {
    const out: T[][] = []
    for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
    return out
}

/** Colonne da riscrivere in ON CONFLICT: tutte tranne la PK (include deletedAt=null e syncedAt: ripristino). */
function excludedSet(cols: string[]) {
    return Object.fromEntries(cols.map(c => [c, sql.raw(`excluded."${c}"`)]))
}

export async function runGestionaleSync(trigger: SyncTrigger): Promise<SyncResult> {
    const empty = { inserted: 0, updated: 0, deleted: 0, restored: 0, warnings: [] as string[] }
    if (process.env.GESTIONALE_SYNC === 'off') return { runId: null, status: 'skipped', reason: 'kill_switch_off', ...empty }
    if (!gestionaleConfigured()) return { runId: null, status: 'skipped', reason: 'not_configured', ...empty }

    const runId = randomUUID()
    await db.insert(gestionaleSyncRuns).values({ id: runId, trigger, status: 'running' })

    const finish = async (r: Omit<SyncResult, 'runId'>, generatoIl: string | null = null): Promise<SyncResult> => {
        await db.update(gestionaleSyncRuns).set({
            status: r.status, finishedAt: new Date(), generatoIl,
            inserted: r.inserted, updated: r.updated, deleted: r.deleted, restored: r.restored,
            warnings: r.warnings, error: r.error ?? r.reason ?? null,
        }).where(eq(gestionaleSyncRuns.id, runId))
        return { runId, ...r }
    }

    let snapshot
    try {
        snapshot = parseSnapshot(await fetchSnapshot())
    } catch (e) {
        return finish({ status: 'error', ...empty, error: e instanceof Error ? e.message : String(e) })
    }

    const warnings = new Set<string>()
    try {
    const sellerRows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, 'VENDITORE'))
    const sellers: SellerMap = new Map(sellerRows.filter(u => u.name).map(u => [u.name!.trim(), u.id]))
    const now = new Date()

    const contratti = snapshot.contratti.map(c => ({ ...c, salesUserId: resolveSeller(c.venditoreCode, sellers, warnings), deletedAt: null, syncedAt: now }))
    const rate = snapshot.rate.map(r => ({ ...r, deletedAt: null, syncedAt: now }))
    const incassi = snapshot.incassi.map(i => ({ ...i, salesUserId: resolveSeller(i.venditoreCode, sellers, warnings), deletedAt: null, syncedAt: now }))
    const commissioni = snapshot.commissioni.map(c => ({ ...c, salesUserId: resolveSeller(c.venditoreCode, sellers, warnings), syncedAt: now }))

        const counts = await db.transaction(async (tx) => {
            // Cron e pulsante insieme: il secondo esce senza toccare nulla.
            const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) as ok`)
            const ok = (lock as unknown as { rows: { ok: boolean }[] }).rows[0]?.ok
            if (!ok) return null

            const tables = [
                { name: 'contratti', table: gestionaleContratti, rows: contratti },
                { name: 'rate', table: gestionaleRate, rows: rate },
                { name: 'incassi', table: gestionaleIncassi, rows: incassi },
            ] as const
            const total = { inserted: 0, updated: 0, deleted: 0, restored: 0 }

            for (const t of tables) {
                const existing: ExistingId[] = (await tx.select({ id: t.table.id, deletedAt: t.table.deletedAt }).from(t.table))
                    .map(e => ({ id: e.id, deleted: e.deletedAt !== null }))
                const diff = diffIds(existing, t.rows.map(r => r.id))
                const live = existing.filter(e => !e.deleted).length
                assertSafeToApply(t.name, live, t.rows.length, diff.deleteIds.length)

                const cols = Object.keys(t.rows[0] ?? {}).filter(c => c !== 'id')
                for (const part of chunks(t.rows as Record<string, unknown>[])) {
                    await tx.insert(t.table).values(part as never)
                        .onConflictDoUpdate({ target: t.table.id, set: excludedSet(cols) as never })
                }
                for (const part of chunks(diff.deleteIds)) {
                    await tx.update(t.table).set({ deletedAt: now } as never)
                        .where(and(inArray(t.table.id, part), isNull(t.table.deletedAt)))
                }
                total.inserted += diff.insertIds.length
                total.updated += diff.updateIds.length
                total.restored += diff.restoreIds.length
                total.deleted += diff.deleteIds.length
            }

            // Commissioni: blocco sostituito per intero (una riga per codice e mese, anche a zero).
            await tx.delete(gestionaleCommissioni)
            for (const part of chunks(commissioni)) await tx.insert(gestionaleCommissioni).values(part)
            return total
        })
        if (counts === null) return finish({ status: 'skipped', reason: 'sync gia in corso', ...empty })
        return finish({ status: 'ok', ...counts, warnings: [...warnings] }, snapshot.generatoIl)
    } catch (e) {
        return finish({ status: 'error', ...empty, warnings: [...warnings], error: e instanceof Error ? e.message : String(e) })
    }
}
