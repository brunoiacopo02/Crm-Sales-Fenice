import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import GdoPauseHistory from "@/components/GdoPauseHistory"
import { isDirettaOn } from "@/lib/diretta/settings"
import { PaginaDiretta } from "@/components/diretta/negozio/ui"
import { VesteAllineata } from "@/components/diretta/VesteAllineata"

export default async function StoricoPausePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role } } : null;

    if (!session || session.user.role !== 'GDO') {
        redirect("/")
    }

    // Lo storico è disegnato per un fondo scuro (titolo e numeri bianchi): su
    // quello chiaro del <main> il titolo non si vedeva, con la Diretta accesa o
    // spenta (collaudo del 25/10/2026). Ora sta sempre su una superficie scura.
    if (await isDirettaOn('GDO')) {
        return (
            <PaginaDiretta>
                <VesteAllineata diretta />
                <div className="mx-auto max-w-5xl">
                    <GdoPauseHistory />
                </div>
            </PaginaDiretta>
        )
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <VesteAllineata diretta={false} />
            <div className="rounded-2xl bg-gray-900 p-4 sm:p-6">
                <GdoPauseHistory />
            </div>
        </div>
    )
}
