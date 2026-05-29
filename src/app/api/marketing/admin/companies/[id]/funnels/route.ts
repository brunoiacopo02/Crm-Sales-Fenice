import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { companyFunnels } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { invalidateCompanyFunnelsCache } from '@/lib/marketing/company-funnels'

export const maxDuration = 15

function isMarketingAdmin(ctx: { marketingRole: string | null; area: string }): boolean {
  if (ctx.area === 'both') return true
  return ctx.marketingRole === 'manager'
}

function serialize(row: typeof companyFunnels.$inferSelect) {
  return {
    company_id: row.companyId,
    id: row.id,
    name: row.name,
    meta_account: row.metaAccount,
    meta_keyword: row.metaKeyword,
    ac_list: row.acList,
    ac_sales_tag_id: row.acSalesTagId,
    ac_provenienza_patterns: row.acProvenienzaPatterns,
    color: row.color,
    sort_order: row.sortOrder,
    created_at: row.createdAt,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    if (!isMarketingAdmin(ctx)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const { id } = await params
    const rows = await db
      .select()
      .from(companyFunnels)
      .where(eq(companyFunnels.companyId, id))
      .orderBy(asc(companyFunnels.sortOrder))
    return NextResponse.json({ funnels: rows.map(serialize) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    if (!isMarketingAdmin(ctx)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    if (!body.id || !body.name) {
      return NextResponse.json({ error: 'id e name sono obbligatori' }, { status: 400 })
    }
    await db.insert(companyFunnels).values({
      companyId: id,
      id: String(body.id),
      name: String(body.name),
      metaAccount: (body.meta_account as string | null) ?? null,
      metaKeyword: (body.meta_keyword as string | null) ?? null,
      acList: (body.ac_list as string | null) ?? null,
      acSalesTagId: (body.ac_sales_tag_id as string | null) ?? null,
      acProvenienzaPatterns: (body.ac_provenienza_patterns as string[] | undefined) ?? [],
      color: (body.color as string | undefined) ?? 'bg-slate-500',
      sortOrder: (body.sort_order as number | undefined) ?? 0,
    })
    invalidateCompanyFunnelsCache(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
