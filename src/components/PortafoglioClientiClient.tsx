"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { format } from "date-fns"
import { it } from "date-fns/locale"
import {
    Search, Plus, Users, MessageCircle, CheckCircle2, XCircle,
    Pencil, Trash2, Mail, Phone, Euro, TrendingUp,
    AlertCircle,
} from "lucide-react"
import {
    listCustomerPortfolios,
    listSalespeople,
    createCustomerPortfolio,
    updateCustomerPortfolio,
    deleteCustomerPortfolio,
    toggleFollowUpMessageSent,
    updateFollowUpFlags,
    setCustomerOutcome,
    getCustomerPortfolioCounts,
    type CreateCustomerInput,
    type UpdateCustomerInput,
} from "@/app/actions/customerPortfolioActions"

type Customer = Awaited<ReturnType<typeof listCustomerPortfolios>>[number]
type Salesperson = Awaited<ReturnType<typeof listSalespeople>>[number]
type Counts = Awaited<ReturnType<typeof getCustomerPortfolioCounts>>

type Tab = 'ALL' | 'IN_TRATTATIVA' | 'NON_CHIUSO' | 'CHIUSO'

const PACKAGE_LABELS: Record<string, string> = {
    ADVANCE: 'Advance',
    GOLD: 'Gold',
    EXCLUSIVE: 'Exclusive',
}

const PACKAGE_BADGE: Record<string, string> = {
    ADVANCE: 'bg-blue-100 text-blue-700 border-blue-200',
    GOLD: 'bg-amber-100 text-amber-700 border-amber-200',
    EXCLUSIVE: 'bg-purple-100 text-purple-700 border-purple-200',
}

function formatEur(n: number | null | undefined) {
    if (n === null || n === undefined) return '—'
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)
}

function formatDate(d: Date | string | null | undefined) {
    if (!d) return '—'
    const date = typeof d === 'string' ? new Date(d) : d
    return format(date, 'dd MMM yyyy', { locale: it })
}

