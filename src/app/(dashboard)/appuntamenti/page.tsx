import { createClient } from "@/utils/supabase/server"
import { getAppointments } from "@/app/actions/appointmentActions"
import { AppointmentBoard } from "@/components/AppointmentBoard"

export default async function AppointmentsPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    const { upcoming, past } = await getAppointments()

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between max-w-5xl mx-auto">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                    Appuntamenti
                </h1>
                <div className="text-sm text-gray-500">
                    Totale generati: <span className="font-semibold text-green-600">{upcoming.length + past.length}</span>
                </div>
            </div>

            <AppointmentBoard
                upcoming={upcoming}
                past={past}
            />
        </div>
    )
}
