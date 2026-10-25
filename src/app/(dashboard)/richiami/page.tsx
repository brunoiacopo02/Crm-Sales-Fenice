import { createClient } from "@/utils/supabase/server"
import { requireRole } from "@/lib/authz"
import { getRecallLeads } from "@/app/actions/recallActions"
import { RecallBoard } from "@/components/RecallBoard"
import { isDirettaOn } from "@/lib/diretta/settings"
import { PaginaDiretta, TitoloDiretta } from "@/components/diretta/negozio/ui"
import { VesteAllineata } from "@/components/diretta/VesteAllineata"

export default async function RecallPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    await requireRole(session, ['GDO', 'ADMIN', 'MANAGER', 'TL'])

    // Fetch recall leads
    const { expired, upcoming } = await getRecallLeads()

    // Diretta accesa per il GDO (collaudo del 25/10/2026): stesse card della
    // home, scure, con gli esiti sempre visibili. Admin, manager e TL restano
    // sulla pagina di sempre.
    if (session?.user.role === 'GDO' && await isDirettaOn('GDO')) {
        return (
            <PaginaDiretta>
                <VesteAllineata diretta />
                <div className="mx-auto mb-6 flex max-w-5xl flex-wrap items-end justify-between gap-3">
                    <TitoloDiretta prima="I tuoi" accento="richiami" />
                    <div className="text-[14px] text-[#BFBFBF]">
                        <span className="font-semibold tabular-nums text-[#F2F2F2]">{expired.length}</span> da richiamare adesso
                    </div>
                </div>
                <RecallBoard expired={expired} upcoming={upcoming} variant="diretta" />
            </PaginaDiretta>
        )
    }

    return (
        <div className="space-y-6">
            {session?.user.role === 'GDO' && <VesteAllineata diretta={false} />}
            <div className="flex items-center justify-between max-w-5xl mx-auto">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                    Agenda Richiami
                </h1>
                <div className="text-sm text-gray-500">
                    <span className="font-semibold text-brand-orange">{expired.length}</span> urgenze in rosso
                </div>
            </div>

            <RecallBoard
                expired={expired}
                upcoming={upcoming}
            />
        </div>
    )
}
