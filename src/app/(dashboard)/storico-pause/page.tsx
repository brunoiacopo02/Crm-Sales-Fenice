import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import GdoPauseHistory from "@/components/GdoPauseHistory"

export default async function StoricoPausePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role } } : null;

    if (!session || session.user.role !== 'GDO') {
        redirect("/")
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <GdoPauseHistory />
        </div>
    )
}
