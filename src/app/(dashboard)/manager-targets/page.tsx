import { redirect } from 'next/navigation';
import { createClient } from "@/utils/supabase/server"
import Link from 'next/link';
import { Target, ArrowRight } from 'lucide-react';

export default async function ManagerTargetsPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();

    const role = supabaseUser?.user_metadata?.role;
    if (!supabaseUser || (role !== 'MANAGER' && role !== 'ADMIN' && role !== 'TL')) {
        redirect('/unauthorized');
    }

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="rounded-2xl border border-ash-200/60 bg-white shadow-soft p-8 text-center">
                <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-brand-orange/10 mb-4">
                    <Target className="h-7 w-7 text-brand-orange" />
                </div>
                <h1 className="text-2xl font-bold text-ash-800 mb-2">Target &amp; Previsioni</h1>
                <p className="text-ash-500 mb-6">
                    Le tabelle dei target sono state spostate nella dashboard Sales Manager.
                    Lì trovi la nuova tabella &quot;Numeri Mensili&quot; con ACT, Target Prev, Target/Day e Today,
                    oltre al pulsante per impostare i target del mese.
                </p>
                <Link
                    href="/panoramica-generale"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-orange text-white text-sm font-semibold hover:brightness-110 transition-all"
                >
                    Apri Sales Manager <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </div>
    );
}
