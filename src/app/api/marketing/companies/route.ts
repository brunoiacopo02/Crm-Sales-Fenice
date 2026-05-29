import { NextResponse } from 'next/server'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'
import { listActiveCompanies } from '@/lib/marketing/company'

export async function GET() {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)
    const companies = await listActiveCompanies()
    return NextResponse.json({ companies })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 401 })
  }
}
