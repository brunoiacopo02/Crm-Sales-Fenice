'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TargetStatsResponse, MonthlyTargetInput, saveMonthlyTarget } from '@/app/actions/targetActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Target, TrendingDown, TrendingUp, Calendar, CalendarDays, Activity } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';

interface Props {
    initialData: TargetStatsResponse;
    selectedMonth: string;
    role: string;
}

export default function ManagerTargetsClient({ initialData, selectedMonth, role }: Props) {
    const router = useRouter();
    const [monthInput, setMonthInput] = useState(selectedMonth);
    const [isSaving, setIsSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    // Form State
    const [formData, setFormData] = useState<MonthlyTargetInput>({
        month: selectedMonth,
        targetAppFissati: initialData.targetData.targetAppFissati || 0,
        targetAppConfermati: initialData.targetData.targetAppConfermati || 0,
        targetTrattative: initialData.targetData.targetTrattative || 0,
        targetClosed: initialData.targetData.targetClosed || 0,
        targetValoreContratti: initialData.targetData.targetValoreContratti || 0,
    });

    const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMonthInput(e.target.value);
        router.push(`/manager-targets?month=${e.target.value}`);
    };

    const handleSaveTargets = async () => {
        setIsSaving(true);
        try {
            await saveMonthlyTarget(formData);
            setDialogOpen(false);
            router.refresh(); // ricarica la pagina coi nuovi dati dal server
        } catch (error) {
            console.error("Failed to save target", error);
        } finally {
            setIsSaving(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount);
    };

    const formatPerc = (val: number) => {
        return val.toFixed(2) + '%';
    };

    const thClass = "text-xs font-semibold uppercase tracking-wider text-white bg-slate-800 p-3 lg:p-4 text-left whitespace-nowrap border-b border-slate-700";
    const tdClass = "p-3 lg:p-4 border-b border-slate-100 text-sm font-medium text-slate-700";
    const tdLabelClass = "p-3 lg:p-4 border-b border-slate-100 text-sm font-bold text-orange-600 whitespace-nowrap"; // "Key Labels Arancio"

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-8 pt-6 pb-20 max-w-7xl mx-auto w-full">

            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                        <Target className="h-8 w-8 text-orange-600" />
                        Target & Previsioni
                    </h2>
                    <p className="text-slate-500 mt-1">Confronto Performance Attuali vs Target previsionali GDO</p>
                </div>

                <div className="flex items-center gap-4 bg-white p-2 rounded-lg border shadow-sm">
                    <div className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-slate-500" />
                        <Input
                            type="month"
                            value={monthInput}
                            onChange={handleMonthChange}
                            className="w-40"
                        />
                    </div>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="bg-orange-600 hover:bg-orange-700 text-white">
                                Imposta Target
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Imposta Target Mese - {monthInput}</DialogTitle>
                                <DialogDescription>
                                    Inserisci i target previsionali previsti per questo mese solare.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="tFissati" className="text-right">Fissati</Label>
                                    <Input id="tFissati" type="number" className="col-span-3" value={formData.targetAppFissati} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetAppFissati: Number(e.target.value) })} />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="tConfermati" className="text-right">Confermati</Label>
                                    <Input id="tConfermati" type="number" className="col-span-3" value={formData.targetAppConfermati} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetAppConfermati: Number(e.target.value) })} />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="tTrattative" className="text-right">Trattative</Label>
                                    <Input id="tTrattative" type="number" className="col-span-3" value={formData.targetTrattative} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetTrattative: Number(e.target.value) })} />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="tClosed" className="text-right">Closed</Label>
                                    <Input id="tClosed" type="number" className="col-span-3" value={formData.targetClosed} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetClosed: Number(e.target.value) })} />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="tEur" className="text-right">Stima €</Label>
                                    <Input id="tEur" type="number" className="col-span-3" value={formData.targetValoreContratti} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, targetValoreContratti: Number(e.target.value) })} />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button disabled={isSaving} onClick={handleSaveTargets} className="bg-slate-900 text-white">Salva Cambiamenti</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Global Calendar Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Giorni Lavorativi Mese</CardTitle>
                        <Calendar className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900">{initialData.giorniLavorativiTotaliMese}</div>
                        <p className="text-xs text-slate-400 mt-1">Domeniche Escluse</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Giorni Trascorsi</CardTitle>
                        <Activity className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-600">{initialData.giorniLavorativiTrascorsiOggi}</div>
                        <p className="text-xs text-slate-400 mt-1">Fino a Oggi inclusa</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Forza Vendita Attiva</CardTitle>
                        <Target className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900">{initialData.gdoAttivi} GDO</div>
                        <p className="text-xs text-slate-400 mt-1">Esclusi inattivi/sospesi</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Lead Totali Mese</CardTitle>
                        <CalendarDays className="h-4 w-4 text-slate-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-slate-900">{initialData.totaleLeadDelMese}</div>
                        <p className="text-xs text-slate-400 mt-1">Acquisiti nel CRM / Mese</p>
                    </CardContent>
                </Card>
            </div>

            {/* ALERT CRITICO */}
            {initialData.is7DaysAlertActive && (
                <Alert variant="destructive" className="border-red-600 bg-red-50 text-red-900">
                    <AlertCircle className="h-5 w-5" />
                    <AlertTitle className="font-bold text-lg">ATTENZIONE CRITICA</AlertTitle>
                    <AlertDescription>
                        Fissaggio sotto il <strong>-20%</strong> da 7 o più giorni lavorativi consecutivi. Primo drop il {initialData.dataPrimoMeno20}. Investigare le dinamiche dei lead e script al più presto.
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* TABELLA A: Numeri Mensili */}
                <Card className="shadow-sm overflow-hidden col-span-1 xl:col-span-2">
                    <CardHeader className="bg-slate-50 border-b">
                        <CardTitle className="text-lg text-slate-800">1. Numeri Mensili</CardTitle>
                    </CardHeader>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr>
                                    <th className={thClass}>Metrica</th>
                                    <th className={thClass}>ACT</th>
                                    <th className={thClass}>ACT %</th>
                                    <th className={thClass}>TARGET/DAY</th>
                                    <th className={thClass}>TODAY</th>
                                    <th className={thClass}>TARGET PREV</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className={tdLabelClass}>Appuntamenti fissati</td>
                                    <td className={tdClass}>{initialData.actAppsFissati}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercFissati)}</td>
                                    <td className={tdClass}>{initialData.targetDayFissati.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayFissati}</td>
                                    <td className={tdClass}>{initialData.targetData.targetAppFissati}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Appuntamenti Confermati</td>
                                    <td className={tdClass}>{initialData.actAppsConfermati}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercConfermati)}</td>
                                    <td className={tdClass}>{initialData.targetDayConfermati.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayConfermati}</td>
                                    <td className={tdClass}>{initialData.targetData.targetAppConfermati}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Trattative presenziati</td>
                                    <td className={tdClass}>{initialData.actAppsPresenziati}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercPresenziati)}</td>
                                    <td className={tdClass}>{initialData.targetDayPresenziati.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayPresenziati}</td>
                                    <td className={tdClass}>{initialData.targetData.targetTrattative}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Closed</td>
                                    <td className={tdClass}>{initialData.actClosed}</td>
                                    <td className={tdClass}>{formatPerc(initialData.actPercClosed)}</td>
                                    <td className={tdClass}>{initialData.targetDayClosed.toFixed(2)}</td>
                                    <td className={tdClass}>{initialData.todayClosed}</td>
                                    <td className={tdClass}>{initialData.targetData.targetClosed}</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Valore Contratti firmati</td>
                                    <td className={tdClass}>{formatCurrency(initialData.actValoreContratti)}</td>
                                    <td className={tdClass}>-</td>
                                    <td className={tdClass}>{formatCurrency(initialData.targetDayValoreContratti)}</td>
                                    <td className={tdClass}>-</td>
                                    <td className={tdClass}>{formatCurrency(initialData.targetData.targetValoreContratti)}</td>
                                </tr>
                                <tr className="bg-slate-50">
                                    <td className={tdLabelClass}>[EXTRA] Trattative su lead</td>
                                    <td className={tdClass} colSpan={5}>{formatPerc(initialData.trattativeSuLeadPerc)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* TABELLA B: DATO & FORECAST */}
                <Card className="shadow-sm overflow-hidden col-span-1 xl:col-span-2">
                    <CardHeader className="bg-slate-50 border-b">
                        <CardTitle className="text-lg text-slate-800">2. Dato Operativo & Forecast</CardTitle>
                    </CardHeader>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr>
                                    <th className={thClass}>Metriche d'Allarme / Forecast</th>
                                    <th className={thClass}>Valore Attuale</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className={tdLabelClass}>Fissaggio (Variazione %)</td>
                                    <td className={tdClass}>
                                        <div className={`flex items-center gap-2 font-bold ${initialData.fissaggioVariazionePerc < 0 ? 'text-red-500' : 'text-green-600'}`}>
                                            {initialData.fissaggioVariazionePerc < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                                            {formatPerc(initialData.fissaggioVariazionePerc)}
                                            <span className="text-xs text-slate-400 ml-2 font-normal">(Delta: {formatPerc(initialData.fissaggioVariazioneAss)})</span>
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Data primo &lt;= -20%</td>
                                    <td className={tdClass}>
                                        {initialData.dataPrimoMeno20 ? (
                                            <span className="text-red-600 font-semibold flex items-center gap-2">
                                                <AlertCircle className="h-4 w-4" />
                                                {initialData.dataPrimoMeno20}
                                            </span>
                                        ) : (
                                            <span className="text-green-600">Nessuna Deficit Rilevata o Assorbita</span>
                                        )}
                                    </td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Media app/day/GDO</td>
                                    <td className={tdClass}>{initialData.mediaAppDayGdo.toFixed(2)} appuntamenti</td>
                                </tr>
                                <tr>
                                    <td className={tdLabelClass}>Vendite/GDO (previste nel mese)</td>
                                    <td className={tdClass}>{initialData.mediaVenditePrevisteMeseGdo.toFixed(2)} chiusure / GDO</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>

        </div>
    );
}
