import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ShopClient } from "@/components/ShopClient"

export default async function StorePage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    if (!session) {
        redirect("/")
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-7xl mx-auto">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-brand-charcoal">
                        Fenice Store & Inventario
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Sblocca personalizzazioni per il tuo profilo usando i Fenice Coin guadagnati.
                    </p>
                </div>
            </div>

            <ShopClient userId={session.user.id} />
        </div>
    )
}
