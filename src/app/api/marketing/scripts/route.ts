import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { adScripts } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

export const maxDuration = 30

interface ScriptRow {
  ad_name_normalized: string
  ad_name: string
  script: string
  updated_at: string
}

interface ImportItem {
  ad_name: string
  script: string
}

// Inlined from legacy lib/projections.ts (no equivalent ported yet).
function normalizeAdName(name: string): string {
  return name.trim().replace(/(\s*-\s*Copia(\s+\d+)?\s*)+$/i, '').trim()
}

function serialize(row: typeof adScripts.$inferSelect): ScriptRow {
  return {
    ad_name_normalized: row.adNameNormalized,
    ad_name: row.adName,
    script: row.script,
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function GET() {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const rows = await db
      .select()
      .from(adScripts)
      .where(eq(adScripts.companyId, ctx.companyId))
      .orderBy(desc(adScripts.updatedAt))

    return NextResponse.json({ scripts: rows.map(serialize) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    let body: { items?: ImportItem[] }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
    }

    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) {
      return NextResponse.json({ error: 'Nessun elemento da importare' }, { status: 400 })
    }

    const now = new Date()
    type Row = {
      companyId: string
      adNameNormalized: string
      adName: string
      script: string
      updatedAt: Date
    }
    const dedup = new Map<string, Row>()
    for (const it of items) {
      const adName = typeof it.ad_name === 'string' ? it.ad_name.trim() : ''
      const script = typeof it.script === 'string' ? it.script.trim() : ''
      if (!adName || !script) continue
      const normalized = normalizeAdName(adName)
      if (!normalized) continue
      dedup.set(normalized, {
        companyId: ctx.companyId,
        adNameNormalized: normalized,
        adName,
        script,
        updatedAt: now,
      })
    }

    const rows = Array.from(dedup.values())
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nessuna riga valida nel CSV' }, { status: 400 })
    }

    // Drizzle upsert per-row on (companyId, adNameNormalized). The PK fix in
    // schema (composite key) means we need one statement per row to get the
    // correct excluded values — Drizzle's onConflictDoUpdate uses static SET.
    for (const r of rows) {
      await db
        .insert(adScripts)
        .values(r)
        .onConflictDoUpdate({
          target: [adScripts.companyId, adScripts.adNameNormalized],
          set: { adName: r.adName, script: r.script, updatedAt: r.updatedAt },
        })
    }

    return NextResponse.json({ imported: rows.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const url = new URL(req.url)
    const key = url.searchParams.get('key')
    if (!key) {
      return NextResponse.json({ error: 'Parametro "key" mancante' }, { status: 400 })
    }

    await db
      .delete(adScripts)
      .where(and(eq(adScripts.companyId, ctx.companyId), eq(adScripts.adNameNormalized, key)))

    return NextResponse.json({ deleted: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
