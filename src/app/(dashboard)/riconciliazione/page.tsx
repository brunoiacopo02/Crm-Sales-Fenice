import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { currentYearMonthRome } from '@/lib/workingDaysUtils';
import RiconciliazioneClient from './RiconciliazioneClient';

export const dynamic = 'force-dynamic';

/**
 * Gate di sola navigazione (ruolo ADMIN): a differenza di /previsionale qui
 * NON serve un lucchetto a password separato. Il previsionale nasconde budget
 * e marginalità che nessun altro vede; questa pagina mostra invece contratti
 * che l'admin ha già sott'occhio altrove (Sales Manager, Qualità Lead, ecc.),
 * quindi il solo controllo di ruolo basta.
 */
export default async function RiconciliazionePage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') {
        redirect('/unauthorized');
    }

    return (
        <div className="p-1 sm:p-2">
            <RiconciliazioneClient currentYearMonth={currentYearMonthRome()} />
        </div>
    );
}