export function PortafoglioClientiClient({
    currentUserId,
    isManagerView,
}: {
    currentUserId: string
    isManagerView: boolean
}) {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [counts, setCounts] = useState<Counts>({ all: 0, inTrattativa: 0, nonChiuso: 0, chiuso: 0 })
    const [salespeople, setSalespeople] = useState<Salesperson[]>([])
    const [tab, setTab] = useState<Tab>('ALL')
    const [search, setSearch] = useState('')
    const [salespersonFilter, setSalespersonFilter] = useState<string>('')
    const [isLoading, setIsLoading] = useState(true)
    const [isPending, startTransition] = useTransition()
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [editing, setEditing] = useState<Customer | null>(null)
    const [closing, setClosing] = useState<Customer | null>(null)
    const [error, setError] = useState<string | null>(null)

    const refresh = async () => {
        setIsLoading(true)
        try {
            const [list, c] = await Promise.all([
                listCustomerPortfolios(salespersonFilter || undefined),
                getCustomerPortfolioCounts(salespersonFilter || undefined),
            ])
            setCustomers(list)
            setCounts(c)
        } catch (e: any) {
            setError(e?.message || 'Errore caricamento')
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        refresh()
    }, [salespersonFilter])

    useEffect(() => {
        if (isManagerView) {
            listSalespeople().then(setSalespeople).catch(() => {})
        }
    }, [isManagerView])

    const filtered = useMemo(() => {
        let rows = customers
        if (tab === 'IN_TRATTATIVA') rows = rows.filter(r => r.outcome === 'IN_TRATTATIVA')
        else if (tab === 'NON_CHIUSO') rows = rows.filter(r => r.outcome === 'NON_CHIUSO')
        else if (tab === 'CHIUSO') rows = rows.filter(r => r.outcome === 'CHIUSO')

        if (search.trim()) {
            const s = search.toLowerCase()
            rows = rows.filter(r =>
                `${r.firstName} ${r.lastName}`.toLowerCase().includes(s) ||
                (r.email?.toLowerCase().includes(s) ?? false) ||
                (r.phone?.includes(s) ?? false)
            )
        }
        return rows
    }, [customers, tab, search])

    const handleToggleMessage = (id: string, sent: boolean) => {
        startTransition(async () => {
            await toggleFollowUpMessageSent(id, sent)
            await refresh()
        })
    }

    const handleUpdateFlags = (id: string, flags: { followUpResponded?: boolean | null, appointmentSet?: boolean | null }) => {
        startTransition(async () => {
            await updateFollowUpFlags(id, flags)
            await refresh()
        })
    }

    const handleSetOutcome = (id: string, outcome: 'IN_TRATTATIVA' | 'CHIUSO' | 'NON_CHIUSO' | null, upsellAmountEur?: number) => {
        startTransition(async () => {
            await setCustomerOutcome(id, outcome, upsellAmountEur)
            await refresh()
        })
    }

    const handleDelete = (id: string) => {
        if (!confirm('Eliminare questo cliente dal portafoglio? L\'azione è irreversibile.')) return
        startTransition(async () => {
            await deleteCustomerPortfolio(id)
            await refresh()
        })
    }

    return (
        <div className="space-y-4 max-w-7xl mx-auto">
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">{error}</span>
                </div>
            )}

            {/* Toolbar */}
            <div className="bg-white/90 backdrop-blur-sm p-4 rounded-xl shadow-soft border border-ash-200/60 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                <div className="flex flex-1 items-center gap-3 flex-wrap">
                    <div className="relative flex-1 min-w-[220px] max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ash-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Cerca per nome, email, telefono…"
                            className="w-full pl-9 pr-3 py-2 text-sm border border-ash-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-orange/40 focus:border-brand-orange"
                        />
                    </div>

                    {isManagerView && salespeople.length > 0 && (
                        <select
                            value={salespersonFilter}
                            onChange={e => setSalespersonFilter(e.target.value)}
                            className="px-3 py-2 text-sm border border-ash-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-orange/40"
                        >
                            <option value="">Tutti i venditori</option>
                            {salespeople.map(sp => (
                                <option key={sp.id} value={sp.id}>
                                    {sp.displayName || sp.name || sp.email}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                {isManagerView && (
                    <button
                        onClick={() => setIsAddOpen(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-brand-orange hover:bg-fire-600 text-white text-sm font-medium rounded-lg shadow-soft transition-colors"
                    >
                        <Plus className="h-4 w-4" />
                        Aggiungi cliente
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div className="bg-white/90 backdrop-blur-sm rounded-xl shadow-soft border border-ash-200/60 overflow-hidden">
                <div className="flex border-b border-ash-200 overflow-x-auto">
                    <TabButton active={tab === 'ALL'} onClick={() => setTab('ALL')} icon={Users} label="Pacchetto Clienti" count={counts.all} />
                    <TabButton active={tab === 'IN_TRATTATIVA'} onClick={() => setTab('IN_TRATTATIVA')} icon={MessageCircle} label="In Trattativa" count={counts.inTrattativa} accent="amber" />
                    <TabButton active={tab === 'NON_CHIUSO'} onClick={() => setTab('NON_CHIUSO')} icon={XCircle} label="Non Chiusi" count={counts.nonChiuso} accent="red" />
                    <TabButton active={tab === 'CHIUSO'} onClick={() => setTab('CHIUSO')} icon={CheckCircle2} label="Chiusi (Upsell)" count={counts.chiuso} accent="green" />
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    {isLoading ? (
                        <div className="p-12 text-center text-ash-400 text-sm">Caricamento…</div>
                    ) : filtered.length === 0 ? (
                        <div className="p-12 text-center text-ash-400 text-sm">
                            {tab === 'ALL' && 'Nessun cliente nel portafoglio.'}
                            {tab === 'IN_TRATTATIVA' && 'Nessun cliente in trattativa al momento.'}
                            {tab === 'NON_CHIUSO' && 'Nessun cliente non chiuso.'}
                            {tab === 'CHIUSO' && 'Nessun cliente chiuso con upsell.'}
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-ash-50/80 border-b border-ash-200">
                                <tr className="text-left text-xs uppercase tracking-wider text-ash-500">
                                    <th className="px-4 py-3 font-semibold">Cliente</th>
                                    <th className="px-4 py-3 font-semibold">Contatti</th>
                                    <th className="px-4 py-3 font-semibold">Pacchetto</th>
                                    <th className="px-4 py-3 font-semibold text-right">Importo</th>
                                    <th className="px-4 py-3 font-semibold">Firma</th>
                                    {isManagerView && <th className="px-4 py-3 font-semibold">Venditore</th>}
                                    <th className="px-4 py-3 font-semibold">{tab === 'CHIUSO' ? 'Upsell' : 'Stato / Azioni'}</th>
                                    <th className="px-4 py-3 font-semibold text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ash-100">
                                {filtered.map(c => (
                                    <tr key={c.id} className="hover:bg-ash-50/40 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-ash-800">{c.firstName} {c.lastName}</div>
                                            {c.notes && <div className="text-xs text-ash-400 mt-0.5 line-clamp-1">{c.notes}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-ash-600">
                                            {c.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{c.email}</div>}
                                            {c.phone && <div className="flex items-center gap-1.5 mt-0.5"><Phone className="h-3 w-3" />{c.phone}</div>}
                                            {!c.email && !c.phone && <span className="text-ash-400">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${PACKAGE_BADGE[c.packageType] || 'bg-ash-100 text-ash-700'}`}>
                                                {PACKAGE_LABELS[c.packageType] || c.packageType}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-ash-800">
                                            {formatEur(c.contractAmountEur)}
                                        </td>
                                        <td className="px-4 py-3 text-ash-600">{formatDate(c.contractSignedAt)}</td>
                                        {isManagerView && (
                                            <td className="px-4 py-3 text-ash-600">
                                                {c.salespersonName || c.salespersonRealName || '—'}
                                            </td>
                                        )}
                                        <td className="px-4 py-3">
                                            <RowActions
                                                customer={c}
                                                tab={tab}
                                                disabled={isPending}
                                                onToggleMessage={handleToggleMessage}
                                                onUpdateFlags={handleUpdateFlags}
                                                onSetOutcome={handleSetOutcome}
                                                onOpenClose={(c) => setClosing(c)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {isManagerView && (
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => setEditing(c)}
                                                        className="p-1.5 text-ash-400 hover:text-brand-orange hover:bg-ash-100 rounded transition-colors"
                                                        title="Modifica"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(c.id)}
                                                        className="p-1.5 text-ash-400 hover:text-red-600 hover:bg-ash-100 rounded transition-colors"
                                                        title="Elimina"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Add modal */}
            {isAddOpen && (
                <CustomerFormModal
                    title="Aggiungi cliente"
                    salespeople={salespeople}
                    initial={null}
                    onClose={() => setIsAddOpen(false)}
                    onSave={async (data) => {
                        const res = await createCustomerPortfolio(data as CreateCustomerInput)
                        if (!res.success) return res.error || 'Errore'
                        setIsAddOpen(false)
                        await refresh()
                        return null
                    }}
                />
            )}

            {/* Edit modal */}
            {editing && (
                <CustomerFormModal
                    title="Modifica cliente"
                    salespeople={salespeople}
                    initial={editing}
                    onClose={() => setEditing(null)}
                    onSave={async (data) => {
                        const res = await updateCustomerPortfolio({ id: editing.id, ...data } as UpdateCustomerInput)
                        if (!res.success) return res.error || 'Errore'
                        setEditing(null)
                        await refresh()
                        return null
                    }}
                />
            )}

            {/* Close (upsell) modal */}
            {closing && (
                <UpsellModal
                    customer={closing}
                    onClose={() => setClosing(null)}
                    onConfirm={async (amount) => {
                        await setCustomerOutcome(closing.id, 'CHIUSO', amount)
                        setClosing(null)
                        await refresh()
                    }}
                />
            )}
        </div>
    )
}

// ───────────────────────────────────────────────────────────────────────────
// Tab button
// ───────────────────────────────────────────────────────────────────────────
function TabButton({
    active, onClick, icon: Icon, label, count, accent,
}: {
    active: boolean
    onClick: () => void
    icon: any
    label: string
    count: number
    accent?: 'amber' | 'red' | 'green'
}) {
    const accentBadge = active
        ? accent === 'amber' ? 'bg-amber-100 text-amber-700'
        : accent === 'red' ? 'bg-red-100 text-red-700'
        : accent === 'green' ? 'bg-green-100 text-green-700'
        : 'bg-brand-orange/10 text-brand-orange'
        : 'bg-ash-100 text-ash-500'

    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                active
                    ? 'border-brand-orange text-brand-charcoal'
                    : 'border-transparent text-ash-500 hover:text-ash-700 hover:bg-ash-50/40'
            }`}
        >
            <Icon className="h-4 w-4" />
            {label}
            <span className={`px-1.5 py-0.5 text-xs font-semibold rounded ${accentBadge}`}>
                {count}
            </span>
        </button>
    )
}

// ───────────────────────────────────────────────────────────────────────────
// Row actions (dynamic per tab)
// ───────────────────────────────────────────────────────────────────────────
function RowActions({
    customer: c, tab, disabled,
    onToggleMessage, onUpdateFlags, onSetOutcome, onOpenClose,
}: {
    customer: Customer
    tab: Tab
    disabled: boolean
    onToggleMessage: (id: string, sent: boolean) => void
    onUpdateFlags: (id: string, flags: { followUpResponded?: boolean | null, appointmentSet?: boolean | null }) => void
    onSetOutcome: (id: string, outcome: 'IN_TRATTATIVA' | 'CHIUSO' | 'NON_CHIUSO' | null) => void
    onOpenClose: (c: Customer) => void
}) {
    if (tab === 'CHIUSO') {
        return (
            <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold bg-green-100 text-green-700 rounded">
                    <TrendingUp className="h-3 w-3" />
                    {formatEur(c.upsellAmountEur)}
                </span>
                <button
                    onClick={() => onSetOutcome(c.id, 'IN_TRATTATIVA')}
                    disabled={disabled}
                    className="text-xs px-2 py-1 text-ash-500 hover:text-ash-800 hover:bg-ash-100 rounded transition-colors"
                    title="Riapri trattativa"
                >
                    Riapri
                </button>
            </div>
        )
    }

    if (tab === 'NON_CHIUSO') {
        return (
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onSetOutcome(c.id, 'IN_TRATTATIVA')}
                    disabled={disabled}
                    className="text-xs px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded border border-amber-200 transition-colors"
                >
                    Riapri trattativa
                </button>
                <button
                    onClick={() => onOpenClose(c)}
                    disabled={disabled}
                    className="text-xs px-2 py-1 bg-green-50 text-green-700 hover:bg-green-100 rounded border border-green-200 transition-colors"
                >
                    Chiuso ora
                </button>
            </div>
        )
    }

    if (tab === 'IN_TRATTATIVA') {
        return (
            <div className="flex items-center gap-3 flex-wrap">
                <FlagToggle
                    label="Ha risposto"
                    value={c.followUpResponded}
                    disabled={disabled}
                    onChange={(v) => onUpdateFlags(c.id, { followUpResponded: v })}
                />
                <FlagToggle
                    label="App fissato"
                    value={c.appointmentSet}
                    disabled={disabled}
                    onChange={(v) => onUpdateFlags(c.id, { appointmentSet: v })}
                />
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onOpenClose(c)}
                        disabled={disabled}
                        className="text-xs px-2 py-1 bg-green-50 text-green-700 hover:bg-green-100 rounded border border-green-200 transition-colors font-medium"
                    >
                        Chiuso
                    </button>
                    <button
                        onClick={() => onSetOutcome(c.id, 'NON_CHIUSO')}
                        disabled={disabled}
                        className="text-xs px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded border border-red-200 transition-colors"
                    >
                        Non chiuso
                    </button>
                </div>
            </div>
        )
    }

    // ALL tab — toggle "messaggio inviato"
    return (
        <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={c.followUpMessageSent}
                    disabled={disabled}
                    onChange={(e) => onToggleMessage(c.id, e.target.checked)}
                    className="h-4 w-4 rounded border-ash-300 text-brand-orange focus:ring-brand-orange/40"
                />
                <span className="text-xs text-ash-600">Msg follow-up inviato</span>
            </label>
            {c.outcome && (
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                    c.outcome === 'CHIUSO' ? 'bg-green-100 text-green-700'
                    : c.outcome === 'NON_CHIUSO' ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                    {c.outcome === 'IN_TRATTATIVA' ? 'In trattativa' : c.outcome === 'CHIUSO' ? 'Chiuso' : 'Non chiuso'}
                </span>
            )}
        </div>
    )
}

// Tri-state flag toggle (null / true / false)
function FlagToggle({ label, value, disabled, onChange }: {
    label: string
    value: boolean | null | undefined
    disabled: boolean
    onChange: (v: boolean | null) => void
}) {
    const next = (current: boolean | null | undefined): boolean | null => {
        if (current === null || current === undefined) return true
        if (current === true) return false
        return null
    }
    const display = value === true ? 'Sì' : value === false ? 'No' : '—'
    const colorClass = value === true
        ? 'bg-green-50 text-green-700 border-green-200'
        : value === false
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-ash-50 text-ash-500 border-ash-200'

    return (
        <button
            onClick={() => onChange(next(value))}
            disabled={disabled}
            className={`text-xs px-2 py-1 rounded border ${colorClass} transition-colors hover:opacity-80`}
            title="Click per ciclare: — → Sì → No → —"
        >
            {label}: <strong>{display}</strong>
        </button>
    )
}

// ───────────────────────────────────────────────────────────────────────────
// Customer create/edit modal
// ───────────────────────────────────────────────────────────────────────────
function CustomerFormModal({
    title, initial, salespeople, onClose, onSave,
}: {
    title: string
    initial: Customer | null
    salespeople: Salesperson[]
    onClose: () => void
    onSave: (data: any) => Promise<string | null>
}) {
    const [firstName, setFirstName] = useState(initial?.firstName || '')
    const [lastName, setLastName] = useState(initial?.lastName || '')
    const [email, setEmail] = useState(initial?.email || '')
    const [phone, setPhone] = useState(initial?.phone || '')
    const [packageType, setPackageType] = useState<'ADVANCE' | 'GOLD' | 'EXCLUSIVE'>(
        (initial?.packageType as any) || 'ADVANCE'
    )
    const [contractAmountEur, setContractAmountEur] = useState<string>(
        initial?.contractAmountEur ? String(initial.contractAmountEur) : ''
    )
    const initialDateStr = initial?.contractSignedAt
        ? format(typeof initial.contractSignedAt === 'string' ? new Date(initial.contractSignedAt) : initial.contractSignedAt, 'yyyy-MM-dd')
        : format(new Date(), 'yyyy-MM-dd')
    const [contractSignedAt, setContractSignedAt] = useState<string>(initialDateStr)
    const [salespersonUserId, setSalespersonUserId] = useState<string>(initial?.salespersonUserId || '')
    const [notes, setNotes] = useState(initial?.notes || '')
    const [submitting, setSubmitting] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        setErr(null)
        const amount = parseFloat(contractAmountEur)
        if (isNaN(amount) || amount <= 0) { setErr('Importo non valido'); return }
        if (!salespersonUserId) { setErr('Seleziona un venditore'); return }
        const signedDate = new Date(contractSignedAt + 'T12:00:00')
        if (isNaN(signedDate.getTime())) { setErr('Data non valida'); return }

        setSubmitting(true)
        const error = await onSave({
            salespersonUserId,
            firstName,
            lastName,
            email: email || null,
            phone: phone || null,
            packageType,
            contractAmountEur: amount,
            contractSignedAt: signedDate,
            notes: notes || null,
        })
        setSubmitting(false)
        if (error) setErr(error)
    }

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
                <div className="px-6 py-4 border-b border-ash-200 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-ash-800">{title}</h2>
                    <button onClick={onClose} className="text-ash-400 hover:text-ash-700 p-1 rounded">
                        <XCircle className="h-5 w-5" />
                    </button>
                </div>
                <form onSubmit={submit} className="px-6 py-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Nome">
                            <input required value={firstName} onChange={e => setFirstName(e.target.value)} className={inputCls} />
                        </Field>
                        <Field label="Cognome">
                            <input required value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Email">
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
                        </Field>
                        <Field label="Telefono">
                            <input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} />
                        </Field>
                    </div>
                    <Field label="Venditore">
                        <select required value={salespersonUserId} onChange={e => setSalespersonUserId(e.target.value)} className={inputCls}>
                            <option value="">Seleziona…</option>
                            {salespeople.map(sp => (
                                <option key={sp.id} value={sp.id}>{sp.displayName || sp.name || sp.email}</option>
                            ))}
                        </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Pacchetto">
                            <select value={packageType} onChange={e => setPackageType(e.target.value as any)} className={inputCls}>
                                <option value="ADVANCE">Advance</option>
                                <option value="GOLD">Gold</option>
                                <option value="EXCLUSIVE">Exclusive</option>
                            </select>
                        </Field>
                        <Field label="Importo (€)">
                            <input
                                type="number" step="0.01" min="0" required
                                value={contractAmountEur}
                                onChange={e => setContractAmountEur(e.target.value)}
                                className={inputCls}
                            />
                        </Field>
                    </div>
                    <Field label="Data firma contratto">
                        <input type="date" required value={contractSignedAt} onChange={e => setContractSignedAt(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Note (opzionale)">
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
                    </Field>

                    {err && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">{err}</div>}

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} disabled={submitting}
                            className="px-4 py-2 text-sm text-ash-600 hover:bg-ash-100 rounded-lg transition-colors">
                            Annulla
                        </button>
                        <button type="submit" disabled={submitting}
                            className="px-4 py-2 text-sm bg-brand-orange hover:bg-fire-600 text-white font-medium rounded-lg shadow-soft transition-colors disabled:opacity-50">
                            {submitting ? 'Salvataggio…' : 'Salva'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// ───────────────────────────────────────────────────────────────────────────
// Upsell close modal
// ───────────────────────────────────────────────────────────────────────────
function UpsellModal({
    customer, onClose, onConfirm,
}: {
    customer: Customer
    onClose: () => void
    onConfirm: (amount: number) => Promise<void>
}) {
    const [amount, setAmount] = useState<string>(customer.upsellAmountEur ? String(customer.upsellAmountEur) : '')
    const [submitting, setSubmitting] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        const n = parseFloat(amount)
        if (isNaN(n) || n <= 0) { setErr('Importo non valido'); return }
        setSubmitting(true)
        try {
            await onConfirm(n)
        } catch (e: any) {
            setErr(e?.message || 'Errore')
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
                <div className="px-6 py-4 border-b border-ash-200">
                    <h2 className="text-lg font-semibold text-ash-800">Chiudi upsell</h2>
                    <p className="text-sm text-ash-500 mt-0.5">{customer.firstName} {customer.lastName}</p>
                </div>
                <form onSubmit={submit} className="px-6 py-5 space-y-4">
                    <Field label="Importo upsell (€)">
                        <div className="relative">
                            <Euro className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ash-400" />
                            <input
                                type="number" step="0.01" min="0" required autoFocus
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                className={`${inputCls} pl-9`}
                            />
                        </div>
                    </Field>
                    {err && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">{err}</div>}
                    <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={onClose} disabled={submitting}
                            className="px-4 py-2 text-sm text-ash-600 hover:bg-ash-100 rounded-lg transition-colors">
                            Annulla
                        </button>
                        <button type="submit" disabled={submitting}
                            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow-soft transition-colors disabled:opacity-50">
                            {submitting ? 'Salvataggio…' : 'Conferma chiusura'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

const inputCls = "w-full px-3 py-2 text-sm border border-ash-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-orange/40 focus:border-brand-orange"

function Field({ label, children }: { label: string, children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-medium text-ash-600 mb-1">{label}</span>
            {children}
        </label>
    )
}
