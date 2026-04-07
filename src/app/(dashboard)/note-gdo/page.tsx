import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import NoteGdoClient from "@/components/NoteGdoClient"

export default async function NoteGdoPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER')) {
        redirect("/")
    }

    if (session.user.email === 'marketing@fenice.local' || session.user.name === 'Marketing') {
        redirect("/marketing-analytics");
    }

    return (
        <div className="space-y-6">
            <div className="max-w-7xl mx-auto">
                <h1 className="text-2xl font-bold text-gray-800">Note GDO</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Annotazioni e valutazioni sugli operatori GDO: formazione, feedback positivi, negativi e disciplinari.
                </p>
            </div>

            <NoteGdoClient />
        </div>
    )
}
