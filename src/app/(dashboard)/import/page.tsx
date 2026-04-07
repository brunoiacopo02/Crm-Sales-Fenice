"use client"

import { useState, useRef, useEffect } from "react"
import {
    processCsvImport,
    CsvRowPayload,
    ImportReport,
    getAssignmentSettings,
    getActiveGdosForImport,
    AssignmentMode,
    saveAssignmentSettings
} from "@/app/actions/importLeads"
import { previewLeadDistribution } from "@/lib/distributionUtils"
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, FileUp, XCircle, ChevronRight, Settings, Users, UserPlus } from "lucide-react"
import { useRouter } from "next/navigation"
import Papa from "papaparse"
import { AddLeadModal } from "@/components/AddLeadModal"

export default function ImportPage() {
    const router = useRouter()
    const [file, setFile] = useState<File | null>(null)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const [previewData, setPreviewData] = useState<any[]>([])
    const [csvRawData, setCsvRawData] = useState<any[]>([])
    const [csvFields, setCsvFields] = useState<string[]>([])
    const [payload, setPayload] = useState<CsvRowPayload[] | null>(null)
    const [mapping, setMapping] = useState<{ nome: string, email: string, telefono: string, cognome: string } | null>(null)

    const [loading, setLoading] = useState(false)
    const [report, setReport] = useState<ImportReport | null>(null)

    // Assignment States
    const [activeGdos, setActiveGdos] = useState<any[]>([])
    const [mode, setMode] = useState<AssignmentMode>('equal')
    const [customSettings, setCustomSettings] = useState<Record<string, number>>({})
    const [distributionPreview, setDistributionPreview] = useState<Record<string, { count: number, name: string }>>({})
    const [allowDuplicates, setAllowDuplicates] = useState(false)

    const fileInputRef = useRef<HTMLInputElement>(null)
    const [isAddLeadOpen, setIsAddLeadOpen] = useState(false)

    // Setup initial data
    useEffect(() => {
        Promise.all([
            getAssignmentSettings(),
            getActiveGdosForImport()
        ]).then(([st, gdos]) => {
            setMode(st.mode)
            setCustomSettings(st.settings)
            setActiveGdos(gdos)
        })
    }, [])

    // Calc Preview Live
    useEffect(() => {
        if (!payload || activeGdos.length === 0) return
        const distr = previewLeadDistribution(payload.length, activeGdos, mode, customSettings)
        setDistributionPreview(distr)
    }, [payload, activeGdos, mode, customSettings])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0]
        if (!selected) return

        setFile(selected)
        resetState()
        parseFile(selected)
    }

    const resetState = () => {
        setErrorMsg(null)
        setPreviewData([])
        setCsvRawData([])
        setCsvFields([])
        setPayload(null)
        setMapping(null)
        setReport(null)
    }

    const parseFile = (file: File) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: "greedy",
            complete: (results) => {
                if (results.errors.length > 0 && results.data.length === 0) {
                    setErrorMsg(`Errore nella lettura del file: ${results.errors[0].message}`)
                    return
                }

                const fields = results.meta.fields || []
                setCsvFields(fields)
                setCsvRawData(results.data as any[])
                setPreviewData((results.data as any[]).slice(0, 5))

                // Auto-detect mapping with broader patterns
                const colNome = fields.find(f => /nome|name/i.test(f.trim()))
                const colTelefono = fields.find(f => /telefono|phone|cellulare|cell|tel\b/i.test(f.trim()))
                const colEmail = fields.find(f => /email|e-mail|mail/i.test(f.trim()))
                const colCognome = fields.find(f => /cognome|funnel|fonte|source|campagna/i.test(f.trim()))

                const autoMapping = {
                    nome: colNome || "",
                    email: colEmail || "",
                    telefono: colTelefono || "",
                    cognome: colCognome || ""
                }

                setMapping(autoMapping)

                // If required mappings are auto-detected, build payload immediately
                if (autoMapping.telefono && autoMapping.cognome) {
                    buildPayloadFromMapping(autoMapping, results.data as any[])
                }
            },
            error: (err) => {
                setErrorMsg(`Fallimento lettura CSV: ${err.message}`)
            }
        })
    }

    const buildPayloadFromMapping = (map: { nome: string, email: string, telefono: string, cognome: string }, data: any[]) => {
        const rows: CsvRowPayload[] = data.map((row: any, i: number) => ({
            rowIndex: i + 2,
            nome: map.nome ? (row[map.nome] || "") : "",
            email: map.email ? (row[map.email] || "") : "",
            telefono: map.telefono ? (row[map.telefono] || "") : "",
            cognome: map.cognome ? (row[map.cognome] || "") : "",
        }))
        setPayload(rows)
    }

    const handleMappingChange = (field: 'nome' | 'email' | 'telefono' | 'cognome', csvCol: string) => {
        const newMapping = { ...mapping!, [field]: csvCol }
        setMapping(newMapping)
        if (newMapping.telefono && newMapping.cognome) {
            buildPayloadFromMapping(newMapping, csvRawData)
        } else {
            setPayload(null)
        }
    }

    const confirmImport = async () => {
        if (!payload) return
        setLoading(true)
        setReport(null)

        try {
            // Save preferred settings persistently
            await saveAssignmentSettings(mode, customSettings)

            const res = await processCsvImport(payload, { mode, customSettings }, { allowDuplicates })
            setReport(res)
            if (res.inserted > 0) {
                router.refresh()
            }
        } catch (e: any) {
            setErrorMsg(e.message || "Eccezione durante il salvataggio sul server.")
        } finally {
            setLoading(false)
        }
    }

    const totalCalculatedAssigned = Object.values(distributionPreview).reduce((acc, val) => acc + val.count, 0)

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-10 px-4 sm:px-6 lg:px-0">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                        Importa Lead tramite CSV
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Carica l'export con le colonne richieste per popolare il CRM.
                    </p>
                </div>
                <button
                    onClick={() => setIsAddLeadOpen(true)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-brand-orange hover:bg-brand-orange-hover rounded-lg shadow-sm transition-all hover:shadow-md"
                >
                    <UserPlus className="h-4 w-4" />
                    Aggiungi Lead Singolo
                </button>
            </div>

            <AddLeadModal isOpen={isAddLeadOpen} onClose={() => setIsAddLeadOpen(false)} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6">

                {/* Step 1: Upload */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 col-span-1 md:col-span-1 space-y-4 h-fit">
                    <div className="flex items-center gap-2 border-b pb-3 mb-3">
                        <div className="h-6 w-6 rounded-full bg-brand-orange text-white flex items-center justify-center font-bold text-xs">1</div>
                        <h3 className="font-semibold text-gray-800">Carica File</h3>
                    </div>

                    <div
                        className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:border-brand-orange hover:bg-orange-50/30 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <FileUp className="h-8 w-8 text-gray-400 mb-2" />
                        <p className="text-sm font-medium text-gray-700">Clicca qui per caricare</p>
                        <p className="text-xs text-gray-500 mt-1">Solo formati CSV, TXT supportati</p>
                        <input
                            type="file"
                            accept=".csv,.txt"
                            className="hidden"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                        />
                    </div>

                    {file && (
                        <div className="bg-green-50 text-green-700 p-3 rounded text-xs font-medium border border-green-200 flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                            <span className="truncate" title={file.name}>{file.name} rilevato ({Math.round(file.size / 1024)} KB)</span>
                        </div>
                    )}

                    <div className="bg-blue-50/50 p-4 rounded text-xs text-gray-600 border border-blue-100 flex flex-col gap-2">
                        <p className="font-semibold text-blue-800 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> Requisiti CSV:</p>
                        <ul className="list-disc pl-4 space-y-1">
                            <li>Separatore gestito in automatico ( Virgola o Punto e Virgola ).</li>
                            <li>Le colonne indispensabili sono: <strong>Telefono1</strong> e <strong>Cognome</strong>.</li>
                            <li>Il <strong>Cognome</strong> verrà mappato come Funnel di provenienza.</li>
                            <li><strong>Nome</strong> ed <strong>Email</strong> sono facoltativi.</li>
                            <li>Le colonne superflue (es. Info, Unnamed) verranno ignorate.</li>
                        </ul>
                    </div>
                </div>

                {/* Step 2: Preview & Map */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 col-span-1 md:col-span-2 space-y-4">
                    <div className="flex items-center justify-between border-b pb-3 mb-3">
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-brand-orange text-white flex items-center justify-center font-bold text-xs">2</div>
                            <h3 className="font-semibold text-gray-800">Preview & Validazione</h3>
                        </div>
                    </div>

                    {!file && !errorMsg && (
                        <div className="h-48 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
                            <FileSpreadsheet className="h-8 w-8 mb-2 opacity-50" />
                            <p className="text-sm">In attesa del file CSV...</p>
                        </div>
                    )}

                    {errorMsg && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 flex items-start gap-3">
                            <XCircle className="h-5 w-5 shrink-0" />
                            <div>
                                <h4 className="font-bold text-sm mb-1">Upload Bloccato</h4>
                                <p className="text-sm">{errorMsg}</p>
                            </div>
                        </div>
                    )}

                    {mapping && csvFields.length > 0 && !errorMsg && !report && (
                        <div className="space-y-4 animate-in fade-in duration-300">

                            {/* Column Mapping Dropdowns */}
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <h4 className="text-sm font-semibold text-gray-700 mb-3">Mapping Colonne CSV → CRM</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                    {[
                                        { field: 'nome' as const, label: 'Nome', required: false },
                                        { field: 'telefono' as const, label: 'Telefono', required: true },
                                        { field: 'email' as const, label: 'Email', required: false },
                                        { field: 'cognome' as const, label: 'Funnel', required: true },
                                    ].map(({ field, label, required }) => (
                                        <div key={field}>
                                            <label className="text-xs font-medium text-gray-600 mb-1 block">
                                                {label} {required && <span className="text-red-500">*</span>}
                                            </label>
                                            <select
                                                value={mapping[field]}
                                                onChange={(e) => handleMappingChange(field, e.target.value)}
                                                className={`w-full h-9 px-2 text-sm border rounded-md focus:ring-brand-orange focus:border-brand-orange ${!mapping[field] && required ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white'}`}
                                            >
                                                <option value="">- Non mappato -</option>
                                                {csvFields.map(col => (
                                                    <option key={col} value={col}>{col}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                                {(!mapping.telefono || !mapping.cognome) && (
                                    <p className="text-xs text-red-600 mt-2">Mappa almeno Telefono e Funnel per procedere.</p>
                                )}
                            </div>

                            {/* Preview Table (first 5 rows based on mapping) */}
                            <div className="border border-gray-200 rounded-lg overflow-x-auto">
                                <table className="w-full text-left text-xs text-gray-600 min-w-[500px]">
                                    <thead className="bg-gray-100 text-gray-800 border-b">
                                        <tr>
                                            <th className="px-3 py-2">Row</th>
                                            <th className="px-3 py-2">Nome</th>
                                            <th className="px-3 py-2">Telefono</th>
                                            <th className="px-3 py-2">Email</th>
                                            <th className="px-3 py-2">Funnel</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white">
                                        {previewData.map((row, i) => (
                                            <tr key={i} className="hover:bg-gray-50 border-b last:border-0 border-gray-50">
                                                <td className="px-3 py-2 text-gray-400 font-mono">{i + 2}</td>
                                                <td className="px-3 py-2 font-medium">{mapping.nome ? (row[mapping.nome] || '-') : '-'}</td>
                                                <td className="px-3 py-2 font-mono">{mapping.telefono ? (row[mapping.telefono] || '-') : '-'}</td>
                                                <td className="px-3 py-2 truncate max-w-[120px]">{mapping.email ? (row[mapping.email] || '-') : '-'}</td>
                                                <td className="px-3 py-2">{mapping.cognome ? (row[mapping.cognome] || '-') : '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* --- SEZIONE REGOLE ASSEGNAZIONE (solo se mapping valido) --- */}
                            {payload && <div className="mt-8 border-t pt-6 bg-white rounded-xl">
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="h-6 w-6 rounded-full bg-brand-orange text-white flex items-center justify-center font-bold text-xs">3</div>
                                    <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                        Regole di Assegnazione
                                        {activeGdos.length === 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full ml-2 font-normal">Nessun GDO attivo!</span>}
                                    </h3>
                                </div>
                                <p className="text-xs text-gray-500 mb-4">Il sistema spacchetterà i <strong>{payload.length}</strong> contatti letti tra i {activeGdos.length} GDO online.</p>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                                    {/* Controlli Modalità */}
                                    <div className="space-y-4">
                                        <div className="flex gap-4 p-1 bg-gray-100/50 rounded-lg w-fit border border-gray-200">
                                            <button
                                                onClick={() => setMode('equal')}
                                                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${mode === 'equal' ? 'bg-white shadow-sm ring-1 ring-gray-200 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                                            >
                                                Equa (Round-Robin)
                                            </button>
                                            <button
                                                onClick={() => setMode('custom_quota')}
                                                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${mode === 'custom_quota' ? 'bg-white shadow-sm ring-1 ring-gray-200 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                                            >
                                                Quote Personalizzate
                                            </button>
                                        </div>

                                        {mode === 'custom_quota' && (
                                            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                                                <h4 className="text-xs font-semibold text-gray-700 mb-3 uppercase tracking-wider">Imposta Quote Lead fisse (#)</h4>
                                                <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                                                    {activeGdos.map(gdo => (
                                                        <div key={gdo.id} className="flex justify-between items-center bg-white p-2 px-3 rounded shadow-sm border border-gray-100">
                                                            <div className="flex items-center gap-2">
                                                                <div className="h-6 w-6 rounded-full bg-brand-orange/10 flex items-center justify-center text-brand-orange font-bold text-xs ring-1 ring-brand-orange/20">
                                                                    {gdo.displayName?.substring(0, 2).toUpperCase()}
                                                                </div>
                                                                <span className="text-sm font-medium text-gray-800">{gdo.displayName}</span>
                                                            </div>
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                className="w-20 form-input h-8 text-sm text-right px-2 border-gray-300 rounded focus:ring-brand-orange focus:border-brand-orange"
                                                                placeholder="N / Limit"
                                                                value={customSettings[gdo.id] || ''}
                                                                onChange={(e) => {
                                                                    setCustomSettings(prev => ({ ...prev, [gdo.id]: parseInt(e.target.value) || 0 }))
                                                                }}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className="text-xs text-gray-400 mt-3 leading-relaxed">Se la somma delle quote è inferiore al totale lead, i restanti verranno arrotondati e spartiti equamente stile Round-Robin.</p>
                                            </div>
                                        )}
                                        {mode === 'equal' && (
                                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
                                                In questa modalità, tutti i lead verranno spartiti in parti uguali (scarto ±1) scorrendo la lista in modo sequenziale.
                                            </div>
                                        )}
                                    </div>

                                    {/* Preview Result */}
                                    <div className="bg-gray-900 rounded-xl p-5 text-white shadow-xl">
                                        <h4 className="text-sm font-bold text-gray-100 flex items-center justify-between mb-4 pb-3 border-b border-gray-700">
                                            <span className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-orange" /> Distribuzione Prevista</span>
                                            <span className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">Su {payload.length} righe nette</span>
                                        </h4>
                                        <div className="space-y-2">
                                            {Object.entries(distributionPreview).map(([id, info]) => (
                                                <div key={id} className="flex items-center justify-between text-sm py-1">
                                                    <span className="text-gray-400 font-medium">{info.name}</span>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-24 bg-gray-800 h-2 rounded-full overflow-hidden">
                                                            <div
                                                                className="bg-brand-orange h-full rounded-full transition-[width] duration-500"
                                                                style={{ width: `${payload.length > 0 ? (info.count / payload.length) * 100 : 0}%` }}
                                                            />
                                                        </div>
                                                        <span className="font-bold w-12 text-right">{info.count} <span className="text-gray-500 text-xs font-normal">pz</span></span>
                                                    </div>
                                                </div>
                                            ))}
                                            {activeGdos.length === 0 && (
                                                <div className="text-center text-red-400 py-4 text-sm">Azione bloccata: non ci sono account Setter GDO attivati a sistema. Spuntali da "Gestione Team".</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>}

                            {payload && <>
                            <div className="pt-6 border-t border-gray-100">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={allowDuplicates}
                                        onChange={(e) => setAllowDuplicates(e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-brand-orange focus:ring-brand-orange"
                                    />
                                    <div>
                                        <span className="text-sm font-medium text-gray-800 group-hover:text-brand-orange transition-colors">Consenti duplicati</span>
                                        <p className="text-xs text-gray-500">Ignora il controllo telefono/email duplicati nel CRM e nel file</p>
                                    </div>
                                </label>
                            </div>

                            <div className="pt-4 mb-4 flex justify-end">
                                <button
                                    onClick={confirmImport}
                                    disabled={loading || activeGdos.length === 0}
                                    className="flex items-center gap-2 py-3 px-8 rounded-lg shadow-md text-sm font-bold text-white bg-brand-orange hover:bg-brand-orange-hover focus:outline-none disabled:opacity-50 transition-all hover:shadow-lg hover:-translate-y-0.5"
                                >
                                    {loading ? "Elaborazione DB in corso..." : `Conferma Esecuzione Assegnamento`}
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                            </>}
                        </div>
                    )}

                    {/* Step 3: Report Finale */}
                    {report && (
                        <div className="animate-in fade-in slide-in-from-left-4 duration-500 mt-4">
                            <div className={`p-4 border-b rounded-t-lg ${report.inserted > 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                                    {report.inserted > 0 ? (
                                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                                    ) : (
                                        <XCircle className="h-5 w-5 text-red-600" />
                                    )}
                                    Importazione Completata!
                                </h3>
                            </div>
                            <div className="p-5 grid grid-cols-3 gap-4 bg-gray-50 border-x border-gray-200">
                                <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 text-center">
                                    <p className="text-sm text-gray-500 font-medium tracking-wide border-b pb-2 mb-2">Letti da CSV</p>
                                    <p className="text-3xl font-bold text-gray-800">{report.total}</p>
                                </div>
                                <div className="bg-gradient-to-br from-green-50 to-white p-4 rounded-lg shadow flex flex-col items-center justify-center border border-green-200 text-center relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-2"><CheckCircle2 className="h-8 w-8 text-green-100" /></div>
                                    <p className="text-sm text-green-700 font-bold tracking-wide mb-1 relative z-10">Inseriti e Assegnati</p>
                                    <p className="text-4xl font-black text-green-600 relative z-10">{report.inserted}</p>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow-sm border border-red-200 text-center">
                                    <p className="text-sm text-red-600 font-medium tracking-wide border-b border-red-50 pb-2 mb-2">Scartati</p>
                                    <p className="text-3xl font-bold text-red-700">{report.rejected}</p>
                                </div>
                            </div>

                            {Object.keys(report.perGdoAssigned || {}).length > 0 && (
                                <div className="p-4 bg-gray-50 border-x border-b border-gray-200 flex flex-wrap gap-2 text-xs">
                                    <span className="font-semibold text-gray-700 mr-2 py-1">Effettivi Assegnati:</span>
                                    {Object.entries(report.perGdoAssigned).map(([id, qta]) => {
                                        const nOwner = activeGdos.find(g => g.id === id)?.displayName || 'Sconosciuto'
                                        return <span key={id} className="bg-white px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 font-medium shadow-sm">{nOwner}: <strong className="text-brand-orange">{qta}</strong></span>
                                    })}
                                </div>
                            )}

                            {report.errors.length > 0 && (
                                <div className="p-5 border border-t-0 rounded-b-lg border-gray-200 bg-white">
                                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center justify-between">
                                        Log Scarti e Duplicati
                                        <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded">Scorri per leggere ▼</span>
                                    </h4>
                                    <div className="bg-red-50/50 p-4 rounded-md h-56 overflow-y-auto custom-scrollbar text-xs font-mono space-y-2 border border-red-100 shadow-inner">
                                        {report.errors.map((err, i) => (
                                            <div key={i} className="text-red-700 pb-2 border-b border-red-100/50 last:border-0 last:pb-0">{err}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>
    )
}
