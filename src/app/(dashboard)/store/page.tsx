import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ShoppingBag } from "lucide-react"
import dynamic from "next/dynamic"

const ShopClient = dynamic(() => import("@/components/ShopClient").then(m => ({ default: m.ShopClient })), { loading: () => <div className="animate-pulse space-y-4"><div className="h-12 bg-ash-200 rounded-lg w-1/4" /><div className="grid grid-cols-3 gap-4"><div className="h-48 bg-ash-100 rounded-xl" /><div className="h-48 bg-ash-100 rounded-xl" /><div className="h-48 bg-ash-100 rounded-xl" /></div></div> })

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
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-gold-100 to-brand-orange-100 border border-gold-200 shadow-soft">
                        <ShoppingBag className="h-5 w-5 text-gold-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-ash-800">
                            Fenice Store & Inventario
                        </h1>
                        <div className="text-sm text-ash-500 mt-0.5">
                            Sblocca personalizzazioni per il tuo profilo usando i Fenice Coin guadagnati.
                        </div>
                    </div>
                </div>
            </div>

            <ShopClient userId={session.user.id} />
        </div>
    )
}
