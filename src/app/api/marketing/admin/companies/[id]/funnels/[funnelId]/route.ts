import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { companyFunnels } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { invalidateCompanyFunnelsCache } from '@/lib/marketing/company-funnels'

export const maxDuration = 15

function isMarketingAdmin(ctx: { marketingRole: string | null; area: string }): boolean {
  if (ctx.area === 'both') return true
  return ctx.marketingRole === 'manager'
}

// Mappa snake_case (API contract) → camelCase (Drizzle).
const FIELD_MAP: Record<string, string> = {
  name: 'name',
  meta_account: 'metaAccount',
  meta_keyword: 'metaKeyword',
  ac_list: 'acList',
  ac_sales_tag_id: 'acSalesTagId',
  ac_provenienza_patterns: 'acProvenienzaPatterns',
  color: 'color',
  sort_order: 'sortOrder',
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; funnelId: string }> },
) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    if (!isMarketingAdmin(ctx)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const { id, funnelId } = await params
    const body = (await req.json()) as Record<string, unknown>
    const update: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      const mapped = FIELD_MAP[k]
      if (mapped) update[mapped] = v
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'no_valid_fields' }, { status: 400 })
    }
    await db
      .update(companyFunnels)
      .set(update)
      .where(and(eq(companyFunnels.companyId, id), eq(companyFunnels.id, funnelId)))
    invalidateCompanyFunnelsCache(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; funnelId: string }> },
) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    if (!isMarketingAdmin(ctx)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const { id, funnelId } = await params
    await db
      .delete(companyFunnels)
      .where(and(eq(companyFunnels.companyId, id), eq(companyFunnels.id, funnelId)))
    invalidateCompanyFunnelsCache(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
