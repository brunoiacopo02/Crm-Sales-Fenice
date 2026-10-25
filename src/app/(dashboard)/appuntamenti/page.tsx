import { createClient } from "@/utils/supabase/server"
import { getAppointments } from "@/app/actions/appointmentActions"
import { AppointmentBoard } from "@/components/AppointmentBoard"
import { isDirettaOn } from "@/lib/diretta/settings"
import { PaginaDiretta, TitoloDiretta, numero } from "@/components/diretta/negozio/ui"
import { VesteAllineata } from "@/components/diretta/VesteAllineata"

export default async function AppointmentsPage() {
    const supabase = await createClient();
    const { data: { user: supabaseUser } } = await supabase.auth.getUser();
    const session = supabaseUser ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } } : null;

    const { upcoming, past, inRifissaggio } = await getAppointments()
    const totale = upcoming.length + past.length + inRifissaggio.length

    // Diretta accesa per il GDO (collaudo del 25/10/2026): stessa pagina,
    // veste scura come richiami e risultati. Gli altri ruoli restano com'erano.
    if (session?.user.role === 'GDO' && await isDirettaOn('GDO')) {
        return (
            <PaginaDiretta>
                <VesteAllineata diretta />
                <div className="mx-auto mb-6 flex max-w-5xl flex-wrap items-end justify-between gap-3">
                    <TitoloDiretta prima="I tuoi" accento="appuntamenti" />
                    <div className="text-[14px] text-[var(--d-muted)]">
                        Totale fissati <span className="font-semibold tabular-nums text-[var(--d-text)]">{numero(totale)}</span>
                    </div>
                </div>
                <AppointmentBoard
                    upcoming={upcoming}
                    past={past}
                    inRifissaggio={inRifissaggio}
                    variant="diretta"
                />
            </PaginaDiretta>
        )
    }

    return (
        <div className="space-y-6">
            {session?.user.role === 'GDO' && <VesteAllineata diretta={false} />}
            <div className="flex items-center justify-between max-w-5xl mx-auto">
                <h1 className="text-2xl font-bold tracking-tight text-ash-900">
                    Appuntamenti
                </h1>
                <div className="text-sm text-ash-500">
                    Totale generati: <span className="font-semibold text-green-600">{totale}</span>
                </div>
            </div>

            <AppointmentBoard
                upcoming={upcoming}
                past={past}
                inRifissaggio={inRifissaggio}
            />
        </div>
    )
}
