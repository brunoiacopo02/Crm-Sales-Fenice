// Diagnostic endpoint: ritorna in JSON quello che getPipelineLeads produce
// per l'utente loggato. Da rimuovere dopo aver risolto il bug "lead spariti".
import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { getPipelineLeads } from "@/app/actions/pipelineActions"

export const dynamic = 'force-dynamic'

export async function GET() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    try {
        const data = await getPipelineLeads()
        // Compatto solo i campi rilevanti per il debug
        const slim = (arr: any[]) => arr.map(l => ({
            id: l.id, name: l.name, callCount: l.callCount, status: l.status,
            recallDate: l.recallDate, launchBucket: l.launchBucket, funnel: l.funnel,
            isSelfBooked: l.isSelfBooked, assignedToId: l.assignedToId,
            createdAt: l.createdAt,
        }))
        return NextResponse.json({
            currentUser: { id: user.id, email: user.email, role: user.user_metadata?.role },
            counts: {
                firstCall: data.firstCall.length,
                secondCall: data.secondCall.length,
                thirdCall: data.thirdCall.length,
                fourthCall: data.fourthCall.length,
                recalls: data.recalls.length,
                appointments: data.appointments?.length || 0,
                firstCallLaunch: data.firstCall.filter((l: any) => l.launchBucket).length,
                secondCallLaunch: data.secondCall.filter((l: any) => l.launchBucket).length,
            },
            firstCall: slim(data.firstCall),
            secondCall: slim(data.secondCall),
            recalls: slim(data.recalls),
        }, { status: 200 })
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
    }
}
