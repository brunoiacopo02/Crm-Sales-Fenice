"use client";

import { useState, useEffect } from "react";
import { getArchiveLeads, ArchiveFilters } from "@/app/actions/archiveActions";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { Download, Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

export function ArchiveClient({ gdoUsers, salesUsers }: { gdoUsers: any[], salesUsers: any[] }) {
    const [filters, setFilters] = useState<ArchiveFilters>({
        dateFilterType: 'createdAt',
        gdoId: 'all',
        salespersonId: 'all',
        outcome: 'all',
        page: 1,
        limit: 50,
    });

    const [data, setData] = useState<any[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        fetchData();
    }, [filters.page, filters.limit]);

    // Intentionally not auto-fetching on filter change to avoid spam, we use a Search button
    const fetchData = async () => {
        setIsLoading(true);
        try {
            const result = await getArchiveLeads(filters);
            setData(result.data || []);
            setTotalCount(result.totalCount || 0);
            setTotalPages(result.totalPages || 1);
        } catch (error) {
            console.error(error);
            alert("Errore nel caricamento dei dati");
        }
        setIsLoading(false);
    };

    const handleSearch = () => {
        if (filters.page === 1) {
            fetchData();
        } else {
            setFilters((prev: ArchiveFilters) => ({ ...prev, page: 1 }));
        }
    };

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const result = await getArchiveLeads({ ...filters, exportAll: true });
            const exportData = result.data;
            if (!exportData || exportData.length === 0) {
                alert("Nessun dato da esportare con i filtri attuali.");
                setIsExporting(false);
                return;
            }

            // Generate CSV
            const headers = [
                "ID", "Data Inserimento", "Nome Lead", "Telefono", "Email", "Funnel", "Stato DB",
                "Data Appuntamento", "GDO", "Venditore", "Esito Vendita", "Prodotto", "Valore (€)", 
                "Chiamate Effettuate", "Motivo Scarto"
            ];

            const rows = exportData.map((row: any) => [
                row.id,
                row.createdAt ? format(new Date(row.createdAt), "dd/MM/yyyy HH:mm") : "",
                row.name || "",
                row.phone || "",
                row.email || "",
                row.funnel || "",
                row.status || "",
                row.appointmentDate ? format(new Date(row.appointmentDate), "dd/MM/yyyy HH:mm") : "",
                row.gdoName || "",
                row.salespersonName || "",
                row.salespersonOutcome || "",
                row.closeProduct || "",
                row.closeAmountEur?.toString() || "",
                row.callCount?.toString() || "0",
                row.discardReason || row.notClosedReason || ""
            ]);

            const csvContent = [
                headers.join(";"),
                ...rows.map(r => r.map((cell: string) => `"${(cell || '').replace(/"/g, '""')}"`).join(";"))
            ].join("\n");

            // Add BOM for Excel UTF-8
            const bom = "\uFEFF";
            const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", `archivio_crm_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.error(error);
            alert("Errore durante l'esportazione CSV.");
        }
        setIsExporting(false);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        <Search className="w-8 h-8 text-brand-orange" />
                        Archivio Globale
                    </h1>
                    <p className="text-ash-400 mt-2">Consulta e scarica l'anagrafica storica dei lead</p>
                </div>
                <button
                    onClick={handleExport}
                    disabled={isExporting || isLoading}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-semibold transition shadow-lg disabled:opacity-50"
                >
                    {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    Esporta Dati (CSV)
                </button>
            </div>

            {/* Filters */}
            <div className="bg-ash-900 p-6 rounded-xl border border-ash-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4 items-end">
                <div className="col-span-1 lg:col-span-2">
                    <label className="block text-xs text-ash-400 mb-1">Tipo Data</label>
                    <select
                        value={filters.dateFilterType}
                        onChange={e => setFilters({ ...filters, dateFilterType: e.target.value as any })}
                        className="w-full bg-ash-800 border border-ash-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-brand-orange"
                    >
                        <option value="createdAt">Data Inserimento (GDO)</option>
                        <option value="appointmentDate">Data Appuntamento</option>
                    </select>
                </div>

                <div>
                    <label className="block text-xs text-ash-400 mb-1">Da (Opzionale)</label>
                    <input
                        type="date"
                        value={filters.fromDate || ''}
                        onChange={e => setFilters({ ...filters, fromDate: e.target.value })}
                        className="w-full bg-ash-800 border border-ash-700 rounded-lg p-2 text-white focus:outline-none focus:border-brand-orange"
                    />
                </div>

                <div>
                    <label className="block text-xs text-ash-400 mb-1">A (Opzionale)</label>
                    <input
                        type="date"
                        value={filters.toDate || ''}
                        onChange={e => setFilters({ ...filters, toDate: e.target.value })}
                        className="w-full bg-ash-800 border border-ash-700 rounded-lg p-2 text-white focus:outline-none focus:border-brand-orange"
                    />
                </div>

                <div>
                    <label className="block text-xs text-ash-400 mb-1">Filtro GDO</label>
                    <select
                        value={filters.gdoId}
                        onChange={e => setFilters({ ...filters, gdoId: e.target.value })}
                        className="w-full bg-ash-800 border border-ash-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-brand-orange"
                    >
                        <option value="all">Tutti</option>
                        {gdoUsers.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-xs text-ash-400 mb-1">Filtro Venditore</label>
                    <select
                        value={filters.salespersonId}
                        onChange={e => setFilters({ ...filters, salespersonId: e.target.value })}
                        className="w-full bg-ash-800 border border-ash-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-brand-orange"
                    >
                        <option value="all">Tutti</option>
                        {salesUsers.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-xs text-ash-400 mb-1">Esito</label>
                    <select
                        value={filters.outcome || 'all'}
                        onChange={e => setFilters({ ...filters, outcome: e.target.value })}
                        className="w-full bg-ash-800 border border-ash-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-brand-orange"
                    >
                        <option value="all">Qualsiasi</option>
                        <option value="CONFERMATO">Confermato DB</option>
                        <option value="SCARTATO">Scartato DB</option>
                        <option value="Chiuso">Vendita Chiusa</option>
                        <option value="Non chiuso">Vendita Fallita</option>
                    </select>
                </div>

                <div>
                    <button
                        onClick={handleSearch}
                        className="w-full bg-brand-orange hover:bg-brand-orange-hover text-white font-bold py-2.5 rounded-lg transition"
                    >
                        Applica Filtri
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-ash-900 rounded-xl border border-ash-800 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="bg-ash-800 text-ash-400 font-medium uppercase text-xs border-b border-ash-700">
                            <tr>
                                <th className="px-5 py-4">Data Add</th>
                                <th className="px-5 py-4">Nome Lead</th>
                                <th className="px-5 py-4">Telefono</th>
                                <th className="px-5 py-4">GDO</th>
                                <th className="px-5 py-4">Data App.</th>
                                <th className="px-5 py-4">Esito / DB</th>
                                <th className="px-5 py-4">Venditore</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800 text-ash-200">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={7} className="px-5 py-12 text-center text-ash-500">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                                        Caricamento dati in corso...
                                    </td>
                                </tr>
                            ) : data.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-5 py-12 text-center text-ash-500">
                                        Nessun risultato trovato con i filtri attuali.
                                    </td>
                                </tr>
                            ) : (
                                data.map((item, idx) => (
                                    <tr key={item.id} className="hover:bg-ash-800 transition-colors">
                                        <td className="px-5 py-3">
                                            {item.createdAt ? format(new Date(item.createdAt), "dd/MM") : "-"}
                                        </td>
                                        <td className="px-5 py-3 font-medium text-white">{item.name}</td>
                                        <td className="px-5 py-3 text-ash-400">{item.phone}</td>
                                        <td className="px-5 py-3 text-brand-orange/90">{item.gdoName || "-"}</td>
                                        <td className="px-5 py-3">
                                            {item.appointmentDate ? format(new Date(item.appointmentDate), "dd/MM/yyyy") : "-"}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex flex-col">
                                                <span>{item.status}</span>
                                                {item.salespersonOutcome && (
                                                    <span className="text-[10px] text-ash-400">{item.salespersonOutcome}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-5 py-3">{item.salespersonName || "-"}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="bg-ash-800 px-6 py-4 flex items-center justify-between border-t border-ash-800">
                    <div className="text-ash-400 text-sm">
                        Totale righe: <span className="text-white font-medium">{totalCount}</span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <button
                            disabled={filters.page === 1}
                            onClick={() => setFilters({ ...filters, page: filters.page! - 1 })}
                            className="bg-ash-700 hover:bg-ash-600 disabled:opacity-50 text-white p-2 rounded-lg transition"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        
                        <span className="text-sm font-medium text-ash-300">
                            Pagina {filters.page} di {totalPages > 0 ? totalPages : 1}
                        </span>
                        
                        <button
                            disabled={filters.page === totalPages || totalPages === 0}
                            onClick={() => setFilters({ ...filters, page: filters.page! + 1 })}
                            className="bg-ash-700 hover:bg-ash-600 disabled:opacity-50 text-white p-2 rounded-lg transition"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
