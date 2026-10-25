"use client"

import { useState, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { Search, Calendar, Clock, Filter, ChevronRight, CheckCircle2, XCircle, Users, Inbox, Sun, Sunrise, Archive, Rocket, Check, Loader2 } from "lucide-react"
import { getConfermeAppointments, updateLeadDataConferme, setSalespersonOutcome } from "@/app/actions/confermeActions"
import { markConfermeAlertHandled } from "@/app/actions/confermeAlertActions"
import { isCallNowHandoff, isLeadLancio, lancioSceltaLabel } from "@/lib/lancio/conferme"

import dynamic from "next/dynamic"

const ConfermeDrawer = dynamic(
  () => import("@/components/ConfermeDrawer").then(mod => mod.ConfermeDrawer),
  { ssr: false, loading: () => <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" /></div> }
)
import { ConfermeBoardRow } from "@/components/ConfermeBoardRow"
import { ConfermeActiveTimerBanner } from "@/components/ConfermeActiveTimerBanner"
import { CloseLeadModal } from "@/components/CloseLeadModal"
import { format, subDays, addDays } from "date-fns"
import { it } from "date-fns/locale"
import { confermeBoardColumn, OGGI_ORE, DOMANI_ORE } from "@/lib/conferme/boardWindow"
import { connectConfermePresence, subscribeConfermePresence, subscribeConfermeLeadChanges } from "@/lib/confermePresence"
import {
    leadsInHour, nrCounts, applyNrFilter, snoozedOf, sortRichiami, filterStorico, storicoCounts,
    callsMade, gdoName, collegaName, type NrFilterMode,
} from "@/lib/conferme/boardView"
import { VenditoriAgendaButton } from "@/components/VenditoriAgendaButton"
import { dUi, dTab, dChip } from "@/components/conferme/diretta/ui"

type LeadData = any;

type ViewMode = 'oggi' | 'domani' | 'da_definire' | 'storico' | 'table';

/**
 * Board Conferme. `variant` 'diretta' = restyle scuro (PO 25/10/2026): stessi
 * dati, stessi filtri (src/lib/conferme/boardView.ts), stessi gestori, stesso
 * realtime e presence; cambia solo il disegno, in un ramo di render a parte.
 */
export function ConfermeBoard({ currentUser, variant = 'classic' }: { currentUser: any; variant?: 'classic' | 'diretta' }) {
    const [viewMode, setViewMode] = useState<ViewMode>('oggi')
    const [nrFilter, setNrFilter] = useState<NrFilterMode>('tutti')
    const [selectedHour, setSelectedHour] = useState<string | null>(null)

    // Dataset
    const [kanbanData, setKanbanData] = useState<{ flatList: LeadData[], daDefinire: LeadData[] }>({ flatList: [], daDefinire: [] })
    const [tableData, setTableData] = useState<LeadData[]>([])
    const [storicoData, setStoricoData] = useState<LeadData[]>([])
    const [storicoFilter, setStoricoFilter] = useState<'tutti' | 'confermati' | 'scartati'>('tutti')

    // Derived Data for Views
    const [oggiLeads, setOggiLeads] = useState<LeadData[]>([])
    const [domaniLeads, setDomaniLeads] = useState<LeadData[]>([])
    const [oggiHours, setOggiHours] = useState<string[]>([])
    const [domaniHours, setDomaniHours] = useState<string[]>([])

    const [loading, setLoading] = useState(true)

    // Table Filters
    const [searchQuery, setSearchQuery] = useState("")
    const [dateRange, setDateRange] = useState<{ start?: Date, end?: Date }>({
        start: new Date(new Date().setHours(0, 0, 0, 0)),
        end: new Date(new Date().setHours(23, 59, 59, 999)),
    })
    const [datePreset, setDatePreset] = useState("today")

    // Storico date filter (giorno per giorno dei lead confermati/scartati)
    const [storicoDateStart, setStoricoDateStart] = useState<string>(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    })
    const [storicoDateEnd, setStoricoDateEnd] = useState<string>(() => new Date().toISOString().split('T')[0])

    // Drawer state
    const [selectedLead, setSelectedLead] = useState<LeadData | null>(null)
    const [isDrawerOpen, setIsDrawerOpen] = useState(false)
    const [drawerInitialTab, setDrawerInitialTab] = useState<string | undefined>(undefined)
    const [pendingDeepLink, setPendingDeepLink] = useState<{ leadId: string; tab?: string } | null>(null)

    const searchParams = useSearchParams()
    const deepLinkLeadId = searchParams.get('lead')
    const deepLinkTab = searchParams.get('tab')

    // Deep-link dalla notifica "Nota dal Fissatore": /conferme?lead=<id>&tab=note.
    // I parametri si leggono in modo reattivo: l'operatore Conferme sta già su
    // questa board tutto il giorno, e una navigazione sulla stessa rotta non
    // rimonta il sottoalbero client — un effetto legato al solo mount non
    // scatterebbe mai. Subito dopo l'URL si ripulisce dei due parametri (gli
    // altri restano), così un refresh non riapre il drawer su un lead superato.
    useEffect(() => {
        if (!deepLinkLeadId) return
        setPendingDeepLink({ leadId: deepLinkLeadId, tab: deepLinkTab ?? undefined })
        const params = new URLSearchParams(window.location.search)
        params.delete('lead')
        params.delete('tab')
        const rest = params.toString()
        window.history.replaceState({}, '', rest ? `${window.location.pathname}?${rest}` : window.location.pathname)
    }, [deepLinkLeadId, deepLinkTab])

    // Il lead può stare in una qualsiasi delle liste caricate a seconda della
    // vista attiva. Il deep-link vale un colpo solo: se un drawer è già aperto
    // non glielo si strappa da sotto (si perderebbe quello che l'operatore sta
    // scrivendo).
    //
    // Se a caricamento finito il lead non è in nessuna lista — un richiamo
    // parcheggiato da giorni, o un lead fuori dalla finestra del kanban — lo si
    // carica da solo, invece di rinunciare in silenzio: l'avviso bloccante dei
    // richiami manda qui proprio quei lead, e il bottone "Apri e chiamalo" deve
    // aprire la scheda sempre.
    useEffect(() => {
        if (!pendingDeepLink) return
        if (isDrawerOpen) {
            setPendingDeepLink(null)
            return
        }
        const pools = [kanbanData.flatList, kanbanData.daDefinire, tableData, storicoData, oggiLeads, domaniLeads]
        for (const pool of pools) {
            const found = pool.find((i: any) => i?.lead?.id === pendingDeepLink.leadId)
            if (found) {
                setSelectedLead(found)
                setDrawerInitialTab(pendingDeepLink.tab)
                setIsDrawerOpen(true)
                setPendingDeepLink(null)
                return
            }
        }
        if (loading) return

        let annullato = false
        const target = pendingDeepLink
        setPendingDeepLink(null)
        getConfermeAppointments({ leadId: target.leadId, fetchMode: 'all', timeSlot: 'tutto', confermeStatus: 'tutti' })
            .then(res => {
                const item = res.flatList[0]
                if (annullato || !item) return
                setSelectedLead(item as any)
                setDrawerInitialTab(target.tab)
                setIsDrawerOpen(true)
            })
            .catch(() => { /* lead non accessibile: si rinuncia in silenzio */ })
        return () => { annullato = true }
    }, [pendingDeepLink, isDrawerOpen, loading, kanbanData, tableData, storicoData, oggiLeads, domaniLeads])

    // Close-lead modal state (quick action "Chiuso" dallo storico)
    const [closeModalLead, setCloseModalLead] = useState<{ id: string; version: number; name: string } | null>(null)

    // Presence
    const [globalPresence, setGlobalPresence] = useState<any[]>([])

    const fetchLeads = async (showSpinner = true) => {
        if (showSpinner) setLoading(true)
        try {
            if (viewMode === 'storico') {
                const s = storicoDateStart ? new Date(storicoDateStart + 'T00:00:00') : undefined;
                const e = storicoDateEnd ? new Date(storicoDateEnd + 'T23:59:59') : undefined;
                const data = await getConfermeAppointments({
                    fetchMode: "all",
                    timeSlot: "tutto",
                    searchQuery,
                    confermeStatus: "storico",
                    startDate: s,
                    endDate: e,
                    dateFilterField: "confirmationsTimestamp",
                })
                setStoricoData(data.flatList)
            } else if (viewMode === 'table') {
                const data = await getConfermeAppointments({
                    fetchMode: "all",
                    startDate: dateRange.start,
                    endDate: dateRange.end,
                    timeSlot: "tutto",
                    searchQuery,
                    confermeStatus: "tutti"
                })
                setTableData(data.flatList)
            } else {
                const data = await getConfermeAppointments({
                    fetchMode: "strict_kanban", // Automatically ignores dates
                    searchQuery: searchQuery
                })
                setKanbanData({ flatList: data.flatList, daDefinire: data.daDefinire })

                // Oggi / Domani mattina: la regola sta in src/lib/conferme/boardWindow.ts
                // (PO 24/10/2026), la stessa che il server ha già applicato. Qui
                // smista solo nelle due colonne; le ore sono uguali tutti i giorni.
                const now = new Date();
                setOggiLeads(data.flatList.filter(l => confermeBoardColumn(l.lead, now) === 'oggi'));
                setDomaniLeads(data.flatList.filter(l => confermeBoardColumn(l.lead, now) === 'domani'));
                const hh = (h: number) => `${h.toString().padStart(2, '0')}:00`;
                setOggiHours(OGGI_ORE.map(hh));
                setDomaniHours(DOMANI_ORE.map(hh));
            }
        } catch (error) {
            console.error(error)
        } finally {
            if (showSpinner) setLoading(false)
        }
    }



    useEffect(() => {
        const timer = setTimeout(() => {
            fetchLeads(true)
        }, 400)
        return () => clearTimeout(timer)
    }, [viewMode, searchQuery, dateRange, storicoDateStart, storicoDateEnd])

    // Auto-select first hour when views change
    useEffect(() => {
        if (viewMode === 'oggi' && oggiHours.length > 0 && !oggiHours.includes(selectedHour || '')) {
            setSelectedHour(oggiHours[0]);
        } else if (viewMode === 'domani' && domaniHours.length > 0 && !domaniHours.includes(selectedHour || '')) {
            setSelectedHour(domaniHours[0]);
        }
    }, [viewMode, oggiHours, domaniHours, selectedHour]);

    // Refs per leggere lo stato corrente dentro i listener realtime senza
    // ricreare il canale (prima il canale veniva smontato/rimontato a ogni
    // cambio vista → presence a intermittenza — QA Conferme 2026-06-12).
    const viewModeRef = useRef(viewMode)
    useEffect(() => { viewModeRef.current = viewMode }, [viewMode])
    const fetchLeadsRef = useRef(fetchLeads)
    useEffect(() => { fetchLeadsRef.current = fetchLeads })

    useEffect(() => {
        // Canale presence SINGLETON condiviso con Drawer e Radar — vedi
        // src/lib/confermePresence.ts. Mai creare qui un secondo canale
        // con lo stesso topic.
        const disconnect = connectConfermePresence({
            id: currentUser.id,
            name: currentUser.name,
            displayName: currentUser.displayName,
        })

        const offChanges = subscribeConfermeLeadChanges(() => {
            // Silently refetch when a change occurs to avoid stale data
            const vm = viewModeRef.current
            if (vm !== 'table' && vm !== 'storico') fetchLeadsRef.current(false)
        })

        const offPresence = subscribeConfermePresence((entries) => {
            // Update global presence for the locked cards (chi è su quale lead)
            setGlobalPresence(entries.filter(p => p.leadId))
        })

        return () => {
            offChanges()
            offPresence()
            disconnect()
        }
    }, [currentUser.id])

    // Aprire la scheda di un lead con un richiamo scaduto spegne l'avviso
    // bloccante per TUTTE le Conferme (spec 2026-08-31). Sta qui in un solo
    // effetto invece che sui singoli onClick perché il drawer si apre da cinque
    // punti diversi della board, e uno dimenticato lascerebbe l'avviso a suonare
    // addosso ai colleghi mentre il lead è già in lavorazione.
    useEffect(() => {
        if (!isDrawerOpen || !selectedLead) return
        const lead = (selectedLead as any)?.lead
        if (!lead) return
        // Due tipi di richiamo, stessa regola: lo snooze in giornata
        // (confSnoozeAt) e il parcheggio ad altri giorni (recallDate, badge blu).
        const scadenza = lead.confNeedsReschedule && lead.recallDate ? lead.recallDate : lead.confSnoozeAt
        if (!scadenza) return
        const scadenzaMs = new Date(scadenza).getTime()
        if (scadenzaMs > Date.now()) return
        // Un "gestito" più vecchio della scadenza è di una tornata precedente:
        // va riscritto, altrimenti l'avviso di adesso resterebbe acceso.
        const gestito = lead.confAlertHandledAt
        if (gestito && new Date(gestito).getTime() >= scadenzaMs) return
        markConfermeAlertHandled(lead.id).catch(() => { /* non blocca il lavoro */ })
    }, [isDrawerOpen, selectedLead])

    // La sveglia dei richiami scaduti non vive più qui: era un alert() nativo
    // (bloccava il tab, partiva solo per chi stava sulla board, solo sui lead di
    // oggi/domani e una volta sola per sessione). Ora è l'avviso bloccante
    // globale ConfermeRecallBlockingAlert, montato nel layout dashboard.

    const handleDatePreset = (preset: string) => {
        setDatePreset(preset)
        const now = new Date()
        if (preset === "today") {
            setDateRange({ start: new Date(now.setHours(0, 0, 0, 0)), end: new Date(now.setHours(23, 59, 59, 999)) })
        } else if (preset === "tomorrow") {
            const tmr = addDays(now, 1)
            setDateRange({ start: new Date(tmr.setHours(0, 0, 0, 0)), end: new Date(tmr.setHours(23, 59, 59, 999)) })
        } else if (preset === "7days") {
            const start = subDays(now, 7)
            setDateRange({ start: new Date(start.setHours(0, 0, 0, 0)), end: new Date(now.setHours(23, 59, 59, 999)) })
        } else if (preset === "all") {
            setDateRange({ start: undefined, end: undefined })
        }
    }

    const openDrawer = (item: LeadData) => {
        setSelectedLead(item)
        setDrawerInitialTab(undefined)
        setIsDrawerOpen(true)
    }

    // Esito venditore rapido dallo Storico (Chiuso apre la modale: importo, data e prodotto obbligatori).
    const handleStoricoOutcome = async (leadId: string, version: number, outcome: "Chiuso" | "Non chiuso" | "Lead non presenziato", e: React.MouseEvent) => {
        e.stopPropagation();
        if (outcome === 'Chiuso') {
            const item = storicoData.find(i => i.lead.id === leadId);
            setCloseModalLead({ id: leadId, version, name: item?.lead.name || 'Lead' });
            return;
        }
        const res = await setSalespersonOutcome(leadId, version, outcome);
        if (res.success) fetchLeads(false);
        else alert(res.error === 'CONCURRENCY_ERROR' ? 'Qualcun altro ha modificato questo lead. Ricarica.' : res.error || 'Errore');
    };

    // --- RENDER COMPACT LEAD ROW ---
    const renderRowComponent = (item: LeadData, layoutMode: 'default' | 'snooze' | 'richiami' = 'default') => {
        const lockedByEntry = globalPresence.find(p => p.leadId === item.lead.id && p.user?.id !== currentUser.id)
        const lockedByName: string | null = lockedByEntry?.user?.displayName || lockedByEntry?.user?.name || null
        return (
            <ConfermeBoardRow
                key={item.lead.id}
                item={item}
                currentUser={currentUser}
                isLocked={!!lockedByEntry}
                lockedByName={lockedByName}
                layoutMode={layoutMode}
                variant={variant}
                onRefresh={() => fetchLeads(false)}
                onRowClick={() => { setSelectedLead(item); setDrawerInitialTab(undefined); setIsDrawerOpen(true); }}
            />
        )
    }

    const renderEmptyState = (message: string) => (
        <div className="flex flex-col items-center justify-center p-10 text-center bg-gradient-to-br from-white to-ash-50 rounded-2xl border border-ash-200/60 shadow-soft mb-6 animate-fade-in">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-soft">
                <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-ash-800 mb-1">Tutto Pulito!</h3>
            <p className="text-ash-500 text-sm font-medium">{message}</p>
        </div>
    )

    const renderActiveTimeline = () => {
        const activeLeads = viewMode === "oggi" ? oggiLeads : viewMode === "domani" ? domaniLeads : [];
        const activeHours = viewMode === "oggi" ? oggiHours : viewMode === "domani" ? domaniHours : [];

        if (activeHours.length === 0) return null;

        return (
            <div className="w-full border-b border-ash-200/40 sticky top-0 bg-white/90 backdrop-blur-sm z-10 pt-3 pb-3 mb-4 shadow-soft">
                <div className="flex flex-nowrap items-center gap-2 w-full max-w-[1400px] mx-auto px-3 overflow-x-auto pb-1 scrollbar-thin">
                    {activeHours.map((hourParam) => {
                    const leadsForHour = leadsInHour(activeLeads, hourParam);

                    const allDone = leadsForHour.length > 0 && leadsForHour.every(l => !!l.lead.confirmationsOutcome);
                    const trafficColor = leadsForHour.length === 0 ? "bg-ash-300" : allDone ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-ember-400 shadow-[0_0_6px_rgba(232,82,63,0.4)]";

                    return (
                        <button
                            key={hourParam}
                            onClick={() => { setSelectedHour(hourParam); setNrFilter('tutti'); }}
                            className={`flex items-center gap-2 shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all duration-200 ${selectedHour === hourParam ? 'bg-gradient-to-b from-brand-orange-50 to-white border-brand-orange/40 text-brand-orange-700 shadow-card ring-1 ring-brand-orange/20 scale-[1.03]' : 'bg-white border-ash-200 hover:bg-ash-50 hover:border-ash-300 text-ash-600'}`}
                        >
                            {hourParam}
                            <div className={`w-2.5 h-2.5 rounded-full ${trafficColor} border border-white/50`} />
                        </button>
                    )
                })}
                </div>
            </div>
        )
    }

    const renderNRFilters = (leadsForHour: LeadData[]) => {
        const counts = nrCounts(leadsForHour)

        const filterButton = (key: NrFilterMode, label: string) => (
            <label className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border text-[13px] font-bold cursor-pointer transition-all duration-200 ${nrFilter === key ? 'bg-gradient-to-b from-ash-700 to-ash-800 text-white border-ash-900 shadow-card' : 'bg-white text-ash-600 border-ash-200 hover:border-brand-orange/30 hover:bg-brand-orange-50/40'}`}>
                <input type="radio" value={key} checked={nrFilter === key} onChange={() => setNrFilter(key)} className="hidden" />
                {label} <span className={`ml-1 px-1.5 rounded-md text-[11px] ${nrFilter === key ? 'bg-ash-600 text-white' : 'bg-ash-100 text-ash-500'}`}>{counts[key]}</span>
            </label>
        );

        return (
            <div className="flex flex-wrap items-center gap-2 mb-4 px-1 mt-4">
                {filterButton('tutti', 'Tutti')}
                {filterButton('0', '0 Chiamate')}
                {filterButton('1', '1 Chiamata')}
                {filterButton('2', '2 Chiamate')}
                {filterButton('3', '3 Chiamate')}
            </div>
        )
    }

    const renderSelectedHourLeads = () => {
        if (!selectedHour) return null;
        const activeLeads = viewMode === "oggi" ? oggiLeads : viewMode === "domani" ? domaniLeads : [];
        const hourLeads = leadsInHour(activeLeads, selectedHour);

        // Render the pill filters first
        const filtersJSX = renderNRFilters(hourLeads);

        // Apply filters
        const targetLeads = applyNrFilter(hourLeads, nrFilter);
        // Calculate Snoozed logic (Global visibility across the day, regardless of selected hour views)
        const snoozedLeads = snoozedOf(kanbanData.flatList);

        // Snoozed leads now stay in the main view too (F3-017)
        const normalTargetLeads = targetLeads;

        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 w-full max-w-[1400px] mx-auto pb-12 gap-4 sm:gap-6 items-start px-2">
                <div className="lg:col-span-2 flex flex-col w-full min-w-0">
                    {filtersJSX}
                    <div className="flex flex-col w-full bg-white border border-ash-200/60 rounded-xl p-2 shadow-soft">
                        {normalTargetLeads.length === 0 ? (
                            <div className="text-center py-8 text-ash-400 text-sm font-medium flex flex-col items-center gap-2">
                                <Inbox className="w-8 h-8 text-ash-300" />
                                Nessun lead corrispondente ai filtri in questa fascia oraria.
                            </div>
                        ) : (
                            normalTargetLeads.map((l, idx) => (
                                <div key={l.lead.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(idx * 30, 300)}ms`, animationFillMode: 'backwards' }}>
                                    {renderRowComponent(l, 'default')}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="lg:col-span-1 flex flex-col w-full min-w-0 mt-4 lg:mt-0 pt-0 lg:pt-[72px]">
                    <div className="bg-gradient-to-br from-brand-orange-50 to-gold-50 border border-brand-orange-200/60 rounded-xl p-3.5 shadow-soft mb-4">
                        <h3 className="text-brand-orange-700 font-bold mb-1 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Richiamati In Giornata</h3>
                        <div className="text-[12px] text-brand-orange-600/80 leading-tight">Lead spostati temporaneamente (&quot;Snooze&quot;). Suonerà una sveglia all&apos;orario stabilito.</div>
                    </div>
                    <div className="flex flex-col bg-white border border-ash-200/60 rounded-xl p-2 shadow-soft min-h-[150px]">
                        {snoozedLeads.length === 0 ? (
                            <div className="text-center my-auto py-6 text-ash-400 text-xs font-semibold">Nessun richiamo attivo.</div>
                        ) : (
                            snoozedLeads.map(l => renderRowComponent(l, 'snooze'))
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const visibleLeadsForBanner = (() => {
        const seen = new Map<string, { id: string; name?: string | null }>();
        const push = (arr: any[]) => {
            for (const x of arr) {
                const lead = x?.lead || x;
                if (lead && lead.id && !seen.has(lead.id)) {
                    seen.set(lead.id, { id: lead.id, name: lead.name });
                }
            }
        };
        push(kanbanData.flatList);
        push(kanbanData.daDefinire);
        push(tableData);
        push(storicoData);
        return Array.from(seen.values());
    })();

    // Drawer del lead e modale "Chiuso" dallo storico: uguali nelle due grafiche
    // (il drawer riceve la variante e si disegna da sé).
    const drawerAndModal = (
        <>
            {isDrawerOpen && selectedLead && (
                <ConfermeDrawer
                    isOpen={true}
                    item={selectedLead}
                    currentUser={currentUser}
                    initialTab={drawerInitialTab}
                    variant={variant}
                    onRefresh={() => fetchLeads(false)}
                    onClose={() => {
                        setIsDrawerOpen(false)
                        setDrawerInitialTab(undefined)
                        fetchLeads(false)
                    }}
                />
            )}

            <CloseLeadModal
                open={!!closeModalLead}
                leadName={closeModalLead?.name}
                onCancel={() => setCloseModalLead(null)}
                onSubmit={async ({ closeAmountEur, closedAtDateStr, closeProduct }) => {
                    if (!closeModalLead) return;
                    // Costruisci un Date a mezzogiorno Europe/Rome del giorno scelto
                    // per evitare ambiguità di offset (DST) sui bordi settimana.
                    const closedAt = new Date(`${closedAtDateStr}T12:00:00`);
                    const res = await setSalespersonOutcome(
                        closeModalLead.id,
                        closeModalLead.version,
                        'Chiuso',
                        undefined,
                        closeAmountEur,
                        closedAt,
                        closeProduct,
                    );
                    if (res.success) {
                        setCloseModalLead(null);
                        fetchLeads(false);
                    } else {
                        const msg = res.error === 'CONCURRENCY_ERROR'
                            ? 'Qualcun altro ha modificato questo lead. Ricarica.'
                            : res.error === 'CLOSE_AMOUNT_REQUIRED'
                                ? 'Importo obbligatorio (> 0).'
                                : res.error === 'CLOSE_DATE_REQUIRED'
                                    ? 'Data chiusura obbligatoria.'
                                    : res.error === 'CLOSE_DATE_INVALID'
                                        ? 'Data chiusura non valida.'
                                        : res.error === 'CLOSE_PRODUCT_REQUIRED'
                                            ? 'Prodotto obbligatorio.'
                                            : (res.error || 'Errore');
                        throw new Error(msg);
                    }
                }}
            />
        </>
    )

    // ─── Grafica Diretta (PO 25/10/2026) ─────────────────────────────────────
    // Stessi dati e stesse funzioni di smistamento della grafica classica.

    const emptyD = (message: string) => (
        <div className="rounded-2xl bg-[var(--d-surface)] px-6 py-10 text-center text-sm text-[var(--d-muted)]">{message}</div>
    )

    const renderHoursD = () => {
        const activeLeads = viewMode === "oggi" ? oggiLeads : viewMode === "domani" ? domaniLeads : [];
        const activeHours = viewMode === "oggi" ? oggiHours : viewMode === "domani" ? domaniHours : [];
        if (activeHours.length === 0) return null;
        return (
            <div role="group" aria-label="Fasce orarie" className="mb-4 flex gap-1 overflow-x-auto pb-1 [color-scheme:dark] [scrollbar-width:thin]">
                {activeHours.map((hourParam) => {
                    const leadsForHour = leadsInHour(activeLeads, hourParam);
                    const allDone = leadsForHour.length > 0 && leadsForHour.every(l => !!l.lead.confirmationsOutcome);
                    const selected = selectedHour === hourParam;
                    return (
                        <button
                            key={hourParam}
                            onClick={() => { setSelectedHour(hourParam); setNrFilter('tutti'); }}
                            aria-pressed={selected}
                            className={dTab(selected)}
                        >
                            {hourParam}
                            {allDone ? (
                                <Check className="h-4 w-4" strokeWidth={1.75} aria-label="tutti lavorati" />
                            ) : (
                                <span className={leadsForHour.length === 0 ? 'opacity-50' : selected ? '' : 'font-semibold text-[var(--d-orange)]'}>
                                    {leadsForHour.length}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>
        )
    }

    const renderSelectedHourD = () => {
        if (!selectedHour) return null;
        const activeLeads = viewMode === "oggi" ? oggiLeads : viewMode === "domani" ? domaniLeads : [];
        const hourLeads = leadsInHour(activeLeads, selectedHour);
        const counts = nrCounts(hourLeads);
        const targetLeads = applyNrFilter(hourLeads, nrFilter);
        const snoozedLeads = snoozedOf(kanbanData.flatList);
        const filtri: [NrFilterMode, string][] = [['tutti', 'Tutti'], ['0', '0 chiamate'], ['1', '1 chiamata'], ['2', '2 chiamate'], ['3', '3 chiamate']];

        return (
            <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-3">
                <div className="flex min-w-0 flex-col 2xl:col-span-2">
                    <div role="radiogroup" aria-label="Chiamate a vuoto" className="mb-3 flex flex-wrap gap-1">
                        {filtri.map(([key, label]) => (
                            <button key={key} role="radio" aria-checked={nrFilter === key} onClick={() => setNrFilter(key)} className={dChip(nrFilter === key)}>
                                {label} <span className={nrFilter === key ? '' : 'text-[var(--d-faint)]'}>{counts[key]}</span>
                            </button>
                        ))}
                    </div>
                    {targetLeads.length === 0
                        ? emptyD('Nessun lead in questa fascia con questo filtro.')
                        : targetLeads.map(l => renderRowComponent(l, 'default'))}
                </div>

                <section aria-label="Richiamati in giornata" className="flex min-w-0 flex-col">
                    <h3 className="text-base font-semibold">Richiamati in giornata</h3>
                    <p className="mb-3 mt-1 text-[13px] text-[var(--d-muted)]">Lead da risentire più tardi: all&apos;ora scelta parte l&apos;avviso.</p>
                    {snoozedLeads.length === 0
                        ? <div className="rounded-lg bg-[var(--d-surface)] px-4 py-6 text-center text-[13px] text-[var(--d-faint)]">Nessun richiamo attivo.</div>
                        : snoozedLeads.map(l => renderRowComponent(l, 'snooze'))}
                </section>
            </div>
        )
    }

    const renderRichiamiD = () => {
        const sortedDaDefinire = sortRichiami(kanbanData.daDefinire);
        return (
            <section aria-label="Richiami programmati" className="mx-auto w-full max-w-5xl">
                <h2 className="text-xl font-semibold">Richiami programmati</h2>
                <p className="mb-4 mt-1 text-sm text-[var(--d-muted)]">Lead parcheggiati fino al giorno del richiamo.</p>
                {sortedDaDefinire.length === 0
                    ? emptyD('La coda dei parcheggiati è vuota.')
                    : sortedDaDefinire.map(l => renderRowComponent(l, 'richiami'))}
            </section>
        )
    }

    const esitoVenditaD = (outcome: string | null) =>
        outcome === 'Chiuso' ? 'Chiuso' : outcome === 'Non chiuso' ? 'Presenziato' : 'Sparito'

    const renderStoricoD = () => {
        const filteredStorico = filterStorico(storicoData, storicoFilter);
        const { confermati, scartati } = storicoCounts(storicoData);
        const dateInput = "h-9 rounded-lg border-2 border-[var(--d-line)] bg-[var(--d-bg)] px-2 text-[13px] text-[var(--d-text)] outline-none [color-scheme:dark] focus:border-[var(--d-orange)]";
        const th = "px-4 py-3 font-medium";
        const td = "px-4 py-3 align-top";
        return (
            <section aria-label="Storico" className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div role="radiogroup" aria-label="Esito" className="flex flex-wrap gap-1">
                        {(['tutti', 'confermati', 'scartati'] as const).map(f => (
                            <button key={f} role="radio" aria-checked={storicoFilter === f} onClick={() => setStoricoFilter(f)} className={dChip(storicoFilter === f)}>
                                {f === 'tutti' ? 'Tutti' : f === 'confermati' ? 'Confermati' : 'Scartati'}{' '}
                                <span className={storicoFilter === f ? '' : 'text-[var(--d-faint)]'}>
                                    {f === 'tutti' ? storicoData.length : f === 'confermati' ? confermati : scartati}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="text-[var(--d-muted)]">Esito dal</span>
                        <input type="date" value={storicoDateStart} onChange={e => setStoricoDateStart(e.target.value)} aria-label="Dal giorno" className={dateInput} />
                        <span className="text-[var(--d-muted)]">al</span>
                        <input type="date" value={storicoDateEnd} onChange={e => setStoricoDateEnd(e.target.value)} aria-label="Al giorno" className={dateInput} />
                        <button
                            onClick={() => {
                                const d = new Date(); d.setDate(d.getDate() - 7)
                                setStoricoDateStart(d.toISOString().split('T')[0])
                                setStoricoDateEnd(new Date().toISOString().split('T')[0])
                            }}
                            className={dUi.btn}
                        >
                            Ultimi 7 giorni
                        </button>
                    </div>
                </div>

                {filteredStorico.length === 0 ? emptyD('Nessun lead nello storico.') : (
                    <div className="overflow-x-auto rounded-2xl bg-[var(--d-surface)]">
                        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                            <thead>
                                <tr className="text-[13px] text-[var(--d-muted)]">
                                    <th className={th}>Lead</th>
                                    <th className={th}>Telefono</th>
                                    <th className={th}>GDO</th>
                                    <th className={th}>Esito conferma</th>
                                    <th className={th}>Esito vendita</th>
                                    <th className={th}>Azioni</th>
                                    <th className={th}><span className="sr-only">Apri</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredStorico.map((item) => {
                                    const confermato = item.lead.confirmationsOutcome === 'confermato';
                                    return (
                                        <tr key={item.lead.id} onClick={() => openDrawer(item)} className="cursor-pointer border-t-2 border-[var(--d-bg)] transition-colors hover:bg-[var(--d-surface-2)]">
                                            <td className={td}>
                                                <div className="font-semibold">{item.lead.name}</div>
                                                {item.lead.funnel && <div className="text-[13px] text-[var(--d-muted)]">{item.lead.funnel}</div>}
                                            </td>
                                            <td className={`${td} whitespace-nowrap text-[var(--d-muted)]`}>{item.lead.phone}</td>
                                            <td className={td}>{gdoName(item.gdo)}</td>
                                            <td className={td}>
                                                {confermato ? (
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4" strokeWidth={1.75} /> Confermato</div>
                                                        {/* Lancio (spec §4.5): prenotati della mattina già confermati dal bot col venditore. */}
                                                        {isLeadLancio(item.lead) && (
                                                            <div
                                                                className="flex items-center gap-1.5 text-[13px] text-[var(--d-muted)]"
                                                                title={`Lancio Web Dev AI: ${lancioSceltaLabel(item.lead.lancioScelta, isCallNowHandoff(item.lead))}`}
                                                            >
                                                                <Rocket className="h-3.5 w-3.5" strokeWidth={1.75} />
                                                                Lancio{item.lead.salespersonAssigned ? `, a ${item.lead.salespersonAssigned}` : ''}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-1.5 font-medium"><XCircle className="h-4 w-4" strokeWidth={1.75} /> Scartato</div>
                                                        {item.lead.confirmationsDiscardReason && (
                                                            <div className="text-[13px] text-[var(--d-muted)] first-letter:uppercase">{item.lead.confirmationsDiscardReason}</div>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className={td}>
                                                {item.lead.salespersonOutcome
                                                    ? <span className="font-medium">{esitoVenditaD(item.lead.salespersonOutcome)}</span>
                                                    : confermato ? <span className="text-[var(--d-muted)]">In attesa</span> : null}
                                            </td>
                                            <td className={td} onClick={e => e.stopPropagation()}>
                                                {confermato && !item.lead.salespersonOutcome && (
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <button onClick={(e) => handleStoricoOutcome(item.lead.id, item.lead.version, 'Chiuso', e)} className={dUi.btn}>Chiuso</button>
                                                        <button onClick={(e) => handleStoricoOutcome(item.lead.id, item.lead.version, 'Non chiuso', e)} className={dUi.btn}>Presenziato</button>
                                                        <button onClick={(e) => handleStoricoOutcome(item.lead.id, item.lead.version, 'Lead non presenziato', e)} className={dUi.btn}>Sparito</button>
                                                    </div>
                                                )}
                                            </td>
                                            <td className={`${td} text-right align-middle`}>
                                                <ChevronRight className="ml-auto h-4 w-4 text-[var(--d-faint)]" strokeWidth={1.75} />
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        )
    }

    const renderTableD = () => {
        const presets: [string, string][] = [['today', 'Oggi'], ['tomorrow', 'Domani'], ['7days', 'Ultimi 7 giorni'], ['all', 'Tutti']];
        const th = "px-4 py-3 font-medium";
        const td = "px-4 py-3 align-top";
        return (
            <section aria-label="Vista globale" className="flex flex-col gap-4">
                <div role="radiogroup" aria-label="Periodo" className="flex flex-wrap gap-1">
                    {presets.map(([key, label]) => (
                        <button key={key} role="radio" aria-checked={datePreset === key} onClick={() => handleDatePreset(key)} className={dChip(datePreset === key)}>
                            {label}
                        </button>
                    ))}
                </div>
                {tableData.length === 0 ? emptyD('Nessun appuntamento trovato.') : (
                    <div className="overflow-x-auto rounded-2xl bg-[var(--d-surface)]">
                        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                            <thead>
                                <tr className="text-[13px] text-[var(--d-muted)]">
                                    <th className={th}>Data e ora</th>
                                    <th className={th}>Lead</th>
                                    <th className={th}>GDO</th>
                                    <th className={th}>Stato</th>
                                    <th className={th}><span className="sr-only">Apri</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {tableData.map((item) => {
                                    const p = globalPresence.find(p => p.leadId === item.lead.id);
                                    const who = p ? (collegaName(p.user?.displayName || p.user?.name) || 'un collega') : null;
                                    const nr = callsMade(item.lead);
                                    return (
                                        <tr key={item.lead.id} onClick={() => openDrawer(item)} className="cursor-pointer border-t-2 border-[var(--d-bg)] transition-colors hover:bg-[var(--d-surface-2)]">
                                            <td className={td}>
                                                {item.lead.confNeedsReschedule ? (
                                                    <span className="font-medium text-[var(--d-orange)]">Da definire</span>
                                                ) : (
                                                    <>
                                                        <div className="font-semibold">{item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "dd MMM yyyy", { locale: it }) : "N/D"}</div>
                                                        <div className="text-[var(--d-muted)]">{item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "HH:mm") : "N/D"}</div>
                                                    </>
                                                )}
                                            </td>
                                            <td className={td}>
                                                <div className="font-semibold">{item.lead.name}</div>
                                                <div className="text-[13px] text-[var(--d-muted)]">{item.lead.phone}</div>
                                            </td>
                                            <td className={td}>
                                                <div>{gdoName(item.gdo)}</div>
                                                {item.lead.funnel && <div className="max-w-[160px] truncate text-[13px] text-[var(--d-muted)]">{item.lead.funnel}</div>}
                                            </td>
                                            <td className={td}>
                                                <div className="flex flex-col gap-1">
                                                    {who && <div className="text-[13px] font-medium text-[var(--d-orange)]">In uso da {who}</div>}
                                                    <div className="font-medium">
                                                        {item.lead.confirmationsOutcome === "confermato" ? "Confermato" : item.lead.confirmationsOutcome === "scartato" ? "Scartato" : "Da lavorare"}
                                                    </div>
                                                    {!item.lead.confirmationsOutcome && nr > 0 && (
                                                        <div className="text-[13px] text-[var(--d-muted)]">{nr} {nr === 1 ? 'chiamata' : 'chiamate'} a vuoto</div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className={`${td} text-right align-middle`}>
                                                <ChevronRight className="ml-auto h-4 w-4 text-[var(--d-faint)]" strokeWidth={1.75} />
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        )
    }

    const renderDiretta = () => (
        <div className="relative flex min-h-[500px] flex-col text-[var(--d-text)]">
            <div className="sticky top-11 z-20 -mx-4 mb-4 flex flex-wrap items-center gap-3 bg-[var(--d-bg)] px-4 py-3 sm:-mx-8 sm:px-8">
                <div role="tablist" aria-label="Viste della board" className="flex flex-wrap gap-1">
                    <button role="tab" aria-selected={viewMode === 'oggi'} onClick={() => setViewMode('oggi')} className={dTab(viewMode === 'oggi')}>
                        Oggi <span className={viewMode === 'oggi' ? '' : 'text-[var(--d-faint)]'}>{oggiLeads.length}</span>
                    </button>
                    <button role="tab" aria-selected={viewMode === 'domani'} onClick={() => setViewMode('domani')} className={dTab(viewMode === 'domani')}>
                        Domani mattina <span className={viewMode === 'domani' ? '' : 'text-[var(--d-faint)]'}>{domaniLeads.length}</span>
                    </button>
                    <button role="tab" aria-selected={viewMode === 'da_definire'} onClick={() => setViewMode('da_definire')} className={dTab(viewMode === 'da_definire')}>
                        Richiami <span className={viewMode === 'da_definire' ? '' : 'text-[var(--d-faint)]'}>{kanbanData.daDefinire.length}</span>
                    </button>
                    <button role="tab" aria-selected={viewMode === 'storico'} onClick={() => setViewMode('storico')} className={dTab(viewMode === 'storico')}>
                        Storico
                    </button>
                </div>

                <div className="ml-auto flex w-full flex-wrap items-center gap-2 lg:w-auto">
                    <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border-2 border-[var(--d-line)] bg-[var(--d-bg)] px-3 transition-colors focus-within:border-[var(--d-orange)] lg:w-72 lg:flex-none">
                        <Search className="h-4 w-4 shrink-0 text-[var(--d-faint)]" strokeWidth={1.75} />
                        <input
                            type="text"
                            placeholder="Cerca per nome, email o telefono"
                            aria-label="Cerca un lead"
                            className="w-full min-w-0 bg-transparent text-sm text-[var(--d-text)] outline-none placeholder:text-[var(--d-faint)]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </label>
                    <button onClick={() => setViewMode('table')} aria-pressed={viewMode === 'table'} className={dTab(viewMode === 'table')}>
                        Vista globale
                    </button>
                    <VenditoriAgendaButton variant="diretta" />
                </div>
            </div>

            <ConfermeActiveTimerBanner visibleLeads={visibleLeadsForBanner} variant="diretta" />

            <div className="flex-1 pb-40">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-20 text-sm text-[var(--d-muted)]">
                        <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} /> Caricamento...
                    </div>
                ) : (
                    <>
                        {(viewMode === 'oggi' || viewMode === 'domani') && (
                            <>
                                {renderHoursD()}
                                {renderSelectedHourD()}
                            </>
                        )}
                        {viewMode === 'da_definire' && renderRichiamiD()}
                        {viewMode === 'storico' && renderStoricoD()}
                        {viewMode === 'table' && renderTableD()}
                    </>
                )}
            </div>

            {drawerAndModal}
        </div>
    )

    if (variant === 'diretta') {
        return renderDiretta()
    }

    return (
        <div className="flex flex-col min-h-[500px] relative">
            <ConfermeActiveTimerBanner visibleLeads={visibleLeadsForBanner} />
            {/* MEGA TOGGLES NAVIGATION - Premium Segmented Control */}
            <div className="flex items-center justify-between gap-4 mb-2 sticky top-0 z-20 bg-white/80 backdrop-blur-md pt-3 pb-3 border-b border-ash-200/40">
                <div className="flex p-1 bg-ash-100/80 rounded-xl max-w-2xl border border-ash-200/60 shadow-soft">
                    <button
                        onClick={() => setViewMode('oggi')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'oggi' ? 'bg-white text-ash-800 shadow-card border border-ash-200/60' : 'text-ash-500 hover:text-ash-700 hover:bg-white/50'}`}
                    >
                        <Sun className="w-4 h-4" /> Oggi <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[11px] leading-none font-bold ${viewMode === 'oggi' ? 'bg-brand-orange text-white' : 'bg-ash-300/60 text-ash-600'}`}>{oggiLeads.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('domani')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'domani' ? 'bg-white text-ash-800 shadow-card border border-ash-200/60' : 'text-ash-500 hover:text-ash-700 hover:bg-white/50'}`}
                    >
                        <Sunrise className="w-4 h-4" /> Domani mattina <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[11px] leading-none font-bold ${viewMode === 'domani' ? 'bg-gold-400 text-white' : 'bg-ash-300/60 text-ash-600'}`}>{domaniLeads.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('da_definire')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'da_definire' ? 'bg-white text-blue-700 shadow-card border border-blue-200/60' : 'text-blue-500/70 hover:text-blue-700 hover:bg-blue-50/40'}`}
                    >
                        <Clock className="w-4 h-4" /> Richiami <span className={`ml-1 px-1.5 py-0.5 rounded-md text-[11px] leading-none font-bold ${viewMode === 'da_definire' ? 'bg-blue-600 text-white' : 'bg-blue-100/80 text-blue-700'}`}>{kanbanData.daDefinire.length}</span>
                    </button>
                    <button
                        onClick={() => setViewMode('storico')}
                        className={`py-2.5 px-5 rounded-lg font-bold text-[13px] uppercase tracking-wide transition-all duration-200 flex items-center justify-center gap-2 max-w-[200px] ${viewMode === 'storico' ? 'bg-white text-ash-800 shadow-card border border-ash-200/60' : 'text-ash-500 hover:text-ash-700 hover:bg-white/50'}`}
                    >
                        <Archive className="w-4 h-4" /> Storico
                    </button>
                </div>

                <div className="flex w-full lg:w-auto items-center gap-3">
                    {/* GLOBAL SEARCH INPUT */}
                    <div className="flex items-center bg-ash-50/50 border border-ash-200 rounded-lg px-3 py-2 w-full lg:w-64 xl:w-80 shadow-soft transition-all focus-within:ring-2 focus-within:ring-brand-orange/30 focus-within:border-brand-orange/40">
                        <Search className="w-4 h-4 text-ash-400 mr-2 shrink-0" />
                        <input
                            type="text"
                            placeholder="Cerca per nome, email o telefono..."
                            className="bg-transparent border-none outline-none text-[13px] w-full placeholder:text-ash-400"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <button
                        onClick={() => setViewMode('table')}
                        className={`px-5 py-2.5 rounded-lg font-bold transition-all duration-200 text-xs uppercase tracking-wider flex items-center justify-center border shrink-0 ${viewMode === 'table' ? 'bg-gradient-to-b from-ash-700 to-ash-800 text-white border-ash-900 shadow-card' : 'bg-white text-ash-600 hover:bg-ash-50 border-ash-200 shadow-soft'}`}
                    >
                        Vista Globale DB
                    </button>
                </div>
            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 overflow-auto bg-gradient-to-b from-ash-50/50 to-white px-2 sm:px-4 pb-48">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <div className="animate-spin w-10 h-10 border-4 border-brand-orange border-t-transparent rounded-full"></div>
                        <div className="text-ash-400 text-sm font-medium">Caricamento...</div>
                    </div>
                ) : (
                    <>
                        {viewMode === 'oggi' && (
                            <div className="w-full h-full flex flex-col pt-0">
                                {renderActiveTimeline()}
                                {renderSelectedHourLeads()}
                            </div>
                        )}

                        {viewMode === 'domani' && (
                            <div className="w-full h-full flex flex-col pt-0">
                                {renderActiveTimeline()}
                                {renderSelectedHourLeads()}
                            </div>
                        )}

                        {viewMode === 'da_definire' && (() => {
                            const sortedDaDefinire = sortRichiami(kanbanData.daDefinire);

                            return (
                                <div className="w-full max-w-5xl mx-auto flex flex-col items-center pt-4 pb-12 animate-fade-in">
                                    <div className="w-full mb-4 p-4 bg-gradient-to-r from-blue-50 to-brand-orange-50/30 border border-blue-200/60 rounded-xl shadow-soft">
                                        <h2 className="text-lg font-black text-blue-800 uppercase tracking-wide mb-1 flex items-center gap-2"><Clock className="w-5 h-5" /> Richiami Programmati</h2>
                                        <div className="text-blue-700/80 font-medium text-sm">Lead parcheggiati in attesa della data prestabilita.</div>
                                    </div>
                                    <div className="w-full flex flex-col bg-white border border-ash-200/60 rounded-xl p-2 shadow-soft">
                                        {sortedDaDefinire.length === 0 ? (
                                            renderEmptyState("La coda dei parcheggiati è vuota.")
                                        ) : (
                                            sortedDaDefinire.map((l, idx) => (
                                                <div key={l.lead.id} className="animate-fade-in" style={{ animationDelay: `${Math.min(idx * 30, 300)}ms`, animationFillMode: 'backwards' }}>
                                                    {renderRowComponent(l, 'richiami')}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            );
                        })()}

                        {viewMode === 'storico' && (() => {
                            const filteredStorico = filterStorico(storicoData, storicoFilter);
                            const { confermati: confCount, scartati: scarCount } = storicoCounts(storicoData);

                            const handleSetOutcome = handleStoricoOutcome;

                            return (
                            <div className="flex flex-col h-full bg-white rounded-2xl border border-ash-200/60 shadow-card overflow-hidden mb-8 max-w-[1400px] mx-auto w-full animate-fade-in">
                                <div className="p-4 border-b border-ash-200/40 bg-gradient-to-r from-ash-50 to-white">
                                    <h2 className="text-lg font-black text-ash-800 uppercase tracking-wide flex items-center gap-2"><Archive className="w-5 h-5" /> Storico Conferme</h2>
                                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                                        {(['tutti', 'confermati', 'scartati'] as const).map(f => (
                                            <button key={f} onClick={() => setStoricoFilter(f)}
                                                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${storicoFilter === f ? 'bg-brand-orange text-white border-brand-orange' : 'bg-white text-ash-600 border-ash-200 hover:border-brand-orange/30'}`}>
                                                {f === 'tutti' ? `Tutti (${storicoData.length})` : f === 'confermati' ? `Confermati (${confCount})` : `Scartati (${scarCount})`}
                                            </button>
                                        ))}
                                        <div className="flex items-center gap-2 ml-auto">
                                            <span className="text-[11px] font-semibold uppercase tracking-wider text-ash-500">Filtro data esito</span>
                                            <input
                                                type="date"
                                                value={storicoDateStart}
                                                onChange={e => setStoricoDateStart(e.target.value)}
                                                className="px-2 py-1 rounded-lg border border-ash-200 text-xs font-medium bg-white outline-none focus:ring-2 focus:ring-brand-orange/30"
                                            />
                                            <span className="text-ash-400 text-xs">→</span>
                                            <input
                                                type="date"
                                                value={storicoDateEnd}
                                                onChange={e => setStoricoDateEnd(e.target.value)}
                                                className="px-2 py-1 rounded-lg border border-ash-200 text-xs font-medium bg-white outline-none focus:ring-2 focus:ring-brand-orange/30"
                                            />
                                            <button
                                                onClick={() => {
                                                    const d = new Date(); d.setDate(d.getDate() - 7)
                                                    setStoricoDateStart(d.toISOString().split('T')[0])
                                                    setStoricoDateEnd(new Date().toISOString().split('T')[0])
                                                }}
                                                className="px-2 py-1 rounded-lg border border-ash-200 text-[11px] font-semibold text-ash-600 hover:bg-ash-50"
                                                title="Ultimi 7 giorni"
                                            >Reset</button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto bg-white p-0">
                                    {filteredStorico.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-ash-400 gap-3 py-10">
                                            <div className="w-16 h-16 rounded-2xl bg-ash-50 flex items-center justify-center shadow-soft">
                                                <Archive className="w-8 h-8 text-ash-300" />
                                            </div>
                                            <div className="text-sm font-medium">Nessun lead nello storico</div>
                                        </div>
                                    ) : (
                                        <table className="w-full text-left border-collapse min-w-max">
                                            <thead>
                                                <tr className="bg-gradient-to-r from-ash-50 to-ash-100/50 sticky top-0 border-b border-ash-200/60 text-xs font-bold uppercase tracking-wider text-ash-500 z-10">
                                                    <th className="p-4 pl-6">Lead</th>
                                                    <th className="p-4">Telefono</th>
                                                    <th className="p-4">GDO</th>
                                                    <th className="p-4">Esito Conferma</th>
                                                    <th className="p-4">Esito Vendita</th>
                                                    <th className="p-4">Azioni</th>
                                                    <th className="p-4"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-ash-100/60">
                                                {filteredStorico.map((item) => (
                                                    <tr
                                                        key={item.lead.id}
                                                        className="hover:bg-brand-orange-50/30 transition-all duration-200 cursor-pointer group"
                                                        onClick={() => {
                                                            setSelectedLead(item)
                                                            setDrawerInitialTab(undefined)
                                                            setIsDrawerOpen(true)
                                                        }}
                                                    >
                                                        <td className="p-4 pl-6 align-top pt-5">
                                                            <div className="font-bold text-ash-800 text-[15px]">{item.lead.name}</div>
                                                            <div className="text-xs text-ash-400 mt-0.5">{item.lead.funnel}</div>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <div className="text-sm text-ash-600 font-medium">{item.lead.phone}</div>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-ash-100 text-ash-700 border border-ash-200/60">
                                                                {item.gdo?.displayName || item.gdo?.name || "N/A"}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            {item.lead.confirmationsOutcome === "confermato" ? (
                                                                <div className="flex flex-col items-start gap-1">
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                                                                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Confermato
                                                                    </span>
                                                                    {/* Lancio (spec §4.5): i prenotati della mattina nascono già confermati
                                                                        dal bot con il venditore del round robin. Badge + venditore, così
                                                                        le Conferme vedono che non c'è nessuna chiamata da fare. */}
                                                                    {isLeadLancio(item.lead) && (
                                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                                            <div
                                                                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 uppercase flex items-center gap-1"
                                                                                title={`Lancio Web Dev AI · ${lancioSceltaLabel(item.lead.lancioScelta, isCallNowHandoff(item.lead))}`}
                                                                            >
                                                                                <Rocket className="w-3 h-3" /> Lancio
                                                                            </div>
                                                                            {item.lead.salespersonAssigned && (
                                                                                <div className="text-[11px] font-semibold text-ash-600">→ {item.lead.salespersonAssigned}</div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <div>
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-ember-50 text-ember-600 border border-ember-200/60">
                                                                        <XCircle className="w-3.5 h-3.5 mr-1" /> Scartato
                                                                    </span>
                                                                    {item.lead.confirmationsDiscardReason && (
                                                                        <div className="text-[11px] text-ash-400 mt-1 capitalize">{item.lead.confirmationsDiscardReason}</div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            {item.lead.salespersonOutcome ? (
                                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                                                    item.lead.salespersonOutcome === 'Chiuso' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' :
                                                                    item.lead.salespersonOutcome === 'Non chiuso' ? 'bg-amber-50 text-amber-700 border-amber-200/60' :
                                                                    'bg-rose-50 text-rose-600 border-rose-200/60'
                                                                }`}>
                                                                    {item.lead.salespersonOutcome === 'Chiuso' ? '✅ Chiuso' :
                                                                     item.lead.salespersonOutcome === 'Non chiuso' ? '📋 Presenziato' :
                                                                     '❌ Sparito'}
                                                                </span>
                                                            ) : item.lead.confirmationsOutcome === 'confermato' ? (
                                                                <span className="text-xs text-ash-400 italic">In attesa...</span>
                                                            ) : (
                                                                <span className="text-xs text-ash-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="p-4 align-top pt-5" onClick={e => e.stopPropagation()}>
                                                            {item.lead.confirmationsOutcome === 'confermato' && !item.lead.salespersonOutcome && (
                                                                <div className="flex items-center gap-1.5">
                                                                    <button onClick={(e) => handleSetOutcome(item.lead.id, item.lead.version, 'Chiuso', e)}
                                                                        className="px-2 py-1 rounded text-[11px] font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors">
                                                                        Chiuso
                                                                    </button>
                                                                    <button onClick={(e) => handleSetOutcome(item.lead.id, item.lead.version, 'Non chiuso', e)}
                                                                        className="px-2 py-1 rounded text-[11px] font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors">
                                                                        Presenziato
                                                                    </button>
                                                                    <button onClick={(e) => handleSetOutcome(item.lead.id, item.lead.version, 'Lead non presenziato', e)}
                                                                        className="px-2 py-1 rounded text-[11px] font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors">
                                                                        Sparito
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="p-4 text-right align-middle">
                                                            <div className="w-8 h-8 rounded-lg bg-ash-50 border border-ash-200 flex items-center justify-center ml-auto group-hover:bg-brand-orange group-hover:border-brand-orange group-hover:text-white transition-all duration-200 shadow-soft">
                                                                <ChevronRight className="w-4 h-4 text-ash-400 group-hover:text-white transition-colors" />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        );})()}

                        {viewMode === 'table' && (
                            <div className="flex flex-col h-full bg-white rounded-2xl border border-ash-200/60 shadow-card overflow-hidden mb-8 max-w-[1400px] mx-auto w-full animate-fade-in">
                                <div className="p-4 border-b border-ash-200/40 bg-gradient-to-r from-ash-50 to-white flex flex-wrap gap-4 items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <div className="flex bg-white border border-ash-200 rounded-xl p-1 shrink-0 shadow-soft">
                                            <button onClick={() => handleDatePreset("today")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "today" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Oggi</button>
                                            <button onClick={() => handleDatePreset("tomorrow")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "tomorrow" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Domani</button>
                                            <button onClick={() => handleDatePreset("7days")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "7days" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Ultimi 7 gg</button>
                                            <button onClick={() => handleDatePreset("all")} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${datePreset === "all" ? "bg-gradient-to-b from-brand-orange to-brand-orange-500 text-white shadow-sm" : "text-ash-600 hover:bg-ash-50"}`}>Tutti</button>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-auto bg-white p-0">
                                    {tableData.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-ash-400 gap-3 py-10">
                                            <div className="w-16 h-16 rounded-2xl bg-ash-50 flex items-center justify-center shadow-soft">
                                                <Filter className="w-8 h-8 text-ash-300" />
                                            </div>
                                            <div className="text-sm font-medium">Nessun appuntamento trovato</div>
                                        </div>
                                    ) : (
                                        <table className="w-full text-left border-collapse min-w-max">
                                            <thead>
                                                <tr className="bg-gradient-to-r from-ash-50 to-ash-100/50 sticky top-0 border-b border-ash-200/60 text-xs font-bold uppercase tracking-wider text-ash-500 z-10">
                                                    <th className="p-4 pl-6">Data / Ora</th>
                                                    <th className="p-4">Lead</th>
                                                    <th className="p-4">GDO</th>
                                                    <th className="p-4">Stato</th>
                                                    <th className="p-4"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-ash-100/60">
                                                {tableData.map((item) => (
                                                    <tr
                                                        key={item.lead.id}
                                                        className="hover:bg-brand-orange-50/30 transition-all duration-200 cursor-pointer group"
                                                        onClick={() => {
                                                            setSelectedLead(item)
                                                            setDrawerInitialTab(undefined)
                                                            setIsDrawerOpen(true)
                                                        }}
                                                    >
                                                        <td className="p-4 pl-6 align-top pt-5">
                                                            {item.lead.confNeedsReschedule ? (
                                                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-50 to-amber-100 text-amber-800 uppercase tracking-widest border border-amber-200/60">Da Definire</span>
                                                            ) : (
                                                                <>
                                                                    <div className="flex items-center gap-2">
                                                                        <Calendar className="w-4 h-4 text-ash-400" />
                                                                        <span className="font-semibold text-ash-800">
                                                                            {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "dd MMM yyyy", { locale: it }) : "N/D"}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 mt-1.5 text-sm font-bold text-brand-orange-600">
                                                                        <Clock className="w-4 h-4" />
                                                                        <span>
                                                                            {item.lead.appointmentDate ? format(new Date(item.lead.appointmentDate), "HH:mm") : "N/D"}
                                                                        </span>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <div className="font-bold text-ash-800 text-[15px]">{item.lead.name}</div>
                                                            <div className="text-sm text-ash-500 mt-0.5">{item.lead.phone}</div>
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-ash-100 text-ash-700 border border-ash-200/60">
                                                                {item.gdo?.displayName || item.gdo?.name || "Sconosciuto"}
                                                            </span>
                                                            {item.lead.funnel && <div className="mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-ash-50 text-ash-500 uppercase truncate max-w-[120px]">{item.lead.funnel}</div>}
                                                        </td>
                                                        <td className="p-4 align-top pt-5">
                                                            <div className="flex flex-col gap-2 items-start">
                                                                {(() => {
                                                                    const p = globalPresence.find(p => p.leadId === item.lead.id);
                                                                    if (!p) return null;
                                                                    const who = p.user?.displayName || p.user?.name || 'altro utente';
                                                                    return (
                                                                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] uppercase tracking-widest font-bold bg-amber-100 text-amber-800 animate-pulse border border-amber-200 shadow-soft" title={`In uso da ${who}`}>
                                                                            <Users className="w-3 h-3" /> In uso · {who}
                                                                        </span>
                                                                    );
                                                                })()}
                                                                {item.lead.confirmationsOutcome === "confermato" ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 border border-emerald-200/60 shadow-soft">
                                                                        <CheckCircle2 className="w-4 h-4 mr-1.5" /> Confermato
                                                                    </span>
                                                                ) : item.lead.confirmationsOutcome === "scartato" ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-ember-50 to-rose-50 text-ember-600 border border-ember-200/60 shadow-soft">
                                                                        <XCircle className="w-4 h-4 mr-1.5" /> Scartato
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-50 to-brand-orange-50/30 text-blue-700 border border-blue-200/60 shadow-soft">
                                                                        Da lavorare
                                                                    </span>
                                                                )}

                                                                {(!item.lead.confirmationsOutcome) && (
                                                                    <div className="flex gap-1.5 mt-1" title="Tentativi NR">
                                                                        <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall1At ? 'bg-brand-orange-500 ring-2 ring-brand-orange-200' : 'bg-ash-200'}`} />
                                                                        <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall2At ? 'bg-brand-orange-500 ring-2 ring-brand-orange-200' : 'bg-ash-200'}`} />
                                                                        <div className={`w-2.5 h-2.5 rounded-full ${item.lead.confCall3At ? 'bg-ember-400 ring-2 ring-ember-200' : 'bg-ash-200'}`} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="p-4 text-right align-middle">
                                                            <div className="w-8 h-8 rounded-lg bg-ash-50 border border-ash-200 flex items-center justify-center ml-auto group-hover:bg-brand-orange group-hover:border-brand-orange group-hover:text-white transition-all duration-200 shadow-soft">
                                                                <ChevronRight className="w-4 h-4 text-ash-400 group-hover:text-white transition-colors" />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {drawerAndModal}
        </div>
    )
}
