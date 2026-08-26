import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getContactRequests } from '@/app/actions/contactRequestActions';
import ContactRequestsClient from './ContactRequestsClient';

// Solo ADMIN: è una coda di smistamento, non una vista operativa. Il doppio
// controllo (qui e dentro l'action) è voluto — la pagina protegge la
// navigazione, l'action protegge i dati.
export default async function RichiesteContattoPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.user_metadata?.role !== 'ADMIN') {
        redirect('/unauthorized');
    }

    const view = await getContactRequests();
    if (!view) redirect('/unauthorized');

    return (
        <div className="p-4 sm:p-6">
            <ContactRequestsClient view={view} />
        </div>
    );
}
