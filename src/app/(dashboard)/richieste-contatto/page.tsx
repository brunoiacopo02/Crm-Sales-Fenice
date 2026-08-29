import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getContactRequests } from '@/app/actions/contactRequestActions';
import ContactRequestsClient from './ContactRequestsClient';

// ADMIN e CONFERME. L'admin vede tutta la coda e smista; le Conferme vedono
// solo i lead già appuntati, che da quel momento sono di loro competenza.
// Il doppio controllo (qui e dentro l'action) è voluto: la pagina protegge la
// navigazione, l'action protegge i dati.
export default async function RichiesteContattoPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const role = user?.user_metadata?.role;
    if (!user || (role !== 'ADMIN' && role !== 'CONFERME')) {
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
