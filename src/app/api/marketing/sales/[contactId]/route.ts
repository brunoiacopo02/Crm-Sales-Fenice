import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { crmDeals } from '@/db/schema'
import { currentTenant, assertMarketingArea } from '@/lib/tenancy'

export const maxDuration = 15

// Soft-delete di una vendita: imposta crm_deals.manually_excluded=true.
// contactId è crm_deals.event_id, opaco lato frontend.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const ctx = await currentTenant()
    assertMarketingArea(ctx)

    const { contactId } = await params
    if (!contactId) {
      return NextResponse.json({ error: 'contactId mancante' }, { status: 400 })
    }

    const [deal] = await db
      .select({ eventId: crmDeals.eventId })
      .from(crmDeals)
      .where(and(eq(crmDeals.eventId, contactId), eq(crmDeals.companyId, ctx.companyId)))
      .limit(1)
    if (!deal) {
      return NextResponse.json({ error: 'Vendita non trovata' }, { status: 404 })
    }

    await db
      .update(crmDeals)
      .set({ manuallyExcluded: true })
      .where(and(eq(crmDeals.companyId, ctx.companyId), eq(crmDeals.eventId, contactId)))

    return NextResponse.json({ ok: true, contactId })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
