import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { isPrevisionaleUnlocked } from '@/app/actions/previsionaleActions';
import PrevisionaleLock from './PrevisionaleLock';
import PrevisionaleClient from './PrevisionaleClient';

export const dynamic = 'force-dynamic';

/**
 * Doppio gate: ruolo ADMIN (protegge la navigazione) + password condivisa
 * (protegge il contenuto anche da chi l'account admin ce l'ha in mano).
 * Il modello viene montato SOLO a lucchetto aperto: finché non lo è, nel DOM
 * non finisce nemmeno un numero.
 */
export default async function PrevisionalePage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') {
        redirect('/unauthorized');
    }

    const unlocked = await isPrevisionaleUnlocked();

    return (
        <div className="p-1 sm:p-2">
            {unlocked ? <PrevisionaleClient /> : <PrevisionaleLock />}
        </div>
    );
}
