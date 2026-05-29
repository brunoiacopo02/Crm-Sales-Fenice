import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { companies } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { invalidateCompaniesCache } from '@/lib/marketing/company'

export const maxDuration = 15

const ALLOWED_FIELDS = [
  'name',
  'displayName',
  'shortCode',
  'currency',
  'isActive',
  'sortOrder',
] as const

// Mappa snake_case (legacy API contract) -> camelCase (Drizzle schema).
const FIELD_MAP: Record<string, typeof ALLOWED_FIELDS[number]> = {
  name: 'name',
  display_name: 'displayName',
  short_code: 'shortCode',
  currency: 'currency',
  is_active: 'isActive',
  sort_order: 'sortOrder',
}

function isMarketingAdmin(ctx: { marketingRole: string | null; area: string }): boolean {
  if (ctx.area === 'both') return true
  return ctx.marketingRole === 'manager'
}

export async function PATCH(
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
    const update: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      const mapped = FIELD_MAP[k]
      if (mapped) update[mapped] = v
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'no_valid_fields' }, { status: 400 })
    }

    await db.update(companies).set(update).where(eq(companies.id, id))
    invalidateCompaniesCache()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
