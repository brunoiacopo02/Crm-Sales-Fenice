import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { marketingTargets } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

export const maxDuration = 30

interface TargetsPayload {
  aov: number
  cac: number
  cost_app: number
  cost_conf: number
  lead_target_total?: number
  lead_target_telegram?: number
  lead_target_corso10ore?: number
  lead_target_jobsimulator?: number
  roas_target?: number
}

function serialize(row: typeof marketingTargets.$inferSelect) {
  return {
    aov: Number(row.aov),
    cac: Number(row.cac),
    cost_app: Number(row.costApp),
    cost_conf: Number(row.costConf),
    lead_target_total: Number(row.leadTargetTotal ?? 0),
    lead_target_telegram: Number(row.leadTargetTelegram ?? 0),
    lead_target_corso10ore: Number(row.leadTargetCorso10ore ?? 0),
    lead_target_jobsimulator: Number(row.leadTargetJobsimulator ?? 0),
    roas_target: Number(row.roasTarget ?? 0),
    updated_at: row.updatedAt.toISOString(),
  }
}

export async function GET() {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const [row] = await db
      .select()
      .from(marketingTargets)
      .where(and(eq(marketingTargets.companyId, ctx.companyId), eq(marketingTargets.id, 1)))
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Targets non trovati' }, { status: 500 })
    }

    return NextResponse.json(serialize(row))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    let body: Partial<TargetsPayload>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
    }

    const requiredPositive: (keyof TargetsPayload)[] = ['aov', 'cac', 'cost_app', 'cost_conf']
    for (const f of requiredPositive) {
      const v = body[f]
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        return NextResponse.json(
          { error: `Campo ${f} mancante o non valido (deve essere numero > 0)` },
          { status: 400 },
        )
      }
    }

    const optionalNonNegative: (keyof TargetsPayload)[] = [
      'lead_target_total',
      'lead_target_telegram',
      'lead_target_corso10ore',
      'lead_target_jobsimulator',
      'roas_target',
    ]
    for (const f of optionalNonNegative) {
      if (body[f] === undefined) continue
      const v = body[f]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return NextResponse.json(
          { error: `Campo ${f} non valido (deve essere numero >= 0)` },
          { status: 400 },
        )
      }
    }

    const now = new Date()
    const insertValues = {
      companyId: ctx.companyId,
      id: 1,
      aov: String(body.aov!),
      cac: String(body.cac!),
      costApp: String(body.cost_app!),
      costConf: String(body.cost_conf!),
      leadTargetTotal: body.lead_target_total ?? null,
      leadTargetTelegram: body.lead_target_telegram ?? null,
      leadTargetCorso10ore: body.lead_target_corso10ore ?? null,
      leadTargetJobsimulator: body.lead_target_jobsimulator ?? null,
      roasTarget: body.roas_target !== undefined ? String(body.roas_target) : null,
      updatedAt: now,
    }
    const updateSet: Record<string, unknown> = {
      aov: insertValues.aov,
      cac: insertValues.cac,
      costApp: insertValues.costApp,
      costConf: insertValues.costConf,
      updatedAt: now,
    }
    for (const f of optionalNonNegative) {
      if (body[f] === undefined) continue
      if (f === 'lead_target_total') updateSet.leadTargetTotal = body[f]
      else if (f === 'lead_target_telegram') updateSet.leadTargetTelegram = body[f]
      else if (f === 'lead_target_corso10ore') updateSet.leadTargetCorso10ore = body[f]
      else if (f === 'lead_target_jobsimulator') updateSet.leadTargetJobsimulator = body[f]
      else if (f === 'roas_target') updateSet.roasTarget = String(body[f])
    }

    await db
      .insert(marketingTargets)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [marketingTargets.companyId, marketingTargets.id],
        set: updateSet,
      })

    const [row] = await db
      .select()
      .from(marketingTargets)
      .where(and(eq(marketingTargets.companyId, ctx.companyId), eq(marketingTargets.id, 1)))
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Salvataggio fallito' }, { status: 500 })
    }

    return NextResponse.json(serialize(row))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
