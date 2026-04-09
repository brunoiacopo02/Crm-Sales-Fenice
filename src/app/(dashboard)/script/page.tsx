import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ScriptWidget } from "@/components/ScriptWidget"

export default async function ScriptPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    if (!supabaseUser) redirect("/login");

    const role = supabaseUser.user_metadata?.role;
    if (role !== 'GDO' && role !== 'MANAGER' && role !== 'ADMIN') {
        redirect("/");
    }

    return (
        <div className="py-4">
            <div className="max-w-3xl mx-auto mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-ash-800">Script Chiamata</h1>
                <p className="text-sm text-ash-500 mt-1">Segui lo script passo dopo passo durante la chiamata</p>
            </div>
            <ScriptWidget />
        </div>
    );
}
