import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { leads, users } from "@/db/schema"
import { eq, gte, lte, and, isNotNull, asc } from "drizzle-orm"
import { CalendarCheck, Phone, Mail, User as UserIcon, Clock } from "lucide-react"
import { AdminCancelApptButton } from "@/components/AdminCancelApptButton"

export const dynamic = 'force-dynamic'

export default async function AppuntamentiOggiPage() {
    const supabase = await createClient()
    const { data: { user: supabaseUser } } = await supabase.auth.getUser()
    const session = supabaseUser
        ? { user: { id: supabaseUser.id, role: supabaseUser.user_metadata?.role, email: supabaseUser.email, name: supabaseUser.user_metadata?.name } }
        : null

    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "MANAGER")) {
        redirect("/")
    }

    // Calcolo inizio/fine giornata oggi in Europe/Rome
    const now = new Date()
    const romeDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
    const [year, month, day] = romeDateStr.split('-').map(Number)
    const todayStart = new Date(year, month - 1, day, 0, 0, 0, 0)
    const todayEnd = new Date(year, month - 1, day, 23, 59, 59, 999)

    // Lead con appuntamento creato oggi
    const todayAppointments = await db
        .select({
            id: leads.id,
            name: leads.name,
            phone: leads.phone,
            email: leads.email,
            funnel: leads.funnel,
            appointmentDate: leads.appointmentDate,
            appointmentNote: leads.appointmentNote,
            appointmentCreatedAt: leads.appointmentCreatedAt,
            assignedToId: leads.assignedToId,
            gdoName: users.displayName,
            gdoCode: users.gdoCode,
        })
        .from(leads)
        .leftJoin(users, eq(leads.assignedToId, users.id))
        .where(
            and(
                isNotNull(leads.appointmentCreatedAt),
                gte(leads.appointmentCreatedAt, todayStart),
                lte(leads.appointmentCreatedAt, todayEnd)
            )
        )
        .orderBy(asc(leads.appointmentDate))

    // Raggruppa per GDO
    const groupedByGdo = todayAppointments.reduce<Record<string, typeof todayAppointments>>((acc, appt) => {
        const key = appt.assignedToId || 'unknown'
        if (!acc[key]) acc[key] = []
        acc[key].push(appt)
        return acc
    }, {})

    const totalCount = todayAppointments.length
    const gdoCount = Object.keys(groupedByGdo).length

    return (
        <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-ash-900 flex items-center gap-2">
                        <CalendarCheck className="h-6 w-6 text-brand-orange" />
                        Appuntamenti Fissati Oggi
                    </h1>
                    <p className="text-sm text-ash-500 mt-1">
                        Tutti gli appuntamenti che il team ha fissato oggi (per qualsiasi data futura).
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-white border border-ash-200 rounded-xl px-4 py-2 text-center shadow-sm">
                        <div className="text-2xl font-black text-brand-orange">{totalCount}</div>
                        <div className="text-[10px] text-ash-500 uppercase tracking-wider font-bold">Totale</div>
                    </div>
                    <div className="bg-white border border-ash-200 rounded-xl px-4 py-2 text-center shadow-sm">
                        <div className="text-2xl font-black text-emerald-600">{gdoCount}</div>
                        <div className="text-[10px] text-ash-500 uppercase tracking-wider font-bold">GDO Attivi</div>
                    </div>
                </div>
            </div>

            {/* Lista appuntamenti */}
            {totalCount === 0 ? (
                <div className="bg-white border border-dashed border-ash-300 rounded-2xl p-12 text-center">
                    <CalendarCheck className="h-12 w-12 text-ash-300 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-ash-700">Nessun appuntamento fissato oggi</h3>
                    <p className="text-sm text-ash-500 mt-1">Quando i GDO fisseranno appuntamenti durante la giornata, appariranno qui.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedByGdo).map(([gdoId, appointments]) => {
                        const first = appointments[0]
                        const gdoName = first.gdoName || `GDO ${first.gdoCode || 'sconosciuto'}`
                        return (
                            <div key={gdoId} className="bg-white rounded-2xl border border-ash-200 shadow-sm overflow-hidden">
                                {/* GDO header */}
                                <div className="bg-gradient-to-r from-brand-orange-50 to-amber-50 border-b border-ash-200 px-5 py-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-lg bg-brand-orange/15 flex items-center justify-center">
                                            <UserIcon className="h-4 w-4 text-brand-orange" />
                                        </div>
                                        <div>
                                            <div className="font-bold text-ash-900">{gdoName}</div>
                                            <div className="text-xs text-ash-500">{appointments.length} appuntamento{appointments.length !== 1 ? 'i' : ''} fissato{appointments.length !== 1 ? 'i' : ''} oggi</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Tabella appuntamenti */}
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-ash-50/50 border-b border-ash-100">
                                            <tr>
                                                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-ash-500 uppercase tracking-wider">Lead</th>
                                                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-ash-500 uppercase tracking-wider">Contatti</th>
                                                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-ash-500 uppercase tracking-wider">Funnel</th>
                                                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-ash-500 uppercase tracking-wider">Appuntamento Per</th>
                                                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-ash-500 uppercase tracking-wider">Fissato Alle</th>
                                                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-ash-500 uppercase tracking-wider">Note</th>
                                                <th className="px-4 py-2.5 text-right text-[10px] font-bold text-ash-500 uppercase tracking-wider">Azioni</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {appointments.map((appt) => (
                                                <tr key={appt.id} className="border-b border-ash-50 last:border-0 hover:bg-ash-50/30 transition-colors">
                                                    <td className="px-4 py-3 font-semibold text-ash-900">{appt.name}</td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-1.5 text-xs text-ash-600 font-mono">
                                                            <Phone className="h-3 w-3 text-ash-400" />
                                                            {appt.phone}
                                                        </div>
                                                        {appt.email && (
                                                            <div className="flex items-center gap-1.5 text-xs text-ash-500 mt-1">
                                                                <Mail className="h-3 w-3 text-ash-400" />
                                                                <span className="truncate max-w-[180px]">{appt.email}</span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {appt.funnel && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border border-amber-300/50 bg-amber-50 text-amber-700">
                                                                {appt.funnel}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {appt.appointmentDate && (
                                                            <div className="flex items-center gap-1.5 font-semibold text-emerald-700">
                                                                <CalendarCheck className="h-3.5 w-3.5 text-emerald-500" />
                                                                {new Date(appt.appointmentDate).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome' })}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-ash-500">
                                                        {appt.appointmentCreatedAt && (
                                                            <div className="flex items-center gap-1.5">
                                                                <Clock className="h-3 w-3 text-ash-400" />
                                                                {new Date(appt.appointmentCreatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-ash-600 max-w-[260px]">
                                                        {appt.appointmentNote ? (
                                                            <div className="line-clamp-2" title={appt.appointmentNote}>{appt.appointmentNote}</div>
                                                        ) : (
                                                            <span className="text-ash-300 italic">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <AdminCancelApptButton leadId={appt.id} leadName={appt.name || 'lead'} />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
